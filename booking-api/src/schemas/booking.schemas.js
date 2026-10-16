// ---------------------------------------------------------------------------
// BOOKING SCHEMAS  (Phase 1 → Part IV: type, semantic, relationship validation)
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { objectIdSchema } from './common.schemas.js';
import { parseLocalDateTime, isBefore } from '../utils/datetime.js';
import { config } from '../config/index.js';

// A reusable field: a string that must be a valid local date-time, normalized to
// canonical form. Uses transform+ctx to fail with a clear message (Part IV).
const localDateTime = z.string().transform((v, ctx) => {
  const canonical = parseLocalDateTime(v);
  if (!canonical) {
    ctx.addIssue({
      code: 'custom',
      message: 'Must be a valid local date-time, e.g. "2026-09-10 09:00"',
    });
    return z.NEVER;
  }
  return canonical;
});

// Current local wall-clock time as a canonical string (no timezone — matches how
// we store timestamps). Used only for comparison in the refinements below.
function nowLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// The latest allowed start, BOOKING_MAX_ADVANCE_DAYS from now.
function maxAdvance() {
  const d = new Date();
  d.setDate(d.getDate() + config.BOOKING_MAX_ADVANCE_DAYS);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const createBookingBody = z
  .object({
    resourceId: objectIdSchema,
    startsAt: localDateTime,
    endsAt: localDateTime,
  })
  .strict()
  // RELATIONSHIP validation (Part IV): two fields that must make sense together.
  // The DB has this CHECK too (defense in depth), but catching it here gives a
  // clean 400 with a helpful message instead of a DB error.
  .refine((b) => isBefore(b.startsAt, b.endsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
  // SEMANTIC validation (Part IV, V2.1): a well-formed time can still be
  // nonsensical. You cannot book in the past...
  .refine((b) => isBefore(nowLocal(), b.startsAt), {
    message: 'startsAt must be in the future',
    path: ['startsAt'],
  })
  // ...nor absurdly far ahead (abuse/typo guard).
  .refine((b) => isBefore(b.startsAt, maxAdvance()), {
    message: `startsAt must be within ${config.BOOKING_MAX_ADVANCE_DAYS} days`,
    path: ['startsAt'],
  });

export const bookingIdParam = z.object({
  id: objectIdSchema,
});

// V2.8: reschedule takes a new interval (same validation as creation, minus the
// resourceId — the booking already knows its resource).
export const rescheduleBookingBody = z
  .object({
    startsAt: localDateTime,
    endsAt: localDateTime,
  })
  .strict()
  .refine((b) => isBefore(b.startsAt, b.endsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
  .refine((b) => isBefore(nowLocal(), b.startsAt), {
    message: 'startsAt must be in the future',
    path: ['startsAt'],
  })
  .refine((b) => isBefore(b.startsAt, maxAdvance()), {
    message: `startsAt must be within ${config.BOOKING_MAX_ADVANCE_DAYS} days`,
    path: ['startsAt'],
  });

export const listBookingQuery = z
  .object({
    // V2.10: cursor pagination. `cursor` is opaque — pass back what the previous
    // response returned. `page` is retained for backward compatibility but
    // ignored when a cursor is supplied.
    cursor: z.string().max(500).optional(),
    // Opt into cursor mode on the FIRST page (later pages send `cursor`).
    paginate: z.enum(['cursor', 'offset']).optional(),
    page: z.coerce
      .number()
      .int()
      .default(1)
      .transform((v) => Math.max(v, 1)),
    limit: z.coerce
      .number()
      .int()
      .default(20)
      .transform((v) => Math.min(Math.max(v, 1), 100)),
    // filter by status; omitted = all
    status: z.enum(['confirmed', 'cancelled']).optional(),
  })
  .strict();
