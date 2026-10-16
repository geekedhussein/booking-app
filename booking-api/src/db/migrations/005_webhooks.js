// ---------------------------------------------------------------------------
// 005 — webhook subscriptions and their delivery log  (Part XI webhooks)
// ---------------------------------------------------------------------------

import { ensureCollection, objectId, date, nullableDate, str, int, bool } from './_helpers.js';

export const description = 'webhook_subscriptions, webhook_deliveries';

export async function up(db) {
  await ensureCollection(db, 'webhook_subscriptions', {
    required: [
      'owner_id',
      'url',
      'secret',
      'event_types',
      'is_active',
      'created_at',
      'updated_at',
    ],
    properties: {
      owner_id: objectId,
      url: str(),
      secret: str(),
      event_types: { bsonType: 'array', items: str() }, // empty = all events
      is_active: bool,
      created_at: date,
      updated_at: date,
    },
  });
  const subs = db.collection('webhook_subscriptions');
  await subs.createIndex({ owner_id: 1 }, { name: 'webhook_subscriptions_owner_idx' });
  await subs.createIndex({ is_active: 1 }, { name: 'webhook_subscriptions_active_idx' });

  // Deliveries grow without bound, so they get their own collection rather than
  // an array inside the subscription (a document is capped at 16 MB).
  await ensureCollection(db, 'webhook_deliveries', {
    required: ['subscription_id', 'event_type', 'payload', 'status', 'attempts', 'created_at'],
    properties: {
      subscription_id: objectId,
      event_type: str(),
      payload: {},
      status: { enum: ['pending', 'delivered', 'failed'] },
      attempts: int({ minimum: 0 }),
      last_error: { bsonType: ['string', 'null'] },
      response_status: { bsonType: ['int', 'long', 'null'] },
      created_at: date,
      delivered_at: nullableDate,
    },
  });
  await db
    .collection('webhook_deliveries')
    .createIndex(
      { subscription_id: 1, created_at: -1 },
      { name: 'webhook_deliveries_sub_idx' },
    );
}
