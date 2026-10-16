// ---------------------------------------------------------------------------
// ERROR TRACKING  (V2.11 → Part VIII)
//
// Structured capture of unexpected errors with the context you need to debug
// them: request id, route, user, and a FINGERPRINT that groups the same bug
// together (so 10,000 occurrences of one bug are one issue, not 10,000 lines).
//
// This is a thin seam: swap the body of `captureException` for a Sentry/Rollbar
// SDK call and every call site keeps working. Operational errors (4xx) are NOT
// captured — they're normal traffic, not bugs (Part VIII).
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';

// In-memory tally so /metrics and tests can see aggregation working. A real
// backend does this server-side and persists it.
const seen = new Map();

function fingerprint(err) {
  // Group by error type + the first stack frame — the same bug from the same
  // place collapses into one issue regardless of the specific values involved.
  const frame = (err.stack ?? '').split('\n')[1]?.trim() ?? 'no-frame';
  return createHash('sha1')
    .update(`${err.name}|${err.message}|${frame}`)
    .digest('hex')
    .slice(0, 12);
}

export function captureException(err, context = {}) {
  const id = fingerprint(err);
  const count = (seen.get(id)?.count ?? 0) + 1;
  seen.set(id, { count, name: err.name, message: err.message });

  logger.error(
    {
      errorId: id,
      occurrences: count,
      err: { name: err.name, message: err.message, stack: err.stack },
      ...context,
    },
    'captured exception',
  );
  return id;
}

/** Aggregated view of captured errors (exposed for tests/diagnostics). */
export function capturedErrors() {
  return [...seen.entries()].map(([id, v]) => ({ id, ...v }));
}
