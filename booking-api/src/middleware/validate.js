// ---------------------------------------------------------------------------
// VALIDATION MIDDLEWARE  (Phase 1 → Part IV validation + Part V middleware)
//
// A factory: you give it zod schemas for any of { body, params, query }, and it
// returns a middleware that runs BEFORE the controller in the chain. This is the
// "validate before you trust" rule from Part IV, applied at exactly the right
// place — the boundary where untrusted input enters the system.
//
// What it does, tying back to Part IV:
//   • VALIDATES shape and types (a name is a non-empty string, capacity a
//     positive int).
//   • TRANSFORMS / COERCES ("3" → 3, "true" → true) — validation and
//     transformation happen together.
//   • AGGREGATES every failure across body+params+query and returns them all at
//     once, so the client fixes everything in one round trip.
//   • REJECTS unknown fields (schemas use .strict()) — you never act on data you
//     didn't explicitly ask for.
//
// The cleaned, coerced result is stored on `req.validated`, NOT written back
// over req.body/req.query. In Express 5, req.query is a read-only getter —
// reassigning it throws. Using our own `req.validated` bucket is the version-
// proof pattern, and it makes it obvious in a controller that it's reading
// VALIDATED input, not raw input.
// ---------------------------------------------------------------------------

import { ValidationError } from '../errors/app-error.js';

export function validate(schemas) {
  return (req, _res, next) => {
    const validated = {};
    const errors = [];

    for (const location of ['params', 'query', 'body']) {
      const schema = schemas[location];
      if (!schema) continue;

      const result = schema.safeParse(req[location]);
      if (result.success) {
        validated[location] = result.data;
      } else {
        for (const issue of result.error.issues) {
          errors.push({
            location, //                     which part of the request
            field: issue.path.join('.') || '(root)',
            message: issue.message,
          });
        }
      }
    }

    if (errors.length > 0) {
      // One 400 carrying EVERY problem (Part IV: aggregate errors). The central
      // error handler turns this into the JSON response.
      return next(new ValidationError('Request validation failed', errors));
    }

    req.validated = validated;
    next();
  };
}
