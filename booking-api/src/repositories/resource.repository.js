// ---------------------------------------------------------------------------
// RESOURCE (CALENDAR) REPOSITORY  (Part V repository layer; Part VI joins)
//
// The only file in the calendar feature that knows the database exists. It
// speaks the database's language (documents, $lookup) and hands the service
// plain rows. Because everything above depends only on these function
// signatures, the database underneath could change from PostgreSQL to MongoDB
// by rewriting files like this one (Part VI, dependency inversion).
// ---------------------------------------------------------------------------

import { col, oid, toRow } from '../db/index.js';

const resources = () => col('resources');

// Every read carries its owner (provider), so the service can check ownership
// and the API can say whose calendar this is. A $lookup is MongoDB's left join:
// it pulls the matching provider document into an array, which we flatten into
// three plain fields. The embedded opening hours and the lock counter stay out.
const WITH_OWNER = [
  {
    $lookup: {
      from: 'providers',
      localField: 'provider_id',
      foreignField: '_id',
      as: 'provider',
    },
  },
  {
    $set: {
      owner_user_id: { $ifNull: [{ $first: '$provider.user_id' }, null] },
      provider_slug: { $ifNull: [{ $first: '$provider.slug' }, null] },
      provider_name: { $ifNull: [{ $first: '$provider.display_name' }, null] },
    },
  },
  { $project: { provider: 0, opening_hours: 0, lock_version: 0 } },
];

export async function insertResource({
  name,
  capacity,
  minDurationMinutes = 0,
  maxDurationMinutes = null,
  leadTimeMinutes = 0,
  bufferMinutes = 0,
  providerId = null,
}) {
  const now = new Date();
  const { insertedId } = await resources().insertOne({
    name,
    capacity,
    is_active: true,
    min_duration_minutes: minDurationMinutes,
    max_duration_minutes: maxDurationMinutes,
    lead_time_minutes: leadTimeMinutes,
    buffer_minutes: bufferMinutes,
    provider_id: providerId ? oid(providerId) : null,
    opening_hours: [],
    lock_version: 0,
    created_at: now,
    updated_at: now,
  });
  return findResourceById(insertedId);
}

export async function findResourceById(id) {
  const _id = oid(id);
  if (!_id) return null; // a malformed id finds nothing; the service decides it's a 404
  const [doc] = await resources()
    .aggregate([{ $match: { _id } }, ...WITH_OWNER])
    .toArray();
  return toRow(doc);
}

export async function listResources({ limit, offset, activeOnly, providerId }) {
  const filter = {};
  if (activeOnly) filter.is_active = true;
  if (providerId) filter.provider_id = oid(providerId);

  const docs = await resources()
    .aggregate([
      { $match: filter },
      { $sort: { _id: 1 } },
      { $skip: offset },
      { $limit: limit },
      ...WITH_OWNER,
    ])
    .toArray();
  // A separate count so the API can report total pages.
  const total = await resources().countDocuments(filter);
  return { rows: docs.map(toRow), total };
}

// Partial update from a fixed WHITELIST of fields. Field names come from OUR
// code, never from the request, so a client can't set arbitrary fields (the
// document-database cousin of SQL injection: operator injection, Part IX).
const UPDATABLE = {
  name: 'name',
  capacity: 'capacity',
  isActive: 'is_active',
  minDurationMinutes: 'min_duration_minutes',
  maxDurationMinutes: 'max_duration_minutes',
  leadTimeMinutes: 'lead_time_minutes',
  bufferMinutes: 'buffer_minutes',
};

export async function updateResource(id, patch) {
  const _id = oid(id);
  if (!_id) return null;
  const $set = {};
  for (const [key, field] of Object.entries(UPDATABLE)) {
    if (patch[key] !== undefined) $set[field] = patch[key];
  }
  if (Object.keys($set).length === 0) return findResourceById(_id);
  const { matchedCount } = await resources().updateOne(
    { _id },
    { $set, $currentDate: { updated_at: true } },
  );
  return matchedCount ? findResourceById(_id) : null;
}

/** Soft delete: a calendar with booking history must not vanish. */
export async function deactivateResource(id) {
  return updateResource(id, { isActive: false });
}
