// ---------------------------------------------------------------------------
// TOKEN HELPERS  (V2.4)
//
// Refresh tokens are high-entropy random strings. Unlike passwords (which are
// low-entropy and need a SLOW hash like bcrypt), a 256-bit random token only
// needs a fast one-way hash (SHA-256) for at-rest storage — there's nothing to
// brute-force. We store only the hash; the raw token is shown to the client once.
// ---------------------------------------------------------------------------

import { randomBytes, createHash, randomUUID } from 'node:crypto';

export function generateRefreshToken() {
  return randomBytes(32).toString('hex'); // 256 bits of entropy
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function newFamilyId() {
  return randomUUID();
}
