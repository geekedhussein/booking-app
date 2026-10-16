// ---------------------------------------------------------------------------
// PROVIDER REPOSITORY
//
// Provider profiles. A provider is a user (role 'provider') plus this public
// profile; their calendars are resources whose provider_id points here.
// ---------------------------------------------------------------------------

import { col, oid, toRow, isDuplicateKey } from '../db/index.js';
import { ValidationError } from '../errors/app-error.js';

const providers = () => col('providers');

/** The unique index is the real guarantee; translate its "no" into a field error. */
function rethrowSlugTaken(err) {
  if (isDuplicateKey(err) && err.keyPattern?.slug) {
    throw new ValidationError('That page address is already taken', [
      { field: 'slug', message: 'That page address is already taken' },
    ]);
  }
  throw err;
}

export async function insertProvider({ userId, slug, displayName, headline = '' }, session) {
  const now = new Date();
  const doc = {
    user_id: oid(userId),
    slug,
    display_name: displayName,
    headline,
    created_at: now,
    updated_at: now,
  };
  try {
    const { insertedId } = await providers().insertOne(doc, { session });
    return toRow({ _id: insertedId, ...doc });
  } catch (err) {
    return rethrowSlugTaken(err);
  }
}

export async function slugExists(slug, session) {
  return (
    (await providers().countDocuments({ slug: slug.toLowerCase() }, { session, limit: 1 })) > 0
  );
}

export async function findByUserId(userId) {
  const user_id = oid(userId);
  return user_id ? toRow(await providers().findOne({ user_id })) : null;
}

export async function findBySlug(slug) {
  return toRow(await providers().findOne({ slug: slug.toLowerCase() }));
}

const UPDATABLE = { slug: 'slug', displayName: 'display_name', headline: 'headline' };

export async function updateProvider(id, patch) {
  const $set = {};
  for (const [key, field] of Object.entries(UPDATABLE)) {
    if (patch[key] !== undefined) $set[field] = patch[key];
  }
  if (!Object.keys($set).length) return toRow(await providers().findOne({ _id: oid(id) }));
  try {
    const doc = await providers().findOneAndUpdate(
      { _id: oid(id) },
      { $set, $currentDate: { updated_at: true } },
      { returnDocument: 'after' },
    );
    return toRow(doc);
  } catch (err) {
    return rethrowSlugTaken(err);
  }
}

// Escape every regex metacharacter, so a search for "a.b" or "(" matches those
// characters literally instead of being interpreted as a pattern (Part IX:
// treat input as data, never as code — here, regex code).
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Public directory: providers with at least one calendar taking bookings.
 * An empty page helps nobody, so new providers appear once they add a calendar.
 */
export async function listDirectory({ q, limit }) {
  const pipeline = [];
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    pipeline.push({ $match: { $or: [{ display_name: re }, { headline: re }] } });
  }
  pipeline.push(
    {
      $lookup: {
        from: 'resources',
        let: { pid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$provider_id', '$$pid'] }, is_active: true } },
          { $count: 'n' },
        ],
        as: 'active',
      },
    },
    { $set: { calendar_count: { $ifNull: [{ $first: '$active.n' }, 0] } } },
    { $match: { calendar_count: { $gt: 0 } } },
    { $project: { active: 0 } },
    { $sort: { display_name: 1, _id: 1 } },
    { $limit: limit },
  );
  // A collation of strength 2 sorts names without regard to case ("de Vries"
  // next to "Dr"), as SQL's ORDER BY lower(display_name) did.
  const docs = await providers()
    .aggregate(pipeline, { collation: { locale: 'en', strength: 2 } })
    .toArray();
  return docs.map(toRow);
}

/**
 * Every booking on this provider's calendars between two local dates
 * (inclusive), soonest first, with the client's email and the calendar name.
 */
export async function listBookingsForProvider({ providerId, from, to, status, limit }) {
  const calendarIds = (
    await col('resources')
      .find({ provider_id: oid(providerId) }, { projection: { _id: 1 } })
      .toArray()
  ).map((r) => r._id);
  if (!calendarIds.length) return [];

  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  const p = (n) => String(n).padStart(2, '0');
  const endKey = `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())} 00:00:00`;

  const match = {
    resource_id: { $in: calendarIds },
    starts_at: { $gte: `${from} 00:00:00`, $lt: endKey },
  };
  if (status) match.status = status;

  const docs = await col('bookings')
    .aggregate([
      { $match: match },
      { $sort: { starts_at: 1, _id: 1 } },
      { $limit: limit },
      { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'u' } },
      {
        $lookup: {
          from: 'resources',
          localField: 'resource_id',
          foreignField: '_id',
          as: 'r',
        },
      },
      {
        $set: {
          user_email: { $first: '$u.email' },
          resource_name: { $first: '$r.name' },
        },
      },
      { $project: { u: 0, r: 0, history: 0 } },
    ])
    .toArray();
  return docs.map(toRow);
}
