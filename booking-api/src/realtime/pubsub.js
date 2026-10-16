// ---------------------------------------------------------------------------
// PUB/SUB LAYER  (Phase 1 → Part X: pub/sub across instances)
//
// THE PROBLEM this solves: a WebSocket connection is held open by ONE specific
// server instance. If a booking is created on instance A, but the interested
// client is connected to instance B, A cannot talk to B's socket directly —
// different processes, maybe different machines (exactly the load-balancer
// situation from Part I).
//
// THE SOLUTION: every instance PUBLISHES booking events to a shared Redis
// channel, and every instance SUBSCRIBES to that channel. When any instance
// publishes, all instances receive it and fan it out to whichever of THEIR
// local sockets care. Redis is the shared coordination layer.
//
// Note: a Redis connection in "subscriber mode" cannot run normal commands, so
// the subscriber MUST be a separate connection from the publisher.
// ---------------------------------------------------------------------------

import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export const BOOKING_EVENTS_CHANNEL = 'booking-events';

// Publisher connection (used by the API to announce events).
const publisher = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

// Subscriber connection (used by the realtime layer to receive events). Separate
// by necessity.
const subscriber = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

/**
 * Publish a booking event to all instances. Non-fatal on failure (real-time is
 * an enhancement, not a correctness requirement — Part VIII degradation).
 * @param {{type: string, resourceId: (string|number), booking: object}} event
 */
export async function publishBookingEvent(event) {
  try {
    await publisher.publish(BOOKING_EVENTS_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.warn({ err: err.message }, 'failed to publish booking event');
  }
}

/**
 * Subscribe to booking events. `handler` is called with each parsed event on
 * THIS instance (regardless of which instance published it).
 */
export function onBookingEvent(handler) {
  subscriber.subscribe(BOOKING_EVENTS_CHANNEL, (err) => {
    if (err) {
      logger.error({ err: err.message }, 'failed to subscribe to booking events');
      return;
    }
    logger.info('subscribed to booking-events channel');
  });

  subscriber.on('message', (channel, message) => {
    if (channel !== BOOKING_EVENTS_CHANNEL) return;
    try {
      handler(JSON.parse(message));
    } catch (err) {
      logger.warn({ err: err.message }, 'bad booking event payload');
    }
  });
}

export async function closePubSub() {
  try {
    await publisher.quit();
    await subscriber.quit();
  } catch {
    /* already closed */
  }
}
