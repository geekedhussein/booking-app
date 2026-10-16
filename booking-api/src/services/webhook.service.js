// ---------------------------------------------------------------------------
// WEBHOOK SERVICE  (V2.10 → Part XI webhooks)
//
// Two responsibilities:
//   1. Manage subscriptions (register/list/delete). The secret is returned ONCE
//      at creation — like an API key, we never show it again.
//   2. Deliver events: sign the payload, POST it, record the attempt, retry
//      transient failures with backoff.
//
// Delivery is driven by the OUTBOX relay (V2.3), so an event can't be lost.
// ---------------------------------------------------------------------------

import * as repo from '../repositories/webhook.repository.js';
import { NotFoundError, ForbiddenError } from '../errors/app-error.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import {
  generateWebhookSecret,
  signPayload,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '../utils/webhook-signing.js';

function toSubscriptionDTO(row, { includeSecret = false } = {}) {
  return {
    id: row.id,
    url: row.url,
    eventTypes: row.event_types,
    isActive: row.is_active,
    createdAt: row.created_at,
    // Only returned at creation time (like an API key).
    ...(includeSecret ? { secret: row.secret } : {}),
  };
}

export async function createSubscription({ ownerId, url, eventTypes = [] }) {
  const secret = generateWebhookSecret();
  const row = await repo.insertSubscription({ ownerId, url, secret, eventTypes });
  return toSubscriptionDTO(row, { includeSecret: true });
}

export async function listSubscriptions(ownerId) {
  const rows = await repo.listByOwner(ownerId);
  return rows.map((r) => toSubscriptionDTO(r));
}

export async function deleteSubscription({ id, requester }) {
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError(`Webhook ${id} not found`);
  const isStaff = requester.role === 'staff' || requester.role === 'admin';
  if (String(row.owner_id) !== String(requester.id) && !isStaff) {
    throw new ForbiddenError('You can only delete your own webhooks');
  }
  await repo.deleteSubscription(id);
}

export async function listDeliveries({ id, requester }) {
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError(`Webhook ${id} not found`);
  const isStaff = requester.role === 'staff' || requester.role === 'admin';
  if (String(row.owner_id) !== String(requester.id) && !isStaff) {
    throw new ForbiddenError('You can only view your own webhook deliveries');
  }
  return repo.listDeliveries(id);
}

/**
 * Deliver one event to one subscriber, with retries + backoff.
 * Returns true if delivered. Called by the outbox relay.
 */
export async function deliverToSubscription({
  subscription,
  eventType,
  payload,
  maxAttempts = 3,
}) {
  const body = JSON.stringify({ eventType, data: payload });
  const timestamp = Date.now().toString();
  const signature = signPayload({ secret: subscription.secret, timestamp, body });

  let attempts = 0;
  let lastError = null;
  let responseStatus = null;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const res = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: signature,
          [TIMESTAMP_HEADER]: timestamp,
        },
        body,
        signal: AbortSignal.timeout(5000), // never hang on a slow subscriber
      });
      responseStatus = res.status;
      if (res.ok) {
        await repo.recordDelivery({
          subscriptionId: subscription.id,
          eventType,
          payload,
          status: 'delivered',
          attempts,
          responseStatus,
        });
        return true;
      }
      lastError = `HTTP ${res.status}`;
      // 4xx (except 429) means the receiver rejected it — retrying won't help.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err.message;
    }
    // Exponential backoff between attempts.
    if (attempts < maxAttempts) {
      await sleep(2 ** attempts * 200);
    }
  }

  await repo.recordDelivery({
    subscriptionId: subscription.id,
    eventType,
    payload,
    status: 'failed',
    attempts,
    responseStatus,
    lastError,
  });
  logger.warn(
    { subscriptionId: subscription.id, eventType, lastError },
    'webhook delivery failed',
  );
  return false;
}

/** Fan an event out to every interested active subscription. */
export async function dispatchEvent({ eventType, payload }) {
  const subs = await repo.findActiveForEvent(eventType);
  await Promise.allSettled(
    subs.map((subscription) => deliverToSubscription({ subscription, eventType, payload })),
  );
  return subs.length;
}
