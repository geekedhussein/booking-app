// ---------------------------------------------------------------------------
// PROVIDER ROUTES  (V3) — mounted at /v1/providers
//
// Public: the directory and each provider's page. Provider-only: their own
// profile and the bookings made on their calendars. `/me` is declared before
// `/:slug` so it is never read as an address (and "me" is too short to be one).
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { captureMountPath } from '../middleware/metrics.js';
import * as controller from '../controllers/provider.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import {
  directoryQuery,
  slugParam,
  updateProviderBody,
  providerBookingsQuery,
} from '../schemas/provider.schemas.js';

export const providerRouter = Router();

providerRouter.use(captureMountPath);

providerRouter.get('/', validate({ query: directoryQuery }), controller.directory);

const own = [authenticate, authorize('provider')];
providerRouter.get('/me', ...own, controller.mine);
providerRouter.patch(
  '/me',
  ...own,
  validate({ body: updateProviderBody }),
  controller.updateMine,
);
providerRouter.get(
  '/me/bookings',
  ...own,
  validate({ query: providerBookingsQuery }),
  controller.myBookings,
);

providerRouter.get('/:slug', validate({ params: slugParam }), controller.page);
