// ---------------------------------------------------------------------------
// DATABASE ACCESS HELPERS  (Part V repository foundation; Part VI data layer)
//
// Thin helpers every repository uses, so cross-cutting concerns (transactions,
// id conversion, how values leave the database) live in exactly one place.
//
// THE CONTRACT WITH THE LAYERS ABOVE. Repositories return plain "rows": objects
// with an `id` string and snake_case fields, exactly the shape the services
// already expect. That is the payoff of the repository layer (Part VI,
// dependency inversion): the database underneath changed from PostgreSQL to
// MongoDB, and the services barely noticed.
//
// TWO KINDS OF TIME (our "no timezones" decision, refined):
//   • Wall-clock times a person chose — a booking's start and end, a calendar's
//     opening hours — are stored as STRINGS ("2026-10-12 14:00:00", "09:00:00").
//     They mean "14:00 on the provider's clock", not an instant on Earth. Fixed
//     width means string order IS time order, so range queries work on them.
//   • Instants the system records — created_at, expires_at, locked_until — are
//     BSON Dates (a point in time). They leave the database as local wall-clock
//     strings, the same shape the API has always returned.
// ---------------------------------------------------------------------------

import { ObjectId } from 'mongodb';
import { client, db } from './client.js';

export { db };

/** A collection by name. */
export const col = (name) => db.collection(name);

/**
 * Turn an id from the outside (a URL, a token, another row) into an ObjectId.
 * Returns null for anything that isn't a valid 24-hex id, so a lookup with a
 * malformed id simply finds nothing (→ 404), never throws.
 */
export function oid(id) {
  if (id instanceof ObjectId) return id;
  if (typeof id === 'string' && ObjectId.isValid(id) && /^[a-f0-9]{24}$/i.test(id)) {
    return new ObjectId(id);
  }
  return null;
}

/** "YYYY-MM-DD HH:MM:SS" in the server's local time (what LOCALTIMESTAMP gave). */
export function localString(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

/** Add minutes to a canonical wall-clock string, staying in wall-clock terms. */
export function addMinutesLocal(canonical, minutes) {
  const d = new Date(canonical.replace(' ', 'T'));
  d.setMinutes(d.getMinutes() + minutes);
  return localString(d);
}

/**
 * Document → row. `_id` becomes `id`; ObjectIds become hex strings; Dates
 * become local wall-clock strings. One level deep, which is all our documents
 * need (nested arrays are mapped by the repository that owns them).
 */
export function toRow(doc) {
  if (!doc) return null;
  const row = {};
  for (const [key, value] of Object.entries(doc)) {
    const k = key === '_id' ? 'id' : key;
    if (value instanceof ObjectId) row[k] = value.toHexString();
    else if (value instanceof Date) row[k] = localString(value);
    else row[k] = value;
  }
  return row;
}

/** MongoDB's code for a unique-index violation (E11000 duplicate key). */
export const isDuplicateKey = (err) => err?.code === 11000;

/**
 * Run `fn` inside one multi-document transaction (Part VI: ACID atomicity).
 *
 * Every operation inside `fn` must pass the `session` it receives — that is
 * what puts it in the transaction (the role the dedicated pg client played).
 * Transactions need a replica set; ours is a single-node one.
 *
 * session.withTransaction() commits on success, aborts on any error, and
 * RETRIES THE WHOLE CALLBACK when MongoDB reports a transient error such as a
 * write conflict. That retry is what turns "two transactions touched the same
 * document" into "they ran one after the other" — the heart of how booking
 * capacity stays correct (see bookingRepo.lockResourceForBooking). So `fn`
 * must be safe to run more than once: only database work inside, no emails.
 *
 * @template T
 * @param {(session: import('mongodb').ClientSession) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const session = client.startSession();
  try {
    let result;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      {
        // Snapshot reads: everything in the transaction sees one consistent
        // point in time. Majority writes: a commit survives a primary failover.
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      },
    );
    return result;
  } finally {
    // ALWAYS end the session, success or failure, or sessions leak on the server.
    await session.endSession();
  }
}

/** Is the database answering? Used by the readiness probe. */
export async function ping() {
  await db.command({ ping: 1 });
}

/** Close the connection pool during graceful shutdown (Part VIII). */
export async function closeDb() {
  await client.close();
}
