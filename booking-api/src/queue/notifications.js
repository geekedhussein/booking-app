// ---------------------------------------------------------------------------
// NOTIFICATIONS QUEUE — PRODUCER  (Part VII; generalized in V2.5)
//
// One queue for all outbound notifications (booking confirmations, email
// verification, password reset). The job's `type` tells the worker what to do.
// Previously this was booking-specific; V2.5 generalizes it so new email kinds
// don't each need their own queue.
// ---------------------------------------------------------------------------

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export const QUEUE_NAME = 'notifications';

export const queueConnection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const notificationQueue = new Queue(QUEUE_NAME, { connection: queueConnection });

/**
 * Enqueue a notification job.
 * @param {object} args
 * @param {string} args.type      job type, e.g. 'booking.confirmation'
 * @param {object} args.payload   data the worker needs
 * @param {string} [args.dedupeId] optional BullMQ jobId for idempotent enqueue
 */
export async function enqueueNotification({ type, payload, dedupeId }) {
  try {
    await notificationQueue.add(
      type,
      { type, ...payload },
      {
        ...(dedupeId ? { jobId: dedupeId } : {}),
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  } catch (err) {
    // Non-fatal (Part VIII): the outbox row stays pending and the relay retries.
    logger.error({ err: err.message, type }, 'failed to enqueue notification');
  }
}

export async function closeQueue() {
  try {
    await notificationQueue.close();
    await queueConnection.quit();
  } catch {
    /* already closed */
  }
}
