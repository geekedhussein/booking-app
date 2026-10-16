// ---------------------------------------------------------------------------
// ERROR TYPES  (Phase 1 → Part VIII: Error Handling Strategy)
//
// The central distinction from Part VIII:
//   OPERATIONAL errors  = expected, part of normal operation (bad input, not
//                         found, unauthorized). We handle these gracefully and
//                         return a clean HTTP status to the client.
//   PROGRAMMER errors   = bugs (undefined is not a function). These are NOT
//                         instances of AppError; they bubble up to the central
//                         handler, get logged loudly, and return a generic 500
//                         WITHOUT leaking internals to the client (Part IX).
//
// Giving each operational error its own class + statusCode lets the ONE central
// error handler (see middleware/error-handler.js) map any thrown error to the
// correct HTTP status (Part II) without a giant if/else ladder.
// ---------------------------------------------------------------------------

export class AppError extends Error {
  /**
   * @param {string} message      Human-readable, safe to show the client.
   * @param {object} [opts]
   * @param {number} [opts.statusCode=500]  HTTP status (Part II).
   * @param {string} [opts.code='INTERNAL_ERROR']  Stable machine-readable code
   *        clients can branch on — more durable than matching on message text.
   * @param {boolean} [opts.isOperational=true]  Expected error vs. a bug.
   * @param {any} [opts.details]   Extra structured info (e.g. field-level
   *        validation failures). Safe to expose for operational errors.
   */
  constructor(
    message,
    { statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true, details } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    if (details !== undefined) this.details = details;
    // Keep the stack trace pointing at where the error was created, not here.
    Error.captureStackTrace?.(this, this.constructor);
  }
}

// 400 — the request itself is malformed / fails validation (Part IV).
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR', details });
  }
}

// 401 — not authenticated ("who are you?" unanswered) (Part IV).
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED' });
  }
}

// 403 — authenticated, but not allowed to do this (Part IV).
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, { statusCode: 403, code: 'FORBIDDEN' });
  }
}

// 404 — the addressed resource does not exist (Part II/III).
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details) {
    super(message, { statusCode: 404, code: 'NOT_FOUND', details });
  }
}

// 409 — the request conflicts with current state. This is THE status code for
// "that time slot is already booked" — the heart of our whole domain (Part II).
export class ConflictError extends AppError {
  constructor(message = 'Conflict with current state', details) {
    super(message, { statusCode: 409, code: 'CONFLICT', details });
  }
}
