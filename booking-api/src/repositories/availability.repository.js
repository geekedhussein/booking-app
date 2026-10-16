// ---------------------------------------------------------------------------
// AVAILABILITY REPOSITORY  (weekly opening hours)
//
// Opening hours are EMBEDDED in the calendar document (`opening_hours`): they
// are few, always read with the calendar, and replaced as a whole. Replacing
// the array is one atomic update, so a PUT can never leave half the old hours
// and half the new (the SQL version needed a transaction around DELETE + INSERTs).
// ---------------------------------------------------------------------------

import { ObjectId } from 'mongodb';
import { col, oid } from '../db/index.js';

const resources = () => col('resources');

// Rows in the shape services expect: "HH:MM:SS" times, string ids.
const toWindowRow = (resourceId) => (w) => ({
  id: w._id.toHexString(),
  resource_id: String(resourceId),
  day_of_week: w.day_of_week,
  opens_at: w.opens_at,
  closes_at: w.closes_at,
});

const byDayThenTime = (a, b) =>
  a.day_of_week - b.day_of_week || a.opens_at.localeCompare(b.opens_at);

export async function listByResource(resourceId) {
  const doc = await resources().findOne(
    { _id: oid(resourceId) },
    { projection: { opening_hours: 1 } },
  );
  return (doc?.opening_hours ?? []).map(toWindowRow(resourceId)).sort(byDayThenTime);
}

/** Replace ALL windows for a calendar atomically (a PUT-style full replacement). */
export async function replaceForResource(resourceId, windows) {
  // "09:00" from the API is stored as "09:00:00": the same shape PostgreSQL's
  // time type returned, which the rest of the code already expects.
  const entries = windows.map((w) => ({
    _id: new ObjectId(),
    day_of_week: w.dayOfWeek,
    opens_at: `${w.opensAt}:00`,
    closes_at: `${w.closesAt}:00`,
  }));
  await resources().updateOne(
    { _id: oid(resourceId) },
    { $set: { opening_hours: entries }, $currentDate: { updated_at: true } },
  );
  return entries.map(toWindowRow(resourceId)).sort(byDayThenTime);
}
