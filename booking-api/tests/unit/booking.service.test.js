// ---------------------------------------------------------------------------
// UNIT TEST — service in isolation  (Phase 1 → Part XI unit tests; Part V)
//
// This tests the booking service's BUSINESS LOGIC with every dependency mocked:
// no database, no Redis, no queue. That's only possible because of the layering
// from Part V — the service depends on repository/infra FUNCTIONS, which we
// replace with fakes here. We're testing decisions (ownership rules, error
// mapping), not plumbing.
//
// We mock by the module's absolute URL so any import of that file — however it's
// specified elsewhere — resolves to our fake.
// Run with: node --test --experimental-test-module-mocks tests/unit/
// ---------------------------------------------------------------------------

import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const src = new URL('../../src/', import.meta.url);
const url = (p) => new URL(p, src).href;

// Mutable fakes the tests can steer per-case.
let bookingRows;

before(() => {
  // db layer: withTransaction just runs the callback with a stand-in session
  // (the repositories below are fully mocked, so nothing touches a database).
  mock.module(url('db/index.js'), {
    namedExports: {
      withTransaction: async (fn) => fn({}),
      closeDb: async () => {},
    },
  });
  // outbox repo: recording an event is a no-op in unit tests.
  mock.module(url('repositories/outbox.repository.js'), {
    namedExports: { insertEvent: async () => ({}) },
  });
  // availability repo: no windows in unit tests (rules validator treats as open).
  mock.module(url('repositories/availability.repository.js'), {
    namedExports: { listByResource: async () => [] },
  });
  // Resource repo: pretend resource 1 exists and is active.
  mock.module(url('repositories/resource.repository.js'), {
    namedExports: {
      findResourceById: async (id) =>
        String(id) === '1' ? { id: '1', is_active: true } : null,
    },
  });
  // audit repo: no-op in unit tests.
  mock.module(url('repositories/booking-audit.repository.js'), {
    namedExports: { insertAudit: async () => {}, listByBooking: async () => [] },
  });
  // Booking repo: driven by `bookingRows`.
  mock.module(url('repositories/booking.repository.js'), {
    namedExports: {
      lockResourceForBooking: async () => ({
        id: '1',
        capacity: 1,
        buffer_minutes: 0,
        is_active: true,
      }),
      countOverlappingActive: async () => 0, // capacity available
      updateStatus: async (id, toStatus, fromStatus) => {
        const row = bookingRows.byId[String(id)];
        if (!row || row.status !== fromStatus) return null;
        return { ...row, status: toStatus };
      },
      insertBooking: async ({ resourceId, userId, startsAt, endsAt }) => ({
        id: '100',
        resource_id: String(resourceId),
        user_id: String(userId),
        starts_at: startsAt,
        ends_at: endsAt,
        status: 'confirmed',
        created_at: '2026-01-01 00:00:00',
        updated_at: '2026-01-01 00:00:00',
      }),
      findBookingById: async (id) => bookingRows.byId[String(id)] ?? null,
      cancelBooking: async (id) => {
        const row = bookingRows.byId[String(id)];
        if (!row || row.status !== 'confirmed') return null;
        return { ...row, status: 'cancelled' };
      },
    },
  });
});

beforeEach(() => {
  bookingRows = {
    byId: {
      5: {
        id: '5',
        resource_id: '1',
        user_id: '42',
        starts_at: '2026-09-10 09:00:00',
        ends_at: '2026-09-10 10:00:00',
        status: 'confirmed',
        created_at: '2026-01-01 00:00:00',
        updated_at: '2026-01-01 00:00:00',
      },
    },
  };
});

test('createBooking returns a confirmed DTO', async () => {
  const service = await import(url('services/booking.service.js'));
  const booking = await service.createBooking({
    resourceId: 1,
    userId: 42,
    startsAt: '2026-09-10 11:00:00',
    endsAt: '2026-09-10 12:00:00',
  });
  assert.equal(booking.status, 'confirmed');
  assert.equal(booking.resourceId, '1');
  assert.equal(booking.userId, '42');
});

test('createBooking rejects a nonexistent resource with NotFound (404)', async () => {
  const service = await import(url('services/booking.service.js'));
  await assert.rejects(
    () =>
      service.createBooking({
        resourceId: 999,
        userId: 42,
        startsAt: '2026-09-10 11:00:00',
        endsAt: '2026-09-10 12:00:00',
      }),
    (err) => err.statusCode === 404,
  );
});

test('owner can cancel their own booking', async () => {
  const service = await import(url('services/booking.service.js'));
  const result = await service.cancelBooking({
    bookingId: 5,
    requester: { id: '42', role: 'customer' },
  });
  assert.equal(result.status, 'cancelled');
});

test('a different customer cannot cancel — Forbidden (403)', async () => {
  const service = await import(url('services/booking.service.js'));
  await assert.rejects(
    () =>
      service.cancelBooking({
        bookingId: 5,
        requester: { id: '99', role: 'customer' },
      }),
    (err) => err.statusCode === 403,
  );
});

test('staff can cancel anyone’s booking', async () => {
  const service = await import(url('services/booking.service.js'));
  const result = await service.cancelBooking({
    bookingId: 5,
    requester: { id: '99', role: 'admin' },
  });
  assert.equal(result.status, 'cancelled');
});
