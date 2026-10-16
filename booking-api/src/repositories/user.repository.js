// ---------------------------------------------------------------------------
// USER REPOSITORY  (Part V repository; Part IV auth data)
//
// Data access for users. It stores and returns password_hash; the SERVICE is
// responsible for never letting that field reach an API response (Part III,
// custom serialization). Every function returns plain rows (see db/index.js).
// ---------------------------------------------------------------------------

import { col, oid, toRow, isDuplicateKey } from '../db/index.js';
import { ConflictError } from '../errors/app-error.js';

const users = () => col('users');

// Case-insensitive comparison, matching the unique index on email.
const CI = { locale: 'en', strength: 2 };

// What callers outside login may see: never the hash or the lockout counters.
const PUBLIC = { email: 1, role: 1, email_verified: 1, created_at: 1, updated_at: 1 };

/** Create an account. `session` puts the insert inside the caller's transaction. */
export async function insertUser({ email, passwordHash, role = 'customer' }, session) {
  const now = new Date();
  const doc = {
    email,
    password_hash: passwordHash,
    role,
    email_verified: false,
    failed_login_attempts: 0,
    locked_until: null,
    created_at: now,
    updated_at: now,
  };
  try {
    const { insertedId } = await users().insertOne(doc, { session });
    const { password_hash: _hash, failed_login_attempts: _f, locked_until: _l, ...rest } = doc;
    return toRow({ _id: insertedId, ...rest });
  } catch (err) {
    // The unique index is the real guarantee; translate its "no" into HTTP language.
    if (isDuplicateKey(err))
      throw new ConflictError('An account with that email already exists');
    throw err;
  }
}

// Includes password_hash BECAUSE login must compare against it, plus the lockout
// fields. This is the only function that returns the hash.
export async function findUserByEmail(email) {
  return toRow(await users().findOne({ email }, { collation: CI }));
}

/**
 * Record a failed login in ONE atomic update: add 1 to the counter and, if it
 * reaches the threshold, set locked_until. An update pipeline (an array of
 * stages) can read the document's own fields ($failed_login_attempts) and the
 * server clock ($$NOW), so no read-then-write race is possible.
 */
export async function recordFailedLogin(userId, maxAttempts, lockoutMinutes) {
  const doc = await users().findOneAndUpdate(
    { _id: oid(userId) },
    [
      { $set: { failed_login_attempts: { $add: ['$failed_login_attempts', 1] } } },
      {
        $set: {
          locked_until: {
            $cond: [
              { $gte: ['$failed_login_attempts', maxAttempts] },
              { $add: ['$$NOW', lockoutMinutes * 60_000] },
              '$locked_until',
            ],
          },
        },
      },
    ],
    { returnDocument: 'after', projection: { failed_login_attempts: 1, locked_until: 1 } },
  );
  return toRow(doc);
}

/** Clear lockout state after a successful login. */
export async function resetFailedLogin(userId, session) {
  await users().updateOne(
    { _id: oid(userId) },
    { $set: { failed_login_attempts: 0, locked_until: null } },
    { session },
  );
}

/** Who someone is, without the password hash. */
export async function findUserById(id) {
  const _id = oid(id);
  if (!_id) return null;
  return toRow(await users().findOne({ _id }, { projection: PUBLIC }));
}

export async function markEmailVerified(userId, session) {
  await users().updateOne(
    { _id: oid(userId) },
    { $set: { email_verified: true }, $currentDate: { updated_at: true } },
    { session },
  );
}

export async function updatePassword(userId, passwordHash, session) {
  await users().updateOne(
    { _id: oid(userId) },
    { $set: { password_hash: passwordHash }, $currentDate: { updated_at: true } },
    { session },
  );
}
