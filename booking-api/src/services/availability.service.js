// ---------------------------------------------------------------------------
// AVAILABILITY SERVICE  (V2.6)
// ---------------------------------------------------------------------------

import * as availabilityRepo from '../repositories/availability.repository.js';
import * as resourceRepo from '../repositories/resource.repository.js';
import { NotFoundError } from '../errors/app-error.js';
import { assertCanManageResource } from '../utils/access.js';

function toWindowDTO(row) {
  return {
    id: row.id,
    dayOfWeek: row.day_of_week,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
  };
}

export async function getAvailability(resourceId) {
  const resource = await resourceRepo.findResourceById(resourceId);
  if (!resource) throw new NotFoundError(`Resource ${resourceId} not found`);
  const rows = await availabilityRepo.listByResource(resourceId);
  return rows.map(toWindowDTO);
}

export async function setAvailability(resourceId, windows, requester) {
  const resource = await resourceRepo.findResourceById(resourceId);
  if (!resource) throw new NotFoundError(`Resource ${resourceId} not found`);
  assertCanManageResource(requester, resource);
  const rows = await availabilityRepo.replaceForResource(resourceId, windows);
  return rows.map(toWindowDTO);
}
