// ---------------------------------------------------------------------------
// WEBHOOK ROUTES  (V2.10)  — mounted at /v1/webhooks
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { captureMountPath } from '../middleware/metrics.js';
import * as controller from '../controllers/webhook.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { createWebhookBody, webhookIdParam } from '../schemas/webhook.schemas.js';

export const webhookRouter = Router();

// V2.11: remember the mount path so metrics label errors with the full pattern.
webhookRouter.use(captureMountPath);

webhookRouter.use(authenticate);

webhookRouter.post('/', validate({ body: createWebhookBody }), controller.create);
webhookRouter.get('/', controller.list);
webhookRouter.delete('/:id', validate({ params: webhookIdParam }), controller.remove);
webhookRouter.get(
  '/:id/deliveries',
  validate({ params: webhookIdParam }),
  controller.deliveries,
);
