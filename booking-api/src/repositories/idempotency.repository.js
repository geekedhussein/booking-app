// ---------------------------------------------------------------------------
// IDEMPOTENCY REPOSITORY  (Part II idempotency; Part VI atomic claim)
// ---------------------------------------------------------------------------

import { col, oid, toRow, isDuplicateKey } from '../db/index.js';
import { ConflictError } from '../errors/app-error.js';

const keys = () => col('idempotency_keys');

// How long a key is remembered. The TTL index deletes it automatically after.
const KEY_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Atomically claim a key. Returns { claimed: true, row } if THIS request won
 * (it should now execute), or { claimed: false, row } if the key already
 * existed (a duplicate or replay; the caller inspects row.status and
 * row.request_hash).
 *
 * The atomic primitive is the unique index on (user_id, idempotency_key): of
 * any number of concurrent inserts, MongoDB lets exactly one succeed; the rest
 * fail with a duplicate-key error (E11000). This is the same idea as SQL's
 * INSERT … ON CONFLICT DO NOTHING.
 */
export async function claimKey({ userId, key, requestHash }) {
  // Two attempts: if the insert loses to an existing key but that record is
  // gone by the time we read it (its holder failed and released it, or it just
  // expired), the key is free again, so try to claim it once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    const now = new Date();
    const doc = {
      idempotency_key: key,
      user_id: oid(userId),
      request_hash: requestHash,
      status: 'in_progress',
      response_status: null,
      response_body: null,
      created_at: now,
      updated_at: now,
      expires_at: new Date(now.getTime() + KEY_LIFETIME_MS),
    };
    try {
      const { insertedId } = await keys().insertOne(doc);
      return { claimed: true, row: toRow({ _id: insertedId, ...doc }) };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
    // Someone already holds this key: fetch the existing record.
    const existing = await keys().findOne({ user_id: oid(userId), idempotency_key: key });
    if (existing) return { claimed: false, row: toRow(existing) };
  }
  throw new ConflictError('This request is already being processed — retry shortly');
}

/** Store the final response so future replays return it verbatim. */
export async function completeKey({ userId, key, responseStatus, responseBody }) {
  await keys().updateOne(
    { user_id: oid(userId), idempotency_key: key },
    {
      $set: {
        status: 'completed',
        response_status: responseStatus,
        response_body: responseBody,
      },
      $currentDate: { updated_at: true },
    },
  );
}

/** Release a claim (after a 5xx), so the client can retry instead of being stuck. */
export async function releaseKey({ userId, key }) {
  await keys().deleteOne({ user_id: oid(userId), idempotency_key: key });
}
