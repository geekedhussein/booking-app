// ---------------------------------------------------------------------------
// RESOURCE SERVICE  (Phase 1 → Part V service; Part III serialization;
//                    Part VI cache-aside + invalidation)
//
// Now with CACHE-ASIDE on the list read (Part VI): check the cache first; on a
// miss, hit the DB and populate the cache; on any write, INVALIDATE the cached
// lists so nobody sees stale data. The cache layer lives here in the service —
// the repository only talks to the database, unaware caching exists.
// ---------------------------------------------------------------------------

import * as repo from '../repositories/resource.repository.js';
import * as providerRepo from '../repositories/provider.repository.js';
import { NotFoundError, ForbiddenError } from '../errors/app-error.js';
import { assertCanManageResource } from '../utils/access.js';
import { cacheGetJson, cacheSetJson, cacheDelByPrefix } from '../cache/index.js';

// All cached resource-list keys share this prefix so we can invalidate them all
// at once on any write.
const LIST_PREFIX = 'resources:list:';

export function toResourceDTO(row) {
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    isActive: row.is_active,
    minDurationMinutes: row.min_duration_minutes,
    maxDurationMinutes: row.max_duration_minutes,
    leadTimeMinutes: row.lead_time_minutes,
    bufferMinutes: row.buffer_minutes,
    // V3: whose calendar this is (null for house resources run by staff).
    providerId: row.provider_id ?? null,
    providerSlug: row.provider_slug ?? null,
    providerName: row.provider_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function invalidateLists() {
  await cacheDelByPrefix(LIST_PREFIX);
}

export async function createResource(
  {
    name,
    capacity = 1,
    minDurationMinutes,
    maxDurationMinutes,
    leadTimeMinutes,
    bufferMinutes,
  },
  requester,
) {
  // V3: a provider's new calendar belongs to them. Staff create house resources.
  let providerId = null;
  if (requester?.role === 'provider') {
    const provider = await providerRepo.findByUserId(requester.id);
    if (!provider) throw new ForbiddenError('Set up your provider page first');
    providerId = provider.id;
  }
  const row = await repo.insertResource({
    providerId,
    name,
    capacity,
    minDurationMinutes,
    maxDurationMinutes,
    leadTimeMinutes,
    bufferMinutes,
  });
  await invalidateLists(); // a new resource changes list results
  return toResourceDTO(row);
}

export async function getResource(id) {
  const row = await repo.findResourceById(id);
  if (!row) throw new NotFoundError(`Resource ${id} not found`);
  return toResourceDTO(row);
}

export async function listResources({ limit, offset, activeOnly, providerId }) {
  // The cache key must capture EVERY input that changes the result — otherwise
  // you'd serve page 1's data for a page 2 request. This is a classic caching bug.
  const key = `${LIST_PREFIX}${activeOnly}:${providerId ?? '*'}:${limit}:${offset}`;

  const cached = await cacheGetJson(key);
  if (cached) {
    return { ...cached, cached: true }; // HIT
  }

  const { rows, total } = await repo.listResources({ limit, offset, activeOnly, providerId });
  const result = { items: rows.map(toResourceDTO), total };
  await cacheSetJson(key, result); // populate for next time
  return { ...result, cached: false }; // MISS
}

/** Load a resource and check the requester may manage it (404 before 403). */
async function loadManageable(id, requester) {
  const existing = await repo.findResourceById(id);
  if (!existing) throw new NotFoundError(`Resource ${id} not found`);
  assertCanManageResource(requester, existing);
  return existing;
}

export async function updateResource(id, patch, requester) {
  await loadManageable(id, requester);
  const row = await repo.updateResource(id, patch);
  if (!row) throw new NotFoundError(`Resource ${id} not found`);
  await invalidateLists();
  return toResourceDTO(row);
}

export async function deactivateResource(id, requester) {
  await loadManageable(id, requester);
  const row = await repo.deactivateResource(id);
  if (!row) throw new NotFoundError(`Resource ${id} not found`);
  await invalidateLists();
  return toResourceDTO(row);
}
