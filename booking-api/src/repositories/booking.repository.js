// ---------------------------------------------------------------------------
// BOOKING REPOSITORY  (Part V repository; Part VI transactions; Part IX concurrency)
//
// The only file that knows how bookings are stored. Capacity is enforced by the
// SERVICE, inside a transaction, with two functions from here:
//
//   1. lockResourceForBooking: write to the calendar's document first. MongoDB
//      lets only one open transaction modify a document; a second transaction
//      that tries gets a WriteConflict, is aborted, and is retried from the top
//      by withTransaction() once the first has committed. So every booking
//      transaction on one calendar runs one after another, while different
//      calendars don't contend. (PostgreSQL did this with SELECT … FOR UPDATE.)
//   2. countOverlappingActive: count active bookings that clash, in the same
//      transaction. Because of step 1, no concurrent insert can slip in between
//      this count and the insert that follows (no "phantom").
// ---------------------------------------------------------------------------

import { col, oid, toRow, localString, addMinutesLocal } from '../db/index.js';

const bookings = () => col('bookings');
const ACTIVE = ['pending', 'confirmed']; // the statuses that take up capacity
const NO_HISTORY = { projection: { history: 0 } };

export async function insertBooking(
  { resourceId, userId, startsAt, endsAt, bufferMinutes = 0 },
  session,
) {
  const now = new Date();
  const doc = {
    resource_id: oid(resourceId),
    user_id: oid(userId),
    starts_at: startsAt,
    ends_at: endsAt,
    // The calendar stays blocked until the end plus its turnover buffer. Stored,
    // so the overlap query is a plain comparison of fixed-width strings.
    blocked_until: addMinutesLocal(endsAt, bufferMinutes),
    buffer_minutes: bufferMinutes,
    status: 'confirmed',
    reminder_sent_at: null,
    history: [],
    created_at: now,
    updated_at: now,
  };
  const { insertedId } = await bookings().insertOne(doc, { session });
  const { history: _h, ...row } = doc;
  return toRow({ _id: insertedId, ...row });
}

export async function findBookingById(id) {
  const _id = oid(id);
  return _id ? toRow(await bookings().findOne({ _id }, NO_HISTORY)) : null;
}

/**
 * Serialize booking transactions per calendar (see the header). Bumps the
 * calendar's lock_version inside the caller's transaction and returns what the
 * capacity check needs. Returns null if the calendar doesn't exist.
 */
export async function lockResourceForBooking(session, resourceId) {
  const doc = await col('resources').findOneAndUpdate(
    { _id: oid(resourceId) },
    { $inc: { lock_version: 1 } },
    {
      session,
      returnDocument: 'after',
      projection: { capacity: 1, buffer_minutes: 1, is_active: 1 },
    },
  );
  return toRow(doc);
}

/**
 * Count ACTIVE bookings whose blocked range overlaps the requested one.
 * Two half-open ranges [a, b) and [c, d) overlap when a < d and c < b. Here the
 * existing range is [starts_at, blocked_until) and the new one is
 * [startsAt, endsAt + buffer). `excludeBookingId` lets a reschedule skip the
 * booking being moved. Runs inside the calendar-locked transaction.
 */
export async function countOverlappingActive(
  session,
  { resourceId, startsAt, endsAt, bufferMinutes, excludeBookingId = null },
) {
  const filter = {
    resource_id: oid(resourceId),
    status: { $in: ACTIVE },
    starts_at: { $lt: addMinutesLocal(endsAt, bufferMinutes) },
    blocked_until: { $gt: startsAt },
  };
  if (excludeBookingId) filter._id = { $ne: oid(excludeBookingId) };
  return bookings().countDocuments(filter, { session });
}

/**
 * Change status only if the booking is still in `fromStatus` (an optimistic
 * guard): if someone else changed it first, nothing matches and null comes back,
 * which the service treats as a concurrent change.
 */
export async function updateStatus(id, toStatus, fromStatus, session) {
  const doc = await bookings().findOneAndUpdate(
    { _id: oid(id), status: fromStatus },
    { $set: { status: toStatus }, $currentDate: { updated_at: true } },
    { session, returnDocument: 'after', projection: { history: 0 } },
  );
  return toRow(doc);
}

/**
 * Atomically CLAIM bookings due for a reminder. Each findOneAndUpdate matches a
 * booking whose reminder_sent_at is still null and sets it in the same step, so
 * with several schedulers running, each booking is claimed by exactly one.
 * Claiming and marking are one operation: no window for a double send.
 */
