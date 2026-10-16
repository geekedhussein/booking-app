// ---------------------------------------------------------------------------
// 002 — provider profiles and calendars (resources)  (Part VI data modelling)
//
// EMBED OR REFERENCE? The central modelling question in a document database.
//   • A calendar's weekly OPENING HOURS are few (a handful per day), always read
//     with the calendar and replaced as a whole → EMBEDDED in the resource
//     document (`opening_hours`). One read gets everything; replacing the array
//     is a single atomic update, with no transaction needed.
//   • A calendar's PROVIDER is shared by several calendars and edited on its
//     own → REFERENCED by id (`provider_id`) and joined with $lookup when read.
// ---------------------------------------------------------------------------

import {
  ensureCollection,
  objectId,
  nullableObjectId,
  date,
  str,
  int,
  bool,
  LOCAL_TIME,
} from './_helpers.js';

export const description = 'providers, resources (with embedded opening_hours)';

export async function up(db) {
  await ensureCollection(db, 'providers', {
    required: ['user_id', 'slug', 'display_name', 'headline', 'created_at', 'updated_at'],
    properties: {
      user_id: objectId,
      // A page address: lowercase words joined by single hyphens, 3–40 chars.
      slug: str({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', minLength: 3, maxLength: 40 }),
      display_name: str({ minLength: 1, maxLength: 80 }),
      headline: str({ maxLength: 160 }),
      created_at: date,
      updated_at: date,
    },
  });
  const providers = db.collection('providers');
  // Slugs are lowercase by validation, so a plain unique index is case-safe.
  await providers.createIndex({ slug: 1 }, { unique: true, name: 'providers_slug_uq' });
  await providers.createIndex({ user_id: 1 }, { unique: true, name: 'providers_user_uq' });

  await ensureCollection(db, 'resources', {
    required: [
      'name',
      'capacity',
      'is_active',
      'min_duration_minutes',
      'lead_time_minutes',
      'buffer_minutes',
      'provider_id',
      'opening_hours',
      'lock_version',
      'created_at',
      'updated_at',
    ],
    properties: {
      name: str({ minLength: 1, maxLength: 200 }),
      capacity: int({ minimum: 1 }),
      is_active: bool,
      min_duration_minutes: int({ minimum: 0 }),
      max_duration_minutes: { bsonType: ['int', 'long', 'null'], minimum: 1 },
      lead_time_minutes: int({ minimum: 0 }),
      buffer_minutes: int({ minimum: 0 }),
      provider_id: nullableObjectId, // null = a "house" calendar run by staff
      // Bumped by every booking transaction on this calendar: the write that
      // serializes them (see bookingRepo.lockResourceForBooking).
      lock_version: int({ minimum: 0 }),
      opening_hours: {
        bsonType: 'array',
        maxItems: 50,
        items: {
          bsonType: 'object',
          required: ['_id', 'day_of_week', 'opens_at', 'closes_at'],
          properties: {
            _id: objectId,
            day_of_week: int({ minimum: 0, maximum: 6 }), // 0 = Sunday
            opens_at: str({ pattern: LOCAL_TIME }),
            closes_at: str({ pattern: LOCAL_TIME }),
          },
        },
      },
      created_at: date,
      updated_at: date,
    },
  });
  const resources = db.collection('resources');
  await resources.createIndex(
    { provider_id: 1, is_active: 1 },
    { name: 'resources_provider_idx' },
  );
  await resources.createIndex({ is_active: 1 }, { name: 'resources_active_idx' });
}
