// ---------------------------------------------------------------------------
// BOOKING HISTORY (AUDIT TRAIL)  (Part VIII observability of business events)
//
// Append-only. The history is EMBEDDED in each booking document as an array:
// entries are only ever appended ($push), read together with their booking,
// and stay few. insertAudit takes the caller's `session`, so the entry is
// written in the SAME transaction as the change it records: you can never have
// a change without its history entry, or the reverse.
// ---------------------------------------------------------------------------

import { ObjectId } from 'mongodb';
import { col, oid, localString } from '../db/index.js';

export async function insertAudit(
  {
    bookingId,
    actorUserId = null,
    action,
    fromStatus = null,
    toStatus = null,
    details = null,
  },
  session,
) {
  await col('bookings').updateOne(
    { _id: oid(bookingId) },
    {
      $push: {
        history: {
          _id: new ObjectId(),
          actor_user_id: actorUserId ? oid(actorUserId) : null,
          action,
          from_status: fromStatus,
          to_status: toStatus,
          details,
          created_at: new Date(),
        },
      },
    },
    { session },
  );
}

/** The booking's history, oldest first, as rows. */
export async function listByBooking(bookingId) {
  const doc = await col('bookings').findOne(
    { _id: oid(bookingId) },
    { projection: { history: 1 } },
  );
  return (doc?.history ?? []).map((h) => ({
    id: h._id.toHexString(),
    booking_id: String(bookingId),
    actor_user_id: h.actor_user_id ? h.actor_user_id.toHexString() : null,
    action: h.action,
    from_status: h.from_status,
    to_status: h.to_status,
    details: h.details,
    created_at: localString(h.created_at),
  }));
}
