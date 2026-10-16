// ---------------------------------------------------------------------------
// IDEMPOTENCY MIDDLEWARE  (V2.2 → Part II idempotency)
//
// Honors an optional `Idempotency-Key` header on unsafe (POST) routes. Must run
// AFTER authenticate (needs req.user) and can run before or after validate — we
// fingerprint the raw req.body so the hash is stable regardless of validation.
//
// Behavior:
//   • No header               → pass through (idempotency is opt-in per request).
//   • First use of a key       → claim it, let the request run, capture & store
//                                the response for future replays.
//   • Replay (completed)       → return the stored response, no re-execution.
//   • Same key, different body  → 409 (misuse: a key identifies ONE operation).
//   • Concurrent duplicate      → 409 "already being processed".
//   • Original failed (5xx)     → release the claim so a retry can proceed.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import * as idempotencyRepo from '../repositories/idempotency.repository.js';
import { ConflictError } from '../errors/app-error.js';

// Deterministic JSON (sorted keys) so {a,b} and {b,a} hash identically.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',')}}`;
}

function fingerprint(req) {
  const material = `${req.method} ${req.originalUrl} ${stableStringify(req.body ?? {})}`;
  return createHash('sha256').update(material).digest('hex');
}

export async function idempotency(req, res, next) {
  const key = req.header('Idempotency-Key');
  if (!key) return next(); // opt-in: no key, normal processing

  const userId = req.user.id;
  const requestHash = fingerprint(req);

  const { claimed, row } = await idempotencyRepo.claimKey({ userId, key, requestHash });

  if (!claimed) {
    // A record already exists for this (user, key).
    if (row.request_hash !== requestHash) {
      return next(
        new ConflictError(
          'Idempotency-Key was already used with different request parameters',
        ),
      );
    }
    if (row.status === 'completed') {
      // Replay the original response exactly (exactly-once for the client).
      res.set('Idempotent-Replay', 'true');
      return res.status(row.response_status).json(row.response_body);
    }
    // status is 'in_progress' — a sibling request is mid-flight.
    return next(
      new ConflictError('A request with this Idempotency-Key is already being processed'),
    );
  }

  // We won the claim. Intercept the response so we can persist it for replays.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode;
    if (status >= 500) {
      // Transient/server failure: release the claim so the client can retry.
      idempotencyRepo
        .releaseKey({ userId, key })
        .catch((err) =>
          req.log?.warn({ err: err.message }, 'failed to release idempotency key'),
        );
    } else {
      // Final result (success or a deterministic 4xx like overlap 409): store it.
      idempotencyRepo
        .completeKey({ userId, key, responseStatus: status, responseBody: body })
        .catch((err) =>
          req.log?.warn({ err: err.message }, 'failed to store idempotent response'),
        );
    }
    return originalJson(body);
  };

  next();
}
