// ---------------------------------------------------------------------------
// OUTBOX REPOSITORY  (transactional outbox: Part VII task queues; Part VI ACID)
//
// insertEvent takes the caller's `session`, so the event is written in the SAME
// transaction as the business change it describes. That shared transaction is
// the whole point: an email or live update can never exist without its booking,
// or a booking without its event.
//
// The relay claims events with a LEASE. PostgreSQL offered FOR UPDATE SKIP
// LOCKED ("lock these rows; skip any another relay holds"). MongoDB has no row
// locks to skip, so a relay instead atomically stamps an event with
// locked_until = now + lease. Other relays ignore events whose lease is still
// running. If a relay crashes mid-delivery, its lease simply expires and another
// relay takes the event: delivery stays AT-LEAST-ONCE, so consumers must be
// idempotent (email jobs carry the event id as a dedupe id).
// ---------------------------------------------------------------------------

import { col, oid, toRow } from '../db/index.js';

const outbox = () => col('outbox');

/** Record an event inside the caller's transaction (pass its session). */
export async function insertEvent(
  { aggregateType, aggregateId, eventType, payload },
  session,
) {
  const now = new Date();
  const doc = {
    aggregate_type: aggregateType,
    aggregate_id: String(aggregateId),
    event_type: eventType,
    payload,
    status: 'pending',
    attempts: 0,
    created_at: now,
    processed_at: null,
    next_attempt_at: now,
    locked_until: null,
  };
  const { insertedId } = await outbox().insertOne(doc, { session });
  return toRow({ _id: insertedId, ...doc });
}

/**
 * Claim up to `limit` due events, oldest first, for `leaseMs`. Each claim is one
 * atomic findOneAndUpdate: the filter only matches an event nobody holds, and
 * the update takes it in the same step, so two relays can never claim one event.
 */
export async function claimDueBatch(limit, leaseMs) {
  const claimed = [];
  for (let i = 0; i < limit; i += 1) {
    const now = new Date();
    const doc = await outbox().findOneAndUpdate(
      {
        status: 'pending',
        next_attempt_at: { $lte: now },
        $or: [{ locked_until: null }, { locked_until: { $lt: now } }],
      },
      { $set: { locked_until: new Date(now.getTime() + leaseMs) } },
      { sort: { created_at: 1 }, returnDocument: 'after' },
    );
    if (!doc) break;
    claimed.push(toRow(doc));
  }
  return claimed;
}

export async function markProcessed(id) {
  await outbox().updateOne(
    { _id: oid(id) },
    { $set: { status: 'processed', processed_at: new Date(), locked_until: null } },
  );
}

/**
 * Record a failed delivery: bump attempts, and either schedule a retry after
 * `backoffSeconds` or mark the event permanently failed.
 */
export async function markRetry(id, attempts, backoffSeconds, failed) {
  await outbox().updateOne(
    { _id: oid(id) },
    {
      $set: {
        attempts,
        status: failed ? 'failed' : 'pending',
        next_attempt_at: new Date(Date.now() + backoffSeconds * 1000),
        locked_until: null,
      },
    },
  );
}
