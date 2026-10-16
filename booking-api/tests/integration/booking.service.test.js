// ---------------------------------------------------------------------------
// INTEGRATION TEST — booking service + real MongoDB
//
// Capacity is enforced by the SERVICE (a transaction that first writes to the
// calendar document, then counts), so these tests run bookingService against a
// real database: the layer where the invariant actually lives. The concurrency
// test is the proof that matters: many simultaneous requests for the last
// places must never overbook.
//
// Needs a MongoDB replica set (transactions) and a migrated test database.
// Run with: node --env-file=.env.test --test tests/integration/*.test.js
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { col, closeDb } from '../../src/db/index.js';
import { closeQueue } from '../../src/queue/notifications.js';
import { closePubSub } from '../../src/realtime/pubsub.js';
import * as bookingService from '../../src/services/booking.service.js';
import * as outboxRepo from '../../src/repositories/outbox.repository.js';
import * as idempotencyRepo from '../../src/repositories/idempotency.repository.js';

let userId;
const ids = {};

async function makeResource(name, extra = {}) {
  const now = new Date();
  const { insertedId } = await col('resources').insertOne({
    name,
    capacity: extra.capacity ?? 1,
    is_active: true,
    min_duration_minutes: 0,
    max_duration_minutes: null,
    lead_time_minutes: 0,
    buffer_minutes: extra.buffer ?? 0,
    provider_id: null,
    opening_hours: [],
    lock_version: 0,
    created_at: now,
    updated_at: now,
  });
  return insertedId.toHexString();
}

before(async () => {
  await Promise.all(
    ['users', 'resources', 'bookings', 'outbox', 'idempotency_keys'].map((c) =>
      col(c).deleteMany({}),
    ),
  );
  const now = new Date();
  const { insertedId } = await col('users').insertOne({
    email: 'svc@x.com',
    password_hash: 'h',
    role: 'customer',
    email_verified: false,
    failed_login_attempts: 0,
    locked_until: null,
    created_at: now,
    updated_at: now,
  });
  userId = insertedId.toHexString();
  ids.cap1 = await makeResource('Cap1');
  ids.cap2 = await makeResource('Cap2', { capacity: 2 });
  ids.cap3 = await makeResource('Cap3', { capacity: 3 });
  ids.buffered = await makeResource('Buffered', { buffer: 15 });
});

beforeEach(async () => {
  await col('bookings').deleteMany({});
  await col('outbox').deleteMany({});
});

after(async () => {
  await col('bookings').deleteMany({});
  await Promise.allSettled([closeQueue(), closePubSub(), closeDb()]);
});

const book = (resourceId, startsAt, endsAt) =>
  bookingService.createBooking({ resourceId, userId, startsAt, endsAt });

test('creates a confirmed booking; stores local wall-clock time', async () => {
  const b = await book(ids.cap1, '2026-10-05 09:00:00', '2026-10-05 10:00:00');
  assert.equal(b.status, 'confirmed');
  assert.equal(b.startsAt, '2026-10-05 09:00:00');
});

test('capacity 1: an overlapping booking is rejected (409)', async () => {
  await book(ids.cap1, '2026-10-05 09:00:00', '2026-10-05 10:00:00');
  await assert.rejects(
    () => book(ids.cap1, '2026-10-05 09:30:00', '2026-10-05 10:30:00'),
    (err) => err.statusCode === 409,
  );
});

test('capacity 1: back-to-back bookings are allowed', async () => {
  await book(ids.cap1, '2026-10-05 09:00:00', '2026-10-05 10:00:00');
  const second = await book(ids.cap1, '2026-10-05 10:00:00', '2026-10-05 11:00:00');
  assert.equal(second.status, 'confirmed');
});

test('capacity 2: two overlap, third is rejected', async () => {
  await book(ids.cap2, '2026-10-05 12:00:00', '2026-10-05 13:00:00');
  await book(ids.cap2, '2026-10-05 12:00:00', '2026-10-05 13:00:00');
  await assert.rejects(
    () => book(ids.cap2, '2026-10-05 12:00:00', '2026-10-05 13:00:00'),
    (err) => err.statusCode === 409,
  );
});

