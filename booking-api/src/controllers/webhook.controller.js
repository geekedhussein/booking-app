// ---------------------------------------------------------------------------
// WEBHOOK CONTROLLER  (V2.10)
// ---------------------------------------------------------------------------

import * as service from '../services/webhook.service.js';

export async function create(req, res) {
  const sub = await service.createSubscription({
    ownerId: req.user.id,
    url: req.validated.body.url,
    eventTypes: req.validated.body.eventTypes,
  });
  // The secret is included ONLY here — store it now, it won't be shown again.
  res.status(201).json({ data: sub });
}

export async function list(req, res) {
  const subs = await service.listSubscriptions(req.user.id);
  res.json({ data: subs });
}

export async function remove(req, res) {
  await service.deleteSubscription({ id: req.validated.params.id, requester: req.user });
  res.status(204).send();
}

export async function deliveries(req, res) {
  const rows = await service.listDeliveries({
    id: req.validated.params.id,
    requester: req.user,
  });
  res.json({ data: rows });
}
