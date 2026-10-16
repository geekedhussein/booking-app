// ---------------------------------------------------------------------------
// BOOKING ROUTES  (Part III/IV; V2.2 idempotency; V2.8 transitions/reschedule)
//
// All booking routes require authentication. Fine-grained authorization (owner
// vs staff, and legal state transitions) is enforced in the service, because it
// depends on the specific row and its current status.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { captureMountPath } from '../middleware/metrics.js';
import * as controller from '../controllers/booking.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { idempotency } from '../middleware/idempotency.js';
import {
  createBookingBody,
  rescheduleBookingBody,
  bookingIdParam,
  listBookingQuery,
} from '../schemas/booking.schemas.js';

export const bookingRouter = Router();

// V2.11: remember the mount path so metrics label errors with the full pattern.
bookingRouter.use(captureMountPath);

bookingRouter.use(authenticate);

bookingRouter.post('/', idempotency, validate({ body: createBookingBody }), controller.create);
bookingRouter.get('/me', validate({ query: listBookingQuery }), controller.listMine);

// Reschedule (owner or staff).
bookingRouter.patch(
  '/:id',
  validate({ params: bookingIdParam, body: rescheduleBookingBody }),
  controller.reschedule,
);

// Cancel (owner or staff).
bookingRouter.delete('/:id', validate({ params: bookingIdParam }), controller.cancel);

// Staff-only lifecycle transitions.
bookingRouter.post('/:id/confirm', validate({ params: bookingIdParam }), controller.confirm);
bookingRouter.post('/:id/complete', validate({ params: bookingIdParam }), controller.complete);
bookingRouter.post('/:id/no-show', validate({ params: bookingIdParam }), controller.noShow);

// Audit history (owner or staff).
bookingRouter.get('/:id/audit', validate({ params: bookingIdParam }), controller.getAudit);
