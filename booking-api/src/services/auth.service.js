// ---------------------------------------------------------------------------
// AUTH SERVICE  (Part IV; V2.4 refresh/lockout; V2.5 verification & reset)
//
// V2.5 adds email verification and password reset. Both use single-use, hashed,
// expiring tokens (auth_tokens collection) delivered via the outbox → relay → queue →
// worker email pipeline. The token creation is written in the SAME transaction
// as the user/password change (V2.3), so a booking's/user's state and its email
// intent are always consistent.
// ---------------------------------------------------------------------------

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { withTransaction } from '../db/index.js';
import * as userRepo from '../repositories/user.repository.js';
import * as refreshRepo from '../repositories/refresh-token.repository.js';
import * as authTokenRepo from '../repositories/auth-token.repository.js';
import * as outboxRepo from '../repositories/outbox.repository.js';
import { config } from '../config/index.js';
import { UnauthorizedError, ForbiddenError, ValidationError } from '../errors/app-error.js';
import { generateRefreshToken, hashToken, newFamilyId } from '../utils/token.js';
import * as providerService from './provider.service.js';

// V3: provider accounts carry their public profile (null for everyone else).
function toUserDTO(row, provider = null) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    emailVerified: row.email_verified,
    provider,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function toUserWithProfile(row) {
  const provider =
    row.role === 'provider' ? await providerService.getProfileForUser(row.id) : null;
  return toUserDTO(row, provider);
}

export async function getMe(userId) {
  const row = await userRepo.findUserById(userId);
  return row ? toUserWithProfile(row) : null;
}

function issueAccessToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  });
}

async function issueRefreshToken(userId, familyId = newFamilyId(), session) {
  const token = generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_EXPIRES_DAYS * 86400000);
  await refreshRepo.insertRefreshToken(
    { userId, tokenHash: hashToken(token), familyId, expiresAt },
    session,
  );
  return token;
}

async function issueTokenPair(user, session) {
  return {
    accessToken: issueAccessToken(user),
    refreshToken: await issueRefreshToken(user.id, undefined, session),
  };
}

// Create a verification token (hashed) + an outbox event carrying the RAW token
// so the email can include the link. Runs on the caller's transaction.
async function createVerificationToken(userId, email, session) {
  const raw = generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.EMAIL_VERIFICATION_EXPIRES_HOURS * 3600000);
  await authTokenRepo.insertToken(
    { userId, tokenHash: hashToken(raw), type: 'email_verification', expiresAt },
    session,
  );
  await outboxRepo.insertEvent(
    {
      aggregateType: 'user',
      aggregateId: userId,
      eventType: 'user.email_verification',
      payload: { userId, email, token: raw },
    },
    session,
  );
}

export async function register({
  email,
  password,
  accountType = 'client',
  displayName,
  slug,
  headline,
}) {
  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  const role = accountType === 'provider' ? 'provider' : 'customer';
  return withTransaction(async (session) => {
    const row = await userRepo.insertUser({ email, passwordHash, role }, session);
    // Same transaction: a provider account never exists without its page, and
    // a taken address rolls the whole sign-up back.
    const provider =
      role === 'provider'
        ? await providerService.createProfile(
            { userId: row.id, displayName, slug, headline: headline ?? '' },
            session,
          )
        : null;
    const user = toUserDTO(row, provider);
    await createVerificationToken(user.id, user.email, session);
    const tokens = await issueTokenPair(user, session);
    return { user, ...tokens };
  });
}

export async function login({ email, password }) {
  const row = await userRepo.findUserByEmail(email);

  if (row?.locked_until && new Date(row.locked_until.replace(' ', 'T')) > new Date()) {
    throw new ForbiddenError(
      'Account temporarily locked due to too many failed login attempts. Try again later.',
    );
  }

  const hashToCompare = row?.password_hash ?? DUMMY_HASH;
  const passwordMatches = await bcrypt.compare(password, hashToCompare);

  if (!row || !passwordMatches) {
    if (row) {
      await userRepo.recordFailedLogin(
        row.id,
        config.MAX_FAILED_LOGINS,
        config.LOCKOUT_DURATION_MINUTES,
      );
    }
    throw new UnauthorizedError('Invalid email or password');
  }

  await userRepo.resetFailedLogin(row.id);
  const user = await toUserWithProfile(row);
  const tokens = await issueTokenPair(user);
  return { user, ...tokens };
}

