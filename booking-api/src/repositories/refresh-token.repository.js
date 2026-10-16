// ---------------------------------------------------------------------------
// REFRESH TOKEN REPOSITORY  (Part IV: refresh tokens, rotation, reuse detection)
//
// Refresh tokens are opaque random strings; only their SHA-256 hash is stored
// (a bearer credential is treated like a password). Each document carries a
// family_id for rotation lineage, and used_at/revoked for reuse detection and
// logout.
// ---------------------------------------------------------------------------

import { col, oid, toRow } from '../db/index.js';

const tokens = () => col('refresh_tokens');

export async function insertRefreshToken({ userId, tokenHash, familyId, expiresAt }, session) {
  const doc = {
    user_id: oid(userId),
    token_hash: tokenHash,
    family_id: familyId,
    expires_at: expiresAt,
    revoked: false,
    used_at: null,
    created_at: new Date(),
  };
  const { insertedId } = await tokens().insertOne(doc, { session });
  return toRow({ _id: insertedId, ...doc });
}

export async function findByHash(tokenHash) {
  return toRow(await tokens().findOne({ token_hash: tokenHash }));
}

export async function markUsed(id, session) {
  await tokens().updateOne({ _id: oid(id) }, { $set: { used_at: new Date() } }, { session });
}

export async function revokeByHash(tokenHash) {
  const { modifiedCount } = await tokens().updateOne(
    { token_hash: tokenHash },
    { $set: { revoked: true } },
  );
  return modifiedCount;
}

// Revoke an entire rotation lineage: used on reuse detection (likely theft).
export async function revokeFamily(familyId, session) {
  await tokens().updateMany({ family_id: familyId }, { $set: { revoked: true } }, { session });
}

// Revoke everything for a user: "log out everywhere".
export async function revokeAllForUser(userId, session) {
  const { modifiedCount } = await tokens().updateMany(
    { user_id: oid(userId), revoked: false },
    { $set: { revoked: true } },
    { session },
  );
  return modifiedCount;
}
