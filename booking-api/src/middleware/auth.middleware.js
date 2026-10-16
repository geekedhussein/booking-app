// ---------------------------------------------------------------------------
// AUTH MIDDLEWARE  (Phase 1 → Part IV: authN vs authZ; Part V middleware)
//
// TWO separate middlewares for two separate questions (the distinction from
// Part IV that everyone blurs):
//
//   authenticate   → "WHO are you?"      Verifies the token, attaches req.user.
//                                        Fails with 401 if no/invalid token.
//   authorize(...) → "Are you ALLOWED?"  Checks req.user.role against a list.
//                                        Fails with 403 if role not permitted.
//
// authenticate runs first and populates req.user; authorize runs after and reads
// it. Order in the chain is everything (Part V).
// ---------------------------------------------------------------------------

import * as authService from '../services/auth.service.js';
import { UnauthorizedError, ForbiddenError } from '../errors/app-error.js';

export function authenticate(req, _res, next) {
  const header = req.headers.authorization;

  // Expect: "Authorization: Bearer <token>". The Bearer scheme just means
  // "whoever bears this token is treated as the subject" (Part IV).
  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  const token = header.slice('Bearer '.length).trim();
  const claims = authService.verifyToken(token); // throws 401 if invalid/expired

  // Attach the identity to the request context (Part V): everything downstream
  // can now trust who the caller is without re-checking the token.
  req.user = { id: claims.sub, role: claims.role };
  next();
}

// authorize('staff', 'admin') → only those roles may proceed. This is RBAC
// (Part IV): permissions attach to roles, and we check the caller's role.
export function authorize(...allowedRoles) {
  return (req, _res, next) => {
    // Defensive: authorize must always be used AFTER authenticate.
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError('You do not have permission to perform this action'));
    }
    next();
  };
}