export async function refresh(rawToken) {
  const tokenHash = hashToken(rawToken);
  const record = await refreshRepo.findByHash(tokenHash);

  if (!record) throw new UnauthorizedError('Invalid refresh token');
  if (record.revoked) throw new UnauthorizedError('Refresh token has been revoked');
  if (new Date(record.expires_at.replace(' ', 'T')) < new Date()) {
    throw new UnauthorizedError('Refresh token has expired');
  }
  if (record.used_at) {
    await refreshRepo.revokeFamily(record.family_id);
    throw new UnauthorizedError('Refresh token reuse detected — session revoked');
  }

  await refreshRepo.markUsed(record.id);
  const userRow = await userRepo.findUserById(record.user_id);
  if (!userRow) throw new UnauthorizedError('User no longer exists');
  const user = await toUserWithProfile(userRow);

  return {
    user,
    accessToken: issueAccessToken(user),
    refreshToken: await issueRefreshToken(user.id, record.family_id),
  };
}

export async function logout(rawToken) {
  await refreshRepo.revokeByHash(hashToken(rawToken));
}

export async function logoutAll(userId) {
  return refreshRepo.revokeAllForUser(userId);
}

// --- V2.5 email verification ---
export async function verifyEmail(rawToken) {
  const record = await authTokenRepo.findValid(hashToken(rawToken), 'email_verification');
  if (!record) throw new ValidationError('Invalid or expired verification token');
  await withTransaction(async (session) => {
    await authTokenRepo.markUsed(record.id, session);
    await userRepo.markEmailVerified(record.user_id, session);
  });
  return { verified: true };
}

// Generic: never reveals whether the email exists or is already verified.
export async function resendVerification(email) {
  const row = await userRepo.findUserByEmail(email);
  if (row && !row.email_verified) {
    await withTransaction(async (session) => {
      await authTokenRepo.invalidateForUser(row.id, 'email_verification', session);
      await createVerificationToken(row.id, row.email, session);
    });
  }
}

// --- V2.5 password reset ---
// Generic: always succeeds from the caller's view (no account enumeration).
export async function requestPasswordReset(email) {
  const row = await userRepo.findUserByEmail(email);
  if (!row) return;
  await withTransaction(async (session) => {
    await authTokenRepo.invalidateForUser(row.id, 'password_reset', session);
    const raw = generateRefreshToken();
    const expiresAt = new Date(Date.now() + config.PASSWORD_RESET_EXPIRES_MINUTES * 60000);
    await authTokenRepo.insertToken(
      { userId: row.id, tokenHash: hashToken(raw), type: 'password_reset', expiresAt },
      session,
    );
    await outboxRepo.insertEvent(
      {
        aggregateType: 'user',
        aggregateId: row.id,
        eventType: 'user.password_reset',
        payload: { userId: row.id, email: row.email, token: raw },
      },
      session,
    );
  });
}

export async function resetPassword({ token, password }) {
  const record = await authTokenRepo.findValid(hashToken(token), 'password_reset');
  if (!record) throw new ValidationError('Invalid or expired reset token');
  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  await withTransaction(async (session) => {
    await userRepo.updatePassword(record.user_id, passwordHash, session);
    await authTokenRepo.markUsed(record.id, session);
    // Security: a reset implies possible compromise → kill every session and
    // clear any lockout state.
    await refreshRepo.revokeAllForUser(record.user_id, session);
    await userRepo.resetFailedLogin(record.user_id, session);
  });
  return { reset: true };
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3G1Q1Qb1Qb1Qb1Qb1Qb1Qb1Qb1Qb1Q';
