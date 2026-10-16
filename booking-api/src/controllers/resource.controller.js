// ---------------------------------------------------------------------------
// RESOURCE CONTROLLER  (Phase 1 → Part V controllers; Part II status codes)
//
// The controller speaks HTTP and nothing else: pull data from the request, hand
// plain values to the service, shape the HTTP response with the right status
// code (Part II). No business rules, no database access.
//
// It now reads exclusively from `req.validated` — the clean, coerced output of
// the validation middleware (Part IV). Notice what's GONE compared to the last
// milestone: no parseId stopgap, no defaulting capacity, no NaN guards. Those
// concerns moved into the schema, where they belong. The controller can finally
// assume its input is trustworthy.
//
// Still no try/catch: Express 5 forwards rejected async promises to the central
// error handler automatically.
// ---------------------------------------------------------------------------

import * as service from '../services/resource.service.js';
import * as availabilityService from '../services/availability.service.js';
import * as bookingService from '../services/booking.service.js';

export async function create(req, res) {
  const resource = await service.createResource(req.validated.body, req.user);
  res.status(201).location(`/resources/${resource.id}`).json({ data: resource });
}

export async function list(req, res) {
  const { page, limit, activeOnly, providerId } = req.validated.query;
  const offset = (page - 1) * limit;

  const { items, total, cached } = await service.listResources({
    limit,
    offset,
    activeOnly,
    providerId,
  });

  // Observable signal (Part VIII) so you can SEE cache-aside working.
  res.set('X-Cache', cached ? 'HIT' : 'MISS');

  res.json({
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
}

export async function getOne(req, res) {
  const resource = await service.getResource(req.validated.params.id);
  res.json({ data: resource });
}

export async function update(req, res) {
  const resource = await service.updateResource(
    req.validated.params.id,
    req.validated.body,
    req.user,
  );
  res.json({ data: resource });
}

export async function remove(req, res) {
  await service.deactivateResource(req.validated.params.id, req.user);
  res.status(204).send();
}

// --- V2.6 availability ---
export async function getAvailability(req, res) {
  const windows = await availabilityService.getAvailability(req.validated.params.id);
  res.json({ data: windows });
}

export async function setAvailability(req, res) {
  const windows = await availabilityService.setAvailability(
    req.validated.params.id,
    req.validated.body.windows,
    req.user,
  );
  res.json({ data: windows });
}

// --- Frontend support ---
export async function getSchedule(req, res) {
  const schedule = await bookingService.getResourceSchedule(
    req.validated.params.id,
    req.validated.query.date,
  );
  res.json({ data: schedule });
}

export async function listDayBookings(req, res) {
  const bookings = await bookingService.listResourceBookingsForDay(
    req.validated.params.id,
    req.validated.query.date,
    req.user,
  );
  res.json({ data: bookings });
}
