// ---------------------------------------------------------------------------
// RATE LIMITING  (Phase 1 → Part IX: brute-force / abuse defense)
//
// Two limiters: a lenient GLOBAL one for all traffic, and a strict one for AUTH
// endpoints (login/register) where brute-force and credential-stuffing happen.
//
// The store is REDIS, not in-process memory. Why it must be shared: with several
// app instances behind a load balancer (Part I), an in-memory counter would live
// per-instance, so a client spread across N instances could send N times the
// intended limit. A shared Redis counter enforces one true limit across the fleet.
//
// Degradation: if Redis is unreachable, rate-limit-redis lets requests through
// rather than failing them — we prefer availability over hard-blocking here, and
// other layers (auth, validation) still protect the app.
// ---------------------------------------------------------------------------

import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../cache/redis.js';
import { config } from '../config/index.js';

function makeStore(prefix) {
  return new RedisStore({
    // rate-limit-redis calls Redis via this thunk; ioredis uses .call().
    sendCommand: (...args) => redis.call(...args),
    prefix,
  });
}

// Applied to every request.
export const globalRateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true, //  send RateLimit-* headers so clients can self-throttle
  legacyHeaders: false,
  store: makeStore('rl:global:'),
  // Rate limiting is shared state that would make test suites flaky and
  // order-dependent — disable it under NODE_ENV=test.
  skip: () => config.NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});

// Applied only to auth routes — much stricter.
export const authRateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:auth:'),
  skip: () => config.NODE_ENV === 'test',
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many attempts, please slow down' },
  },
});
