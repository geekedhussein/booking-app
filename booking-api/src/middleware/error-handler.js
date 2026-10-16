// ---------------------------------------------------------------------------
// CENTRAL ERROR HANDLER  (Phase 1 → Part V middleware + Part VIII/IX)
//
// Express recognizes a middleware function with FOUR arguments
// (err, req, res, next) as an error handler. It must be registered LAST, after
// every route and other middleware, so that anything thrown or passed to
// next(err) anywhere upstream funnels into this single place.
//
// This is where the Part VIII strategy becomes concrete:
//   • Operational errors (our AppError subclasses) → their real status + message.
//   • Everything else (a bug / programmer error)   → generic 500, and we do NOT
//     leak the message, stack, queries, or file paths to the client (Part IX:
//     don't expose internals). We still LOG the full detail server-side.
// ---------------------------------------------------------------------------

import { AppError } from '../errors/app-error.js';
import { config } from '../config/index.js';
import { captureException } from '../observability/error-tracker.js';

// Express needs the 4-arg signature to recognize this as an error handler, even
// though `next` is unused — hence the underscore prefix (allowed by our lint rule).
export function errorHandler(err, req, res, _next) {
  const isAppError = err instanceof AppError;
  const isOperational = isAppError && err.isOperational;
  const statusCode = isAppError ? err.statusCode : 500;

  // Prefer the request-scoped logger from pino-http (it auto-attaches the
  // request id, so this log line is correlated with the request — Part VIII).
  const log = req.log ?? console;

  // Unexpected / 5xx errors are logged at `error` with the full stack.
  // Expected operational errors are logged at `warn` with just the essentials —
  // a 404 or a validation failure is not an emergency and shouldn't read like one.
  if (statusCode >= 500) {
    // V2.11: capture unexpected errors with grouping context. Operational 4xx
    // errors are NOT captured — they're normal traffic, not bugs.
    captureException(err, {
      requestId: req.id,
      route: req.originalUrl,
      method: req.method,
      userId: req.user?.id,
    });
    log.error({ err }, 'Unhandled error while processing request');
  } else {
    log.warn({ code: err.code, msg: err.message }, 'Operational error');
  }

  const body = {
    error: {
      code: isAppError ? err.code : 'INTERNAL_ERROR',
      // Only trust an AppError's message to be client-safe. For anything else,
      // return a generic message — never the raw error text.
      message: isOperational ? err.message : 'An unexpected error occurred',
    },
    // The request id lets a user quote it in a bug report and lets you find the
    // exact correlated logs (Part VIII observability).
    requestId: req.id,
  };

  if (isAppError && err.details !== undefined) {
    body.error.details = err.details;
  }

  // In development ONLY, include the stack for unexpected errors to speed up
  // debugging. This branch can never run in production.
  if (config.NODE_ENV === 'development' && !isOperational) {
    body.error.stack = err.stack;
  }

  res.status(statusCode).json(body);
}
