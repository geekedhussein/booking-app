// ---------------------------------------------------------------------------
// RESOURCE ROUTES  (Phase 1 → Part III routing + Part IV authZ + Part V chain)
//
// The middleware order on the write routes IS the security model, read left to
// right:  authenticate (who are you?) → authorize (staff/admin only?) →
// validate (is the input clean?) → controller. If any gate says no, the request
// never reaches the controller.
//
// Reads (GET) are public here. Writes require a staff/admin or provider token
// (RBAC at the route, Part IV); V3 adds an OWNERSHIP check in the service, since
// a provider may only touch their own calendars.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { captureMountPath } from '../middleware/metrics.js';
import * as controller from '../controllers/resource.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import {
  resourceIdParam,
  createResourceBody,
  updateResourceBody,
  listResourceQuery,
  availabilityBody,
  dayQuery,
} from '../schemas/resource.schemas.js';

export const resourceRouter = Router();

// V2.11: remember the mount path so metrics label errors with the full pattern.
resourceRouter.use(captureMountPath);

// --- Public reads ---
resourceRouter.get('/', validate({ query: listResourceQuery }), controller.list);
resourceRouter.get('/:id', validate({ params: resourceIdParam }), controller.getOne);
// V2.6: a resource's opening hours are public.
resourceRouter.get(
  '/:id/availability',
  validate({ params: resourceIdParam }),
  controller.getAvailability,
);

// --- Staff/admin-only writes ---
resourceRouter.post(
  '/',
  authenticate,
  authorize('staff', 'admin', 'provider'),
  validate({ body: createResourceBody }),
  controller.create,
);

resourceRouter.patch(
  '/:id',
  authenticate,
  authorize('staff', 'admin', 'provider'),
  validate({ params: resourceIdParam, body: updateResourceBody }),
  controller.update,
);

resourceRouter.delete(
  '/:id',
  authenticate,
  authorize('staff', 'admin', 'provider'),
  validate({ params: resourceIdParam }),
  controller.remove,
);

// V2.6: staff/admin set a resource's opening hours (full replacement).
resourceRouter.put(
  '/:id/availability',
  authenticate,
  authorize('staff', 'admin', 'provider'),
  validate({ params: resourceIdParam, body: availabilityBody }),
  controller.setAvailability,
);

// Frontend support: public day schedule (intervals only, no booker identity).
resourceRouter.get(
  '/:id/schedule',
  validate({ params: resourceIdParam, query: dayQuery }),
  controller.getSchedule,
);

// Frontend support: staff day view with every booking and the booker's email.
resourceRouter.get(
  '/:id/bookings',
  authenticate,
  authorize('staff', 'admin', 'provider'),
  validate({ params: resourceIdParam, query: dayQuery }),
  controller.listDayBookings,
);
