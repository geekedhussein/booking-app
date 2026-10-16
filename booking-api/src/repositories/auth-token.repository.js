// ---------------------------------------------------------------------------
// AUTH TOKEN REPOSITORY  (Part IV: single-use, hashed, expiring email links)
//
// Email-verification and password-reset links carry a random token. Only its
// hash is stored, so a database leak yields no working links.
// ---------------------------------------------------------------------------

import { col, oid, toRow } from '../db/index.js';

const tokens = () => col('auth_tokens');

export async function insertToken({ userId, tokenHash, type, expiresAt }, session) {
  const doc = {
    user_id: oid(userId),
    token_hash: tokenHash,
    type,
    expires_at: expiresAt,
    used_at: null,
    created_at: new Date(),
  };
  const { insertedId } = await tokens().insertOne(doc, { session });
  return toRow({ _id: insertedId, ...doc });
}

/** The token, only if it matches, is of this type, is unused and has not expired. */
export async function findValid(tokenHash, type) {
  return toRow(
    await tokens().findOne({
      token_hash: tokenHash,
      type,
      used_at: null,
      expires_at: { $gt: new Date() },
    }),
  );
}

export async function markUsed(id, session) {
  await tokens().updateOne({ _id: oid(id) }, { $set: { used_at: new Date() } }, { session });
}

/** Retire every unused token of this type for the user, so only the newest link works. */
export async function invalidateForUser(userId, type, session) {
  await tokens().updateMany(
    { user_id: oid(userId), type, used_at: null },
    { $set: { used_at: new Date() } },
    { session },
  );
}