test('buffer: a booking within the buffer gap is rejected, outside is allowed', async () => {
  await book(ids.buffered, '2026-10-05 09:00:00', '2026-10-05 10:00:00');
  await assert.rejects(
    () => book(ids.buffered, '2026-10-05 10:00:00', '2026-10-05 10:30:00'), // 0-min gap
    (err) => err.statusCode === 409,
  );
  const ok = await book(ids.buffered, '2026-10-05 10:15:00', '2026-10-05 10:45:00'); // 15-min gap
  assert.equal(ok.status, 'confirmed');
});

test('reschedule moves the booking and frees the old slot', async () => {
  const owner = { id: userId, role: 'customer' };
  const b = await book(ids.cap1, '2026-10-06 09:00:00', '2026-10-06 10:00:00');
  const moved = await bookingService.rescheduleBooking({
    bookingId: b.id,
    requester: owner,
    startsAt: '2026-10-06 14:00:00',
    endsAt: '2026-10-06 15:00:00',
  });
  assert.equal(moved.startsAt, '2026-10-06 14:00:00');
  // Old slot is now free → a new booking there succeeds.
  const reuse = await book(ids.cap1, '2026-10-06 09:00:00', '2026-10-06 10:00:00');
  assert.equal(reuse.status, 'confirmed');
});

test('state machine: cannot cancel a completed booking', async () => {
  const staff = { id: userId, role: 'staff' };
  const b = await book(ids.cap1, '2026-10-07 09:00:00', '2026-10-07 10:00:00');
  await bookingService.completeBooking({ bookingId: b.id, requester: staff });
  await assert.rejects(
    () => bookingService.cancelBooking({ bookingId: b.id, requester: staff }),
    (err) => err.statusCode === 400,
  );
});

test('audit trail records the lifecycle', async () => {
  const staff = { id: userId, role: 'staff' };
  const b = await book(ids.cap1, '2026-10-08 09:00:00', '2026-10-08 10:00:00');
  await bookingService.completeBooking({ bookingId: b.id, requester: staff });
  const history = await bookingService.listAudit({ bookingId: b.id, requester: staff });
  const actions = history.map((h) => h.action);
  assert.deepEqual(actions, ['created', 'completed']);
});

test('concurrency: 40 simultaneous requests for a capacity-3 slot create exactly 3', async () => {
  const attempts = Array.from({ length: 40 }, () =>
    book(ids.cap3, '2026-11-02 09:00:00', '2026-11-02 10:00:00'),
  );
  const results = await Promise.allSettled(attempts);
  const created = results.filter((r) => r.status === 'fulfilled').length;
  const conflicts = results.filter(
    (r) => r.status === 'rejected' && r.reason.statusCode === 409,
  ).length;
  assert.equal(created, 3, `expected 3 bookings, got ${created}`);
  assert.equal(conflicts, 37);
  assert.equal(await col('bookings').countDocuments({ starts_at: '2026-11-02 09:00:00' }), 3);
});

test('outbox: a booking and its event are written together', async () => {
  const b = await book(ids.cap1, '2026-11-03 09:00:00', '2026-11-03 10:00:00');
  const events = await col('outbox').find({ aggregate_id: b.id }).toArray();
  assert.deepEqual(
    events.map((e) => e.event_type),
    ['booking.created'],
  );
});

test('outbox: two relays claiming at once never take the same event', async () => {
  for (let i = 0; i < 20; i += 1) {
    await outboxRepo.insertEvent({
      aggregateType: 'test',
      aggregateId: i,
      eventType: 'test.event',
      payload: { i },
    });
  }
  const [a, b] = await Promise.all([
    outboxRepo.claimDueBatch(15, 60_000),
    outboxRepo.claimDueBatch(15, 60_000),
  ]);
  const claimedIds = [...a, ...b].map((e) => e.id);
  assert.equal(claimedIds.length, 20, 'every event claimed once');
  assert.equal(new Set(claimedIds).size, 20, 'no event claimed twice');
  // Leased events aren't handed out again until the lease runs out.
  assert.equal((await outboxRepo.claimDueBatch(10, 60_000)).length, 0);
});

test('idempotency: concurrent claims of one key — exactly one wins', async () => {
  const claims = await Promise.all(
    Array.from({ length: 10 }, () =>
      idempotencyRepo.claimKey({ userId, key: 'same-key', requestHash: 'h' }),
    ),
  );
  assert.equal(claims.filter((c) => c.claimed).length, 1);
  await idempotencyRepo.releaseKey({ userId, key: 'same-key' });
});
