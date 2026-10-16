// ---------------------------------------------------------------------------
// NOT-FOUND MIDDLEWARE  (Phase 1 → Part V: Middleware chain)
//
// This runs only if NO route matched the request. Because middleware executes
// in order (Part V), this MUST be registered after all real routes but before
// the error handler. Instead of sending a response itself, it creates a
// NotFoundError and passes it to next() — so ALL error responses (including
// 404s) are shaped in exactly one place: the central error handler.
// ---------------------------------------------------------------------------

import { NotFoundError } from '../errors/app-error.js';

export function notFoundHandler(req, _res, next) {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
}
