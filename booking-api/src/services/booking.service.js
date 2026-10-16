// ---------------------------------------------------------------------------
// BOOKING SERVICE  (Part V; V2.3 outbox; V2.6 rules; V2.7 capacity;
//                   V2.8 state machine + reschedule + audit)
// ---------------------------------------------------------------------------

import { withTransaction } from '../db/index.js';
import * as bookingRepo from '../repositories/booking.repository.js';
import * as resourceRepo from '../repositories/resource.repository.js';
import * as outboxRepo from '../repositories/outbox.repository.js';
import * as availabilityRepo from '../repositories/availability.repository.js';
import * as auditRepo from '../repositories/booking-audit.repository.js';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from '../errors/app-error.js';
import { validateBookingAgainstRules } from '../utils/booking-rules.js';
import { assertTransition, ACTIVE_STATES } from '../utils/booking-state.js';
import { encodeCursor, decodeCursor } from '../utils/cursor.js';
import { isStaff, ownsResource, assertCanManageResource } from '../utils/access.js';
import { bookingsCreatedTotal, bookingConflictsTotal } from '../observability/metrics.js';

export function toBookingDTO(row) {
  return {
    id: row.id,
    resourceId: row.resource_id,
    userId: row.user_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    // V3: present on list endpoints that join the calendar and its provider.
    ...(row.resource_name !== undefined && { resourceName: row.resource_name }),
    ...(row.provider_name !== undefined && {
      providerName: row.provider_name,
      providerSlug: row.provider_slug,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const isOwner = (row, r) => String(row.user_id) === String(r.id);

/** V3: staff, or the provider who owns the booking's calendar. */
async function canManageBooking(row, requester) {
  if (isStaff(requester)) return true;
  if (requester?.role !== 'provider') return false;
  const resource = await resourceRepo.findResourceById(row.resource_id);
  return ownsResource(requester, resource);
}

export async function createBooking({ resourceId, userId, startsAt, endsAt }) {
  const resource = await resourceRepo.findResourceById(resourceId);
  if (!resource) throw new NotFoundError(`Resource ${resourceId} not found`);
  if (!resource.is_active) {
    throw new ValidationError('That resource is not available for booking');
  }

  const windows = await availabilityRepo.listByResource(resourceId);
  validateBookingAgainstRules({ resource, windows, startsAt, endsAt });

  return withTransaction(async (session) => {
    const locked = await bookingRepo.lockResourceForBooking(session, resourceId);
    if (!locked) throw new NotFoundError(`Resource ${resourceId} not found`);
    if (!locked.is_active)
      throw new ValidationError('That resource is not available for booking');

    const overlapping = await bookingRepo.countOverlappingActive(session, {
      resourceId,
      startsAt,
      endsAt,
      bufferMinutes: locked.buffer_minutes,
    });
    if (overlapping >= locked.capacity) {
      bookingConflictsTotal.inc(); // V2.11: contention is a business signal
      throw new ConflictError('No capacity available for the requested time');
    }

    const row = await bookingRepo.insertBooking(
      { resourceId, userId, startsAt, endsAt, bufferMinutes: locked.buffer_minutes },
      session,
    );
    bookingsCreatedTotal.inc();
    const booking = toBookingDTO(row);

    await auditRepo.insertAudit(
      {
        bookingId: booking.id,
        actorUserId: userId,
        action: 'created',
        toStatus: booking.status,
      },
      session,
    );
    await outboxRepo.insertEvent(
      {
        aggregateType: 'booking',
        aggregateId: booking.id,
        eventType: 'booking.created',
        payload: booking,
      },
      session,
    );
    return booking;
  });
}

// V2.10: cursor-paginated listing. Returns an opaque `nextCursor` the client
// passes back to get the following page.
export async function listMyBookingsCursor({ userId, limit, status, cursor }) {
  const decoded = cursor ? decodeCursor(cursor) : null;
  const { rows, hasMore } = await bookingRepo.listBookingsByUserCursor({
    userId,
    limit,
    status,
    cursor: decoded,
  });
  const items = rows.map(toBookingDTO);
  const last = rows[rows.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ k: last.starts_at, i: last.id }) : null,
  };
}

export async function listMyBookings({ userId, limit, offset, status }) {
  const { rows, total } = await bookingRepo.listBookingsByUser({
    userId,
    limit,
    offset,
    status,
  });
  return { items: rows.map(toBookingDTO), total };
}

// --- V2.8 generic state transition ---
export async function transitionBooking({ bookingId, requester, toStatus, action }) {
  const existing = await bookingRepo.findBookingById(bookingId);
  if (!existing) throw new NotFoundError(`Booking ${bookingId} not found`);

  // Authorization: the client who booked may cancel; everything else
  // (complete/no_show/confirm) belongs to staff or the calendar's provider (V3).
  if (toStatus === 'cancelled') {
    if (!isOwner(existing, requester) && !(await canManageBooking(existing, requester))) {
      throw new ForbiddenError('You can only cancel your own bookings');
    }
  } else if (!(await canManageBooking(existing, requester))) {
    throw new ForbiddenError('Only the provider or staff can perform this action');
  }

  // Reject illegal transitions (e.g. cancel an already-completed booking).
  assertTransition(existing.status, toStatus);

  const booking = await withTransaction(async (session) => {
    const row = await bookingRepo.updateStatus(bookingId, toStatus, existing.status, session);
    if (!row) throw new ConflictError('Booking changed concurrently — please retry');
    const dto = toBookingDTO(row);

    await auditRepo.insertAudit(
      { bookingId, actorUserId: requester.id, action, fromStatus: existing.status, toStatus },
      session,
    );
    // Freeing a slot (cancel) matters to live availability views.
    if (toStatus === 'cancelled') {
      await outboxRepo.insertEvent(
        {
          aggregateType: 'booking',
          aggregateId: dto.id,
          eventType: 'booking.cancelled',
          payload: dto,
        },
        session,
      );
    }
    return dto;
  });
  return booking;
}

export const cancelBooking = ({ bookingId, requester }) =>
  transitionBooking({ bookingId, requester, toStatus: 'cancelled', action: 'cancelled' });
export const completeBooking = ({ bookingId, requester }) =>
  transitionBooking({ bookingId, requester, toStatus: 'completed', action: 'completed' });
export const markNoShow = ({ bookingId, requester }) =>
  transitionBooking({ bookingId, requester, toStatus: 'no_show', action: 'no_show' });
export const confirmBooking = ({ bookingId, requester }) =>
  transitionBooking({ bookingId, requester, toStatus: 'confirmed', action: 'confirmed' });

// --- V2.8 reschedule ---
export async function rescheduleBooking({ bookingId, requester, startsAt, endsAt }) {
  const existing = await bookingRepo.findBookingById(bookingId);
  if (!existing) throw new NotFoundError(`Booking ${bookingId} not found`);
  if (!isOwner(existing, requester) && !(await canManageBooking(existing, requester))) {
    throw new ForbiddenError('You can only reschedule your own bookings');
  }
  if (!ACTIVE_STATES.includes(existing.status)) {
    throw new ValidationError(`Cannot reschedule a ${existing.status} booking`);
  }

  const resource = await resourceRepo.findResourceById(existing.resource_id);
  if (!resource) throw new NotFoundError('Resource not found');
  const windows = await availabilityRepo.listByResource(resource.id);
  validateBookingAgainstRules({ resource, windows, startsAt, endsAt });

  return withTransaction(async (session) => {
    const locked = await bookingRepo.lockResourceForBooking(session, resource.id);

    // Capacity check EXCLUDING this booking (it's moving, not adding).
    const overlapping = await bookingRepo.countOverlappingActive(session, {
      resourceId: resource.id,
      startsAt,
      endsAt,
      bufferMinutes: locked.buffer_minutes,
      excludeBookingId: bookingId,
    });
    if (overlapping >= locked.capacity) {
      throw new ConflictError('No capacity available for the requested time');
    }

    const row = await bookingRepo.reschedule(bookingId, startsAt, endsAt, session);
    const dto = toBookingDTO(row);

    await auditRepo.insertAudit(
      {
        bookingId,
        actorUserId: requester.id,
        action: 'rescheduled',
        fromStatus: existing.status,
        toStatus: existing.status,
        details: {
          from: { startsAt: existing.starts_at, endsAt: existing.ends_at },
          to: { startsAt, endsAt },
        },
      },
      session,
    );
    await outboxRepo.insertEvent(
      {
        aggregateType: 'booking',
        aggregateId: dto.id,
        eventType: 'booking.rescheduled',
        payload: dto,
      },
      session,
    );
    return dto;
  });
}

// --- V2.8 audit history ---
export async function listAudit({ bookingId, requester }) {
  const existing = await bookingRepo.findBookingById(bookingId);
  if (!existing) throw new NotFoundError(`Booking ${bookingId} not found`);
  if (!isOwner(existing, requester) && !(await canManageBooking(existing, requester))) {
    throw new ForbiddenError("You cannot view this booking's history");
  }
  const rows = await auditRepo.listByBooking(bookingId);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    actorUserId: r.actor_user_id,
    details: r.details,
    at: r.created_at,
  }));
}