export async function claimBookingsDueForReminder({ leadHours, limit }, session) {
  const now = new Date();
  const horizon = new Date(now.getTime() + leadHours * 3_600_000);
  const claimed = [];
  for (let i = 0; i < limit; i += 1) {
    const doc = await bookings().findOneAndUpdate(
      {
        reminder_sent_at: null,
        status: { $in: ACTIVE },
        starts_at: { $gt: localString(now), $lte: localString(horizon) },
      },
      { $set: { reminder_sent_at: now } },
      { session, sort: { starts_at: 1 }, returnDocument: 'after', projection: { history: 0 } },
    );
    if (!doc) break;
    claimed.push(toRow(doc));
  }
  return claimed;
}

/** Move a booking to a new time (capacity and rules are checked by the caller). */
export async function reschedule(id, startsAt, endsAt, session) {
  const _id = oid(id);
  const current = await bookings().findOne(
    { _id },
    { session, projection: { buffer_minutes: 1 } },
  );
  if (!current) return null;
  const doc = await bookings().findOneAndUpdate(
    { _id },
    {
      $set: {
        starts_at: startsAt,
        ends_at: endsAt,
        // Keep the turnover recorded when the booking was made.
        blocked_until: addMinutesLocal(endsAt, current.buffer_minutes ?? 0),
      },
      $currentDate: { updated_at: true },
    },
    { session, returnDocument: 'after', projection: { history: 0 } },
  );
  return toRow(doc);
}

// The calendar's name and its provider, joined in for lists that show them.
const WITH_NAMES = [
  { $lookup: { from: 'resources', localField: 'resource_id', foreignField: '_id', as: 'r' } },
  {
    $lookup: { from: 'providers', localField: 'r.provider_id', foreignField: '_id', as: 'p' },
  },
  {
    $set: {
      resource_name: { $first: '$r.name' },
      provider_name: { $ifNull: [{ $first: '$p.display_name' }, null] },
      provider_slug: { $ifNull: [{ $first: '$p.slug' }, null] },
    },
  },
  { $project: { r: 0, p: 0, history: 0 } },
];

/** Offset pagination (kept for clients that ask for page numbers). */
export async function listBookingsByUser({ userId, limit, offset, status }) {
  const filter = { user_id: oid(userId) };
  if (status) filter.status = status;
  const docs = await bookings()
    .aggregate([
      { $match: filter },
      { $sort: { starts_at: -1, _id: -1 } },
      { $skip: offset },
      { $limit: limit },
      ...WITH_NAMES,
    ])
    .toArray();
  const total = await bookings().countDocuments(filter);
  return { rows: docs.map(toRow), total };
}

/**
 * CURSOR (keyset) pagination. Instead of skipping N documents (which makes the
 * database walk and discard them, and shifts results under concurrent inserts),
 * ask for "documents after this (starts_at, _id)". The compound index
 * (user_id, starts_at desc, _id desc) serves it directly, and pages stay stable.
 */
export async function listBookingsByUserCursor({ userId, limit, status, cursor }) {
  const filter = { user_id: oid(userId) };
  if (status) filter.status = status;
  const cursorId = cursor ? oid(cursor.i) : null;
  if (cursor && cursorId) {
    // Strictly "before" the cursor in (starts_at DESC, _id DESC) order.
    filter.$or = [
      { starts_at: { $lt: cursor.k } },
      { starts_at: cursor.k, _id: { $lt: cursorId } },
    ];
  }
  // Fetch one extra to know whether another page exists.
  const docs = await bookings()
    .aggregate([
      { $match: filter },
      { $sort: { starts_at: -1, _id: -1 } },
      { $limit: limit + 1 },
      ...WITH_NAMES,
    ])
    .toArray();
  const hasMore = docs.length > limit;
  return { rows: (hasMore ? docs.slice(0, limit) : docs).map(toRow), hasMore };
}

/**
 * Bookings for one calendar on one local day, with the booker's email.
 * Bookings never cross midnight, so filtering on starts_at is enough.
 * activeOnly = pending/confirmed (what occupies capacity).
 */
export async function listByResourceAndDay(resourceId, date, { activeOnly = false } = {}) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + 1);
  const match = {
    resource_id: oid(resourceId),
    starts_at: { $gte: `${date} 00:00:00`, $lt: `${localString(next).slice(0, 10)} 00:00:00` },
  };
  if (activeOnly) match.status = { $in: ACTIVE };
  const docs = await bookings()
    .aggregate([
      { $match: match },
      { $sort: { starts_at: 1, _id: 1 } },
      { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'u' } },
      { $set: { user_email: { $first: '$u.email' } } },
      { $project: { u: 0, history: 0 } },
    ])
    .toArray();
  return docs.map(toRow);
}
