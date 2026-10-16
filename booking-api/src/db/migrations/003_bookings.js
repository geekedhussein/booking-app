// ---------------------------------------------------------------------------
// 003 — bookings, with their history embedded  (Part VI)
//
// A booking's audit trail is EMBEDDED as `history`: entries are only ever
// appended ($push), are read with the booking, and stay few (a booking changes
// a handful of times). Appending inside the same update that changes the status
// keeps the change and its record atomic without a second collection.
//
// `blocked_until` = ends_at + the calendar's turnover buffer, computed when the
// booking is written. Storing it lets the overlap query compare plain strings:
// two bookings clash when each starts before the other's blocked_until.
// ---------------------------------------------------------------------------

import {
  ensureCollection,
  objectId,
  nullableObjectId,
  date,
  nullableDate,
  str,
  int,
  LOCAL_DATETIME,
} from './_helpers.js';

export const description = 'bookings (with embedded history)';

export async function up(db) {
  await ensureCollection(
    db,
    'bookings',
    {
      required: [
        'resource_id',
        'user_id',
        'starts_at',
        'ends_at',
        'blocked_until',
        'buffer_minutes',
        'status',
        'history',
        'created_at',
        'updated_at',
      ],
      properties: {
        resource_id: objectId,
        user_id: objectId,
        starts_at: str({ pattern: LOCAL_DATETIME }),
        ends_at: str({ pattern: LOCAL_DATETIME }),
        blocked_until: str({ pattern: LOCAL_DATETIME }),
        buffer_minutes: int({ minimum: 0 }),
        status: { enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'] },
        reminder_sent_at: nullableDate,
        history: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['_id', 'action', 'created_at'],
            properties: {
              _id: objectId,
              actor_user_id: nullableObjectId, // null = done by the system
              action: str(),
              from_status: { bsonType: ['string', 'null'] },
              to_status: { bsonType: ['string', 'null'] },
              details: { bsonType: ['object', 'null'] },
              created_at: date,
            },
          },
        },
        created_at: date,
        updated_at: date,
      },
    },
    // Relationship check across two fields — what SQL's CHECK (ends_at > starts_at)
    // did. String comparison is time comparison for these fixed-width values.
    { $expr: { $gt: ['$ends_at', '$starts_at'] } },
  );
  const bookings = db.collection('bookings');
  // The overlap count and the day schedule: one calendar, a time range.
  await bookings.createIndex(
    { resource_id: 1, starts_at: 1 },
    { name: 'bookings_resource_time_idx' },
  );
  // "My bookings", newest first, with keyset pagination on (starts_at, _id).
  await bookings.createIndex(
    { user_id: 1, starts_at: -1, _id: -1 },
    { name: 'bookings_user_time_idx' },
  );
  // The scheduler's reminder scan.
  await bookings.createIndex(
    { reminder_sent_at: 1, status: 1, starts_at: 1 },
    { name: 'bookings_reminder_idx' },
  );
}