// --- Frontend support: day schedule & staff day view -----------------------

function dayOfWeek(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // local, 0 = Sunday (matches availability_windows)
}

/**
 * PUBLIC: what's taken on a resource for one day, so a client can show
 * availability before attempting a booking. Deliberately exposes only time
 * intervals — never who booked them. The server's capacity check (V2.7) stays
 * authoritative; this is for display.
 */
export async function getResourceSchedule(resourceId, date) {
  const resource = await resourceRepo.findResourceById(resourceId);
  if (!resource) throw new NotFoundError(`Resource ${resourceId} not found`);
  const dow = dayOfWeek(date);
  const [windows, rows] = await Promise.all([
    availabilityRepo.listByResource(resourceId),
    bookingRepo.listByResourceAndDay(resourceId, date, { activeOnly: true }),
  ]);
  return {
    date,
    dayOfWeek: dow,
    capacity: resource.capacity,
    bufferMinutes: resource.buffer_minutes,
    // hasWindows=false means "no opening hours configured" = always open.
    hasWindows: windows.length > 0,
    windows: windows
      .filter((w) => w.day_of_week === dow)
      .map((w) => ({ opensAt: w.opens_at.slice(0, 5), closesAt: w.closes_at.slice(0, 5) })),
    bookings: rows.map((r) => ({ startsAt: r.starts_at, endsAt: r.ends_at })),
  };
}

/** STAFF or the owning PROVIDER: every booking (any status) on a calendar for one day. */
export async function listResourceBookingsForDay(resourceId, date, requester) {
  const resource = await resourceRepo.findResourceById(resourceId);
  if (!resource) throw new NotFoundError(`Resource ${resourceId} not found`);
  assertCanManageResource(requester, resource);
  const rows = await bookingRepo.listByResourceAndDay(resourceId, date);
  return rows.map((r) => ({ ...toBookingDTO(r), userEmail: r.user_email }));
}
