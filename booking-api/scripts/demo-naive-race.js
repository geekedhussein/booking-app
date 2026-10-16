// ---------------------------------------------------------------------------
// DEMO ONLY (not part of the app): why the booking service locks the calendar.
//
// Part 1 books a capacity-1 calendar the NAIVE way: count the overlapping
// bookings, and if there are none, insert. Six requests run at once. Each one
// counts zero before any of them has inserted, so all six insert: a classic
// check-then-act race (Part IX, concurrency).
//
// Part 2 sends the same six requests through bookingService.createBooking,
// which first writes to the calendar document inside a transaction. MongoDB lets
// only one open transaction modify a document, so the others conflict, are
// retried after the first commits, and then see its booking: exactly one wins.
//
// It creates its own demo user and calendars, and removes them afterwards.
// Usage:  node --env-file=.env scripts/demo-naive-race.js
// ---------------------------------------------------------------------------

import { col, closeDb } from '../src/db/index.js';
import * as bookingService from '../src/services/booking.service.js';
import { closeQueue } from '../src/queue/notifications.js';
import { closePubSub } from '../src/realtime/pubsub.js';

const START = '2030-01-15 15:00:00';
const END = '2030-01-15 16:00:00';
const now = new Date();

async function makeCalendar(name) {
  const { insertedId } = await col('resources').insertOne({
    name,
    capacity: 1,
    is_active: true,
    min_duration_minutes: 0,
    max_duration_minutes: null,
    lead_time_minutes: 0,
    buffer_minutes: 0,
    provider_id: null,
    opening_hours: [],
    lock_version: 0,
    created_at: now,
    updated_at: now,
  });
  return insertedId;
}

const { insertedId: userId } = await col('users').insertOne({
  email: `race-${Date.now()}@example.com`,
  password_hash: 'not-a-real-hash',
  role: 'customer',
  email_verified: false,
  failed_login_attempts: 0,
  locked_until: null,
  created_at: now,
  updated_at: now,
});
const naiveCalendar = await makeCalendar('Race demo (naive)');
const lockedCalendar = await makeCalendar('Race demo (locked)');

async function naiveBook(label) {
  const n = await col('bookings').countDocuments({
    resource_id: naiveCalendar,
    status: { $in: ['pending', 'confirmed'] },
    starts_at: { $lt: END },
    blocked_until: { $gt: START },
  });
  console.log(
    `  [${label}] saw ${n} overlapping booking(s) → ${n === 0 ? 'inserting' : 'giving up'}`,
  );
  if (n > 0) return 'rejected';
  await new Promise((resolve) => {
    setTimeout(resolve, 100); // widen the race window, as real latency would
  });
  await col('bookings').insertOne({
    resource_id: naiveCalendar,
    user_id: userId,
    starts_at: START,
    ends_at: END,
    blocked_until: END,
    buffer_minutes: 0,
    status: 'confirmed',
    reminder_sent_at: null,
    history: [],
    created_at: now,
    updated_at: now,
  });
  return 'inserted';
}

try {
  console.log('Part 1 — naive check-then-insert, 6 concurrent requests:');
  await Promise.all(['A', 'B', 'C', 'D', 'E', 'F'].map(naiveBook));
  const naive = await col('bookings').countDocuments({ resource_id: naiveCalendar });
  console.log(
    `  → ${naive} bookings for a capacity-1 calendar ${naive > 1 ? '(OVERBOOKED)' : ''}\n`,
  );

  console.log(
    'Part 2 — bookingService.createBooking (locked transaction), 6 concurrent requests:',
  );
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      bookingService.createBooking({
        resourceId: lockedCalendar.toHexString(),
        userId: userId.toHexString(),
        startsAt: START,
        endsAt: END,
      }),
    ),
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const refused = results.filter(
    (r) => r.status === 'rejected' && r.reason.statusCode === 409,
  ).length;
  const locked = await col('bookings').countDocuments({ resource_id: lockedCalendar });
  console.log(
    `  → ${ok} created, ${refused} refused with 409; ${locked} booking in the database`,
  );
} finally {
  await col('bookings').deleteMany({ resource_id: { $in: [naiveCalendar, lockedCalendar] } });
  await col('outbox').deleteMany({
    aggregate_type: 'booking',
    'payload.userId': userId.toHexString(),
  });
  await col('resources').deleteMany({ _id: { $in: [naiveCalendar, lockedCalendar] } });
  await col('users').deleteOne({ _id: userId });
  await Promise.allSettled([closeQueue(), closePubSub(), closeDb()]);
}
