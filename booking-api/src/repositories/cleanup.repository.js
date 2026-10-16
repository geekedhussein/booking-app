// ---------------------------------------------------------------------------
// CLEANUP REPOSITORY  (data retention, run by the scheduler)
//
// Rows that served their purpose are deleted after RETENTION_DAYS, so the
// collections don't grow forever. Idempotency keys also have a TTL index that
// lets MongoDB expire them on its own; deleting here as well keeps the job's
// report complete and doesn't depend on the TTL monitor's timing.
// ---------------------------------------------------------------------------

import { col } from '../db/index.js';

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000);

export async function deleteExpiredIdempotencyKeys() {
  const { deletedCount } = await col('idempotency_keys').deleteMany({
    expires_at: { $lt: new Date() },
  });
  return deletedCount;
}

export async function deleteStaleAuthTokens(retentionDays) {
  const { deletedCount } = await col('auth_tokens').deleteMany({
    $or: [{ used_at: { $ne: null } }, { expires_at: { $lt: new Date() } }],
    created_at: { $lt: daysAgo(retentionDays) },
  });
  return deletedCount;
}

export async function deleteStaleRefreshTokens(retentionDays) {
  const { deletedCount } = await col('refresh_tokens').deleteMany({
    $or: [{ revoked: true }, { expires_at: { $lt: new Date() } }],
    created_at: { $lt: daysAgo(retentionDays) },
  });
  return deletedCount;
}

export async function deleteProcessedOutbox(retentionDays) {
  const { deletedCount } = await col('outbox').deleteMany({
    status: 'processed',
    processed_at: { $lt: daysAgo(retentionDays) },
  });
  return deletedCount;
}
