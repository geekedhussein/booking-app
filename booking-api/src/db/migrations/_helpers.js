// ---------------------------------------------------------------------------
// MIGRATION HELPERS
//
// MongoDB doesn't need a table declared before you write to it, so a migration
// here does two jobs a SQL schema did for free:
//   1. VALIDATION — a $jsonSchema validator per collection rejects documents of
//      the wrong shape (missing fields, wrong types, values outside an enum).
//      It is the counterpart of NOT NULL and CHECK constraints: the database
//      refuses bad data even if a bug in the app tries to write it (Part IX,
//      defense in depth).
//   2. INDEXES — speed (Part VI) and, for unique indexes, correctness under
//      concurrency: "no two users with the same email" holds only because the
//      database enforces it atomically.
//
// Both helpers are idempotent (safe to run twice), which matters because
// MongoDB can't wrap collection and index creation in one transaction the way
// PostgreSQL wraps DDL.
// ---------------------------------------------------------------------------

/**
 * Create the collection with its validator, or update the validator if the
 * collection already exists.
 */
export async function ensureCollection(db, name, $jsonSchema, extra = {}) {
  const validator = extra.$expr
    ? { $and: [{ $jsonSchema }, { $expr: extra.$expr }] }
    : { $jsonSchema };
  const exists = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
  if (exists) {
    await db.command({
      collMod: name,
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  } else {
    await db.createCollection(name, {
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  }
}

// Reusable schema fragments.
export const objectId = { bsonType: 'objectId' };
export const nullableObjectId = { bsonType: ['objectId', 'null'] };
export const date = { bsonType: 'date' };
export const nullableDate = { bsonType: ['date', 'null'] };
export const str = (extra = {}) => ({ bsonType: 'string', ...extra });
export const int = (extra = {}) => ({ bsonType: ['int', 'long'], ...extra });
export const bool = { bsonType: 'bool' };

// Wall-clock strings (no timezone): fixed width, so string order is time order.
export const LOCAL_DATETIME = '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$';
export const LOCAL_TIME = '^([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d$';
