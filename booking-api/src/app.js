// ---------------------------------------------------------------------------
// APP FACTORY  (Phase 1 → Part V: The Middleware Chain)
//
// This module builds and returns the Express app but does NOT start listening —
// that separation is deliberate:
//   • server.js starts the real HTTP server (and owns graceful shutdown).
//   • tests can import createApp() and exercise it WITHOUT binding a port.
// This is exactly the "layered / testable" thinking from Part V, applied at the
// top level.
//
// The ORDER of app.use(...) calls IS the middleware chain from Part V. Order is
// logic, not decoration — read this function top-to-bottom as "what happens to
// a request, in sequence".
// ---------------------------------------------------------------------------

import express from 'express';
import pinoHttp from 'pino-http';
import helmet from 'helmet';
import cors from 'cors';
import { randomUUID } from 'node:crypto';

import { logger } from './utils/logger.js';
import { config } from './config/index.js';
import { requestTimeout } from './middleware/request-timeout.js';
import { globalRateLimiter, authRateLimiter } from './middleware/rate-limit.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { runInTrace, finishTrace } from './observability/tracing.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { resourceRouter } from './routes/resource.routes.js';
import { bookingRouter } from './routes/booking.routes.js';
import { webhookRouter } from './routes/webhook.routes.js';
import { providerRouter } from './routes/provider.routes.js';
import { docsRouter } from './routes/docs.routes.js';
import { notFoundHandler } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';

export function createApp() {
  const app = express();

  // --- Secure defaults (Part IX) ---
  // Don't advertise "X-Powered-By: Express". Tiny, but security is about not
  // volunteering information an attacker can use to fingerprint your stack.
  app.disable('x-powered-by');

  // === EDGE MIDDLEWARE (V2.1) — runs before everything, rejects bad traffic ===

  // 1. Security response headers (Part IX secure defaults): HSTS, nosniff,
  //    frame denial, a baseline CSP, etc.
  app.use(helmet());

  // 2. CORS (Part II): allow only the configured browser origins. A request from
  //    a non-allowed origin simply won't get the allow-origin header back, so the
  //    browser blocks the JS from reading the response. Non-browser callers are
  //    unaffected (CORS is browser-enforced).
  app.use(
    cors({
      origin(origin, cb) {
        // No Origin header = non-browser client (curl, server-to-server) → allow.
        if (!origin || config.CORS_ORIGINS.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    }),
  );

  // 3. Request timeout: bound every request (Part IX resource protection).
  app.use(requestTimeout);

  // 4. Global rate limit (Part IX): throttle abusive clients across the fleet.
  app.use(globalRateLimiter);

  // === MIDDLEWARE CHAIN (runs in this order for every request) ===============

  // 1. Request ID + structured request logging (Part VIII observability).
  //    Every request gets a correlation id: we reuse an incoming
  //    `x-request-id` if a proxy/load-balancer set one, otherwise generate a
  //    UUID. It's echoed back in the response header AND attached to every log
  //    line for this request, so one request's whole story is reconstructable.
  app.use(
    pinoHttp({
      logger,
      genReqId(req, res) {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );

  // 1b. Metrics (V2.11): time every request, labelled by ROUTE PATTERN.
  app.use(metricsMiddleware);

  // 1c. Tracing (V2.11): run each request inside a trace context, so nested
  //     spans (service calls, DB queries) attach automatically via
  //     AsyncLocalStorage — no need to thread a ctx argument everywhere.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    runInTrace({ traceId: req.id, attributes: { method: req.method } }, () => {
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        finishTrace({ route: req.originalUrl, status: res.statusCode, ms });
      });
      next();
    });
  });

  // 2. Body parsing = deserialization (Part III): turn the raw JSON bytes of the
  //    request body into a native JS object on `req.body`. The size limit is a
  //    security control (Part IX) — never accept an unbounded payload, or a
  //    single huge request could exhaust memory.
  app.use(express.json({ limit: '1mb' }));

  // === ROUTES ================================================================
  // Each mounted router is Part III "route grouping": a prefix + its routes.
  // === ROUTES ================================================================
  // V2.10: everything lives under /v1 (URI versioning, Part III) so a future
  // breaking change can ship as /v2 while /v1 keeps working.
  const v1 = express.Router();
  v1.use('/auth', authRateLimiter, authRouter);
  v1.use('/resources', resourceRouter);
  v1.use('/bookings', bookingRouter);
  v1.use('/webhooks', webhookRouter);
  v1.use('/providers', providerRouter);
  app.use('/v1', v1);

  // Health stays unversioned — it's infrastructure, not part of the API contract
  // (load balancers and orchestrators poll a stable path).
  app.use('/health', healthRouter);

  // OpenAPI spec + interactive docs (V2.10).
  app.use('/docs', docsRouter);

  // === TAIL OF THE CHAIN =====================================================

  // 3. Nothing matched above → 404. Must come AFTER all routes.
  app.use(notFoundHandler);

  // 4. Central error handler. MUST be last — it catches everything upstream.
  app.use(errorHandler);

  return app;
}
