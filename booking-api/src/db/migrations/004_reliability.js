// ---------------------------------------------------------------------------
// 004 — idempotency keys and the transactional outbox  (Part II, Part VII)
// ---------------------------------------------------------------------------

import { ensureCollection, objectId, date, nullableDate, str, int } from './_helpers.js';

export const description = 'idempotency_keys (TTL), outbox';

export async function up(db) {
  await ensureCollection(db, 'idempotency_keys', {
    required: [
      'idempotency_key',
      'user_id',
      'request_hash',
      'status',
      'created_at',
      'updated_at',
      'expires_at',
    ],
    properties: {
      idempotency_key: str({ maxLength: 255 }),
      user_id: objectId,
      request_hash: str(),
      status: { enum: ['in_progress', 'completed'] },
      response_status: { bsonType: ['int', 'long', 'null'] },
      response_body: {},
      created_at: date,
      updated_at: date,
      expires_at: date,
    },
  });
  const keys = db.collection('idempotency_keys');
  // The atomic claim: of two concurrent inserts with the same (user, key),
  // exactly one succeeds; the other gets a duplicate-key error.
  await keys.createIndex(
    { user_id: 1, idempotency_key: 1 },
    { unique: true, name: 'idempotency_user_key_uq' },
  );
  // A TTL index: MongoDB itself deletes each document once its expires_at has
  // passed (checked about once a minute). No cleanup job needed for these.
  await keys.createIndex(
    { expires_at: 1 },
    { expireAfterSeconds: 0, name: 'idempotency_ttl' },
  );

  await ensureCollection(db, 'outbox', {
    required: [
      'aggregate_type',
      'aggregate_id',
      'event_type',
      'payload',
      'status',
      'attempts',
      'created_at',
      'next_attempt_at',
    ],
    properties: {
      aggregate_type: str(),
      aggregate_id: str(),
      event_type: str(),
      payload: { bsonType: 'object' },
      status: { enum: ['pending', 'processed', 'failed'] },
      attempts: int({ minimum: 0 }),
      created_at: date,
      processed_at: nullableDate,
      next_attempt_at: date,
      // Lease: a relay that claims an event owns it until this time. If it
      // crashes, the lease expires and another relay picks the event up.
      locked_until: nullableDate,
    },
  });
  const outbox = db.collection('outbox');
  await outbox.createIndex(
    { status: 1, next_attempt_at: 1, created_at: 1 },
    { name: 'outbox_due_idx' },
  );
}
