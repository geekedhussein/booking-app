// ---------------------------------------------------------------------------
// OUTBOX RELAY  (V2.3 → transactional outbox — the delivery half)
//
// A SEPARATE long-running process (run: `npm run relay`). It polls the outbox for
// due events and delivers each to its real destination (BullMQ queue for the
// confirmation email, Redis pub/sub for real-time), then marks it processed.
//
// Guarantees:
//   • Claim with a LEASE: each event is atomically stamped "mine until now +
//     lease" before delivery (outboxRepo.claimDueBatch). Several relays can run
//     at once and never take the same event.
//   • At-least-once delivery: if the relay crashes after delivering but before
//     marking the event processed, the lease expires and the event is delivered
//     again — safe because consumers are idempotent (BullMQ jobId dedup).
//   • Retries with backoff; permanent 'failed' after OUTBOX_MAX_ATTEMPTS
//     (a dead-letter you can inspect).
//
// Claiming, delivering and marking are separate steps, so no database lock is
// held during network I/O. The lease must comfortably outlast one batch's
// deliveries (webhook retries included); otherwise another relay could start a
// second delivery of an event still in progress.
// ---------------------------------------------------------------------------

import { closeDb } from './db/index.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { sleep } from './utils/sleep.js';
import * as outboxRepo from './repositories/outbox.repository.js';
import { enqueueNotification, closeQueue } from './queue/notifications.js';
import { publishBookingEvent, closePubSub } from './realtime/pubsub.js';
import * as webhookService from './services/webhook.service.js';

// Map an outbox event to its real-world side effects. dedupeId = the outbox row
// id, so a redelivery (at-least-once) never enqueues the same job twice.
async function dispatch(event) {
  const payload = event.payload; // stored as a document → already a JS object
  const dedupeId = `outbox-${event.id}`;
  switch (event.event_type) {
    case 'booking.created':
      await enqueueNotification({
        type: 'booking.confirmation',
        payload,
        dedupeId,
      });
      await publishBookingEvent({
        type: 'booking.created',
        resourceId: payload.resourceId,
        booking: payload,
      });
      break;
    case 'booking.cancelled':
      await publishBookingEvent({
        type: 'booking.cancelled',
        resourceId: payload.resourceId,
        booking: payload,
      });
      break;
    case 'booking.rescheduled':
      await publishBookingEvent({
        type: 'booking.rescheduled',
        resourceId: payload.resourceId,
        booking: payload,
      });
      break;
    case 'booking.reminder':
      await enqueueNotification({ type: 'booking.reminder', payload, dedupeId });
      break;
    case 'user.email_verification':
      await enqueueNotification({ type: 'email.verification', payload, dedupeId });
      break;
    case 'user.password_reset':
      await enqueueNotification({ type: 'password.reset', payload, dedupeId });
      break;
    default:
      logger.warn({ eventType: event.event_type }, 'unknown outbox event type');
  }

  // V2.10: fan the event out to any registered webhook subscribers. Failures are
  // recorded per-subscription and never fail the outbox row (a broken subscriber
  // must not block the rest of the pipeline).
  if (event.event_type.startsWith('booking.')) {
    try {
      await webhookService.dispatchEvent({ eventType: event.event_type, payload });
    } catch (err) {
      logger.warn({ err: err.message }, 'webhook dispatch error');
    }
  }
}

// How long a claimed event belongs to this relay. Generous on purpose: a batch
// of webhook deliveries with retries can take tens of seconds.
const LEASE_MS = 120_000;

async function processBatch() {
  let events;
  try {
    events = await outboxRepo.claimDueBatch(config.OUTBOX_BATCH_SIZE, LEASE_MS);
  } catch (err) {
    logger.error({ err: err.message }, 'could not claim outbox events — will retry');
    return 0;
  }
  for (const event of events) {
    try {
      await dispatch(event);
      await outboxRepo.markProcessed(event.id);
    } catch (err) {
      const attempts = event.attempts + 1;
      const failed = attempts >= config.OUTBOX_MAX_ATTEMPTS;
      const backoff = Math.min(2 ** attempts, 60); // seconds, capped
      await outboxRepo
        .markRetry(event.id, attempts, backoff, failed)
        .catch((e) => logger.error({ err: e.message }, 'could not record outbox retry'));
      logger.warn(
        { id: event.id, attempts, failed, err: err.message },
        failed ? 'outbox event permanently failed' : 'outbox delivery failed — will retry',
      );
    }
  }
  return events.length;
}

let running = true;

async function loop() {
  logger.info('Outbox relay started, polling for events...');
  while (running) {
    const processed = await processBatch();
    // If we drained a full batch there may be more — loop immediately; otherwise
    // wait before polling again to avoid hammering the DB.
    if (processed < config.OUTBOX_BATCH_SIZE) {
      await sleep(config.OUTBOX_POLL_INTERVAL_MS);
    }
  }
}

async function shutdown(signal) {
  logger.info(`${signal} received — stopping outbox relay`);
  running = false;
  await Promise.allSettled([closeQueue(), closePubSub(), closeDb()]);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

loop().catch((err) => {
  logger.fatal({ err }, 'outbox relay crashed');
  process.exit(1);
});
