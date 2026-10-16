// ---------------------------------------------------------------------------
// 001 — users, refresh tokens and email-link tokens  (Part IV identity)
// ---------------------------------------------------------------------------

import { ensureCollection, objectId, date, nullableDate, str, int, bool } from './_helpers.js';

export const description = 'users, refresh_tokens, auth_tokens';

export async function up(db) {
  // USERS. The role enum is what SQL's CHECK constraint did: an invalid role is
  // physically unstorable, whatever the application code does.
  await ensureCollection(db, 'users', {
    required: [
      'email',
      'password_hash',
      'role',
      'email_verified',
      'failed_login_attempts',
      'created_at',
      'updated_at',
    ],
    properties: {
      email: str({ maxLength: 255 }),
      password_hash: str(), // a bcrypt hash, never the password
      role: { enum: ['customer', 'provider', 'staff', 'admin'] },
      email_verified: bool,
      failed_login_attempts: int({ minimum: 0 }),
      locked_until: nullableDate,
      created_at: date,
      updated_at: date,
    },
  });
  // One account per address, ignoring case. A collation of strength 2 compares
  // letters without case, so "Foo@x.com" and "foo@x.com" collide. Emails are
  // also lowercased on the way in; this index is the backstop under concurrency.
  await db
    .collection('users')
    .createIndex(
      { email: 1 },
      { unique: true, name: 'users_email_uq', collation: { locale: 'en', strength: 2 } },
    );

  // REFRESH TOKENS: only the SHA-256 hash of the opaque token is stored.
  await ensureCollection(db, 'refresh_tokens', {
    required: ['user_id', 'token_hash', 'family_id', 'expires_at', 'revoked', 'created_at'],
    properties: {
      user_id: objectId,
      token_hash: str(),
      family_id: str(), // rotation lineage: reuse of a used token revokes the family
      expires_at: date,
      revoked: bool,
      used_at: nullableDate,
      created_at: date,
    },
  });
  const rt = db.collection('refresh_tokens');
  await rt.createIndex({ token_hash: 1 }, { unique: true, name: 'refresh_tokens_hash_uq' });
  await rt.createIndex({ family_id: 1 }, { name: 'refresh_tokens_family_idx' });
  await rt.createIndex({ user_id: 1 }, { name: 'refresh_tokens_user_idx' });

  // AUTH TOKENS: single-use, hashed, expiring links (verify email, reset password).
  await ensureCollection(db, 'auth_tokens', {
    required: ['user_id', 'token_hash', 'type', 'expires_at', 'created_at'],
    properties: {
      user_id: objectId,
      token_hash: str(),
      type: { enum: ['email_verification', 'password_reset'] },
      expires_at: date,
      used_at: nullableDate,
      created_at: date,
    },
  });
  const at = db.collection('auth_tokens');
  await at.createIndex({ token_hash: 1 }, { unique: true, name: 'auth_tokens_hash_uq' });
  await at.createIndex({ user_id: 1, type: 1 }, { name: 'auth_tokens_user_type_idx' });
}
