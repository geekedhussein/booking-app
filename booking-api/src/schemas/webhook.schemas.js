// ---------------------------------------------------------------------------
// WEBHOOK SCHEMAS  (V2.10)
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { objectIdSchema } from './common.schemas.js';

export const EVENT_TYPES = [
  'booking.created',
  'booking.cancelled',
  'booking.rescheduled',
  'booking.reminder',
];

export const createWebhookBody = z
  .object({
    // Must be an absolute http(s) URL — we POST to it.
    url: z.string().url().max(2000),
    // Empty = subscribe to everything.
    eventTypes: z.array(z.enum(EVENT_TYPES)).max(20).default([]),
  })
  .strict();

export const webhookIdParam = z.object({
  id: objectIdSchema,
});
