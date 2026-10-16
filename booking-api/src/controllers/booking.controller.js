// ---------------------------------------------------------------------------
// BOOKING CONTROLLER  (Part V/II; V2.8 transitions, reschedule, audit)
// ---------------------------------------------------------------------------

import * as service from '../services/booking.service.js';

export async function create(req, res) {
  const booking = await service.createBooking({
    resourceId: req.validated.body.resourceId,
    startsAt: req.validated.body.startsAt,
    endsAt: req.validated.body.endsAt,
    userId: req.user.id, // from the token, not the body
  });
  res.status(201).location(`/bookings/${booking.id}`).json({ data: booking });
}

export async function listMine(req, res) {
  const { page, limit, status, cursor, paginate } = req.validated.query;

  // V2.10: cursor pagination is the preferred path (stable + index-friendly).
  // Offset pagination is kept for backward compatibility when no cursor is given.
  if (cursor !== undefined || paginate === 'cursor') {
    const { items, nextCursor } = await service.listMyBookingsCursor({
      userId: req.user.id,
      limit,
      status,
      cursor,
    });
    return res.json({ data: items, pagination: { limit, nextCursor } });
  }

  const offset = (page - 1) * limit;
  const { items, total } = await service.listMyBookings({
    userId: req.user.id,
    limit,
    offset,
    status,
  });
  res.json({
    data: items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
}

export async function cancel(req, res) {
  const booking = await service.cancelBooking({
    bookingId: req.validated.params.id,
    requester: req.user,
  });
  res.json({ data: booking });
}

export async function reschedule(req, res) {
  const booking = await service.rescheduleBooking({
    bookingId: req.validated.params.id,
    requester: req.user,
    startsAt: req.validated.body.startsAt,
    endsAt: req.validated.body.endsAt,
  });
  res.json({ data: booking });
}

export async function complete(req, res) {
  const booking = await service.completeBooking({
    bookingId: req.validated.params.id,
    requester: req.user,
  });
  res.json({ data: booking });
}

export async function noShow(req, res) {
  const booking = await service.markNoShow({
    bookingId: req.validated.params.id,
    requester: req.user,
  });
  res.json({ data: booking });
}

export async function confirm(req, res) {
  const booking = await service.confirmBooking({
    bookingId: req.validated.params.id,
    requester: req.user,
  });
  res.json({ data: booking });
}

export async function getAudit(req, res) {
  const history = await service.listAudit({
    bookingId: req.validated.params.id,
    requester: req.user,
  });
  res.json({ data: history });
}
