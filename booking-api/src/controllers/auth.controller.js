// ---------------------------------------------------------------------------
// AUTH CONTROLLER  (Phase 1 → Part V/II; V2.4 refresh + logout)
//
// register/login now return { user, accessToken, refreshToken }. The client
// sends accessToken in the Authorization header on normal requests, and uses
// refreshToken only against /auth/refresh to get a new access token.
// ---------------------------------------------------------------------------

import * as authService from '../services/auth.service.js';
import { NotFoundError } from '../errors/app-error.js';

export async function register(req, res) {
  const result = await authService.register(req.validated.body);
  res.status(201).json({ data: result });
}

export async function login(req, res) {
  const result = await authService.login(req.validated.body);
  res.status(200).json({ data: result });
}

export async function refresh(req, res) {
  const result = await authService.refresh(req.validated.body.refreshToken);
  res.status(200).json({ data: result });
}

export async function logout(req, res) {
  await authService.logout(req.validated.body.refreshToken);
  res.status(204).send();
}

export async function logoutAll(req, res) {
  const revoked = await authService.logoutAll(req.user.id);
  res.status(200).json({ data: { revoked } });
}

// --- V2.5 account flows ---
export async function verifyEmail(req, res) {
  const result = await authService.verifyEmail(req.validated.body.token);
  res.status(200).json({ data: result });
}

export async function resendVerification(req, res) {
  await authService.resendVerification(req.validated.body.email);
  // Generic response — never reveal whether the email exists.
  res
    .status(200)
    .json({ data: { message: 'If the account exists, a verification email has been sent.' } });
}

export async function forgotPassword(req, res) {
  await authService.requestPasswordReset(req.validated.body.email);
  res
    .status(200)
    .json({ data: { message: 'If the account exists, a reset email has been sent.' } });
}

export async function resetPassword(req, res) {
  const result = await authService.resetPassword(req.validated.body);
  res.status(200).json({ data: result });
}

export async function me(req, res) {
  const user = await authService.getMe(req.user.id);
  if (!user) throw new NotFoundError('User not found');
  res.json({ data: user });
}
