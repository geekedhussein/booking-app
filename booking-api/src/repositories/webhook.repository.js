// ---------------------------------------------------------------------------
// WEBHOOK REPOSITORY  (Part XI webhooks)
// ---------------------------------------------------------------------------

import { col, oid, toRow } from '../db/index.js';

const subs = () => col('webhook_subscriptions');
const deliveries = () => col('webhook_deliveries');

export async function insertSubscription({ ownerId, url, secret, eventTypes }) {
  const now = new Date();
  const doc = {
    owner_id: oid(ownerId),
    url,
    secret,
    event_types: eventTypes,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  const { insertedId } = await subs().insertOne(doc);
  return toRow({ _id: insertedId, ...doc });
}

export async function listByOwner(ownerId) {
  const docs = await subs()
    .find({ owner_id: oid(ownerId) })
    .sort({ _id: 1 })
    .toArray();
  return docs.map(toRow);
}

export async function findById(id) {
  const _id = oid(id);
  return _id ? toRow(await subs().findOne({ _id })) : null;
}

/** Delete a subscription and its delivery log (what ON DELETE CASCADE did). */
export async function deleteSubscription(id) {
  const _id = oid(id);
  const { deletedCount } = await subs().deleteOne({ _id });
  if (deletedCount) await deliveries().deleteMany({ subscription_id: _id });
  return deletedCount;
}

// Active subscriptions interested in this event type (empty event_types = all).
export async function findActiveForEvent(eventType) {
  const docs = await subs()
    .find({
      is_active: true,
      $or: [{ event_types: { $size: 0 } }, { event_types: eventType }],
    })
    .toArray();
  return docs.map(toRow);
}

export async function recordDelivery({
  subscriptionId,
  eventType,
  payload,
  status,
  attempts,
  responseStatus = null,
  lastError = null,
}) {
  const now = new Date();
  const doc = {
    subscription_id: oid(subscriptionId),
    event_type: eventType,
    payload,
    status,
    attempts,
    response_status: responseStatus,
    last_error: lastError,
    created_at: now,
    delivered_at: status === 'delivered' ? now : null,
  };
  const { insertedId } = await deliveries().insertOne(doc);
  return toRow({ _id: insertedId, ...doc });
}

export async function listDeliveries(subscriptionId, limit = 20) {
  const docs = await deliveries()
    .find(
      { subscription_id: oid(subscriptionId) },
      { projection: { payload: 0, subscription_id: 0 } },
    )
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toRow);
}
