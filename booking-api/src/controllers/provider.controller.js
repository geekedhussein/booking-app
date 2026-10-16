// ---------------------------------------------------------------------------
// PROVIDER CONTROLLER  (V3)
// ---------------------------------------------------------------------------

import * as service from '../services/provider.service.js';

export async function directory(req, res) {
  const providers = await service.listDirectory(req.validated.query);
  res.json({ data: providers });
}

export async function page(req, res) {
  const provider = await service.getPublicPage(req.validated.params.slug);
  res.json({ data: provider });
}

export async function mine(req, res) {
  res.json({ data: await service.getMine(req.user) });
}

export async function updateMine(req, res) {
  res.json({ data: await service.updateMine(req.user, req.validated.body) });
}

export async function myBookings(req, res) {
  res.json({ data: await service.listMyBookings(req.user, req.validated.query) });
}
