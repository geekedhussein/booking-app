// ---------------------------------------------------------------------------
// AUTH ROUTES  (Part III/IV; V2.4 refresh/logout; V2.5 verify/reset)
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { captureMountPath } from '../middleware/metrics.js';
import * as controller from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  registerBody,
  loginBody,
  refreshBody,
  logoutBody,
  verifyEmailBody,
  emailOnlyBody,
  resetPasswordBody,
} from '../schemas/auth.schemas.js';

export const authRouter = Router();

// V2.11: remember the mount path so metrics label errors with the full pattern.
authRouter.use(captureMountPath);

// Public.
authRouter.post('/register', validate({ body: registerBody }), controller.register);
authRouter.post('/login', validate({ body: loginBody }), controller.login);
authRouter.post('/refresh', validate({ body: refreshBody }), controller.refresh);
authRouter.post('/logout', validate({ body: logoutBody }), controller.logout);

// V2.5 account flows (all public; generic responses avoid enumeration).
authRouter.post('/verify-email', validate({ body: verifyEmailBody }), controller.verifyEmail);
authRouter.post(
  '/resend-verification',
  validate({ body: emailOnlyBody }),
  controller.resendVerification,
);
authRouter.post(
  '/forgot-password',
  validate({ body: emailOnlyBody }),
  controller.forgotPassword,
);
authRouter.post(
  '/reset-password',
  validate({ body: resetPasswordBody }),
  controller.resetPassword,
);

// Protected.
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/logout-all', authenticate, controller.logoutAll);
