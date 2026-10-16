// ---------------------------------------------------------------------------
// AUTH SCHEMAS  (Phase 1 → Part IV validation + normalization)
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { slugSchema, displayNameSchema, headlineSchema } from './provider.schemas.js';

export const registerBody = z
  .object({
    // .toLowerCase() is NORMALIZATION at the boundary (Part IV): we store and
    // compare emails in one canonical form so "Foo@x.com" and "foo@x.com" are
    // the same account. The DB's case-insensitive unique index on email is the backstop.
    email: z.string().trim().toLowerCase().email().max(255),
    // A minimum length is the simplest real password policy. Real systems add
    // more (breach-list checks, etc.), but length is the highest-value single rule.
    password: z.string().min(8, 'Password must be at least 8 characters').max(200),
    // V3: who is signing up. Clients book; providers get a page and calendars.
    // Signup can never grant staff/admin — those stay out-of-band.
    accountType: z.enum(['client', 'provider']).default('client'),
    displayName: displayNameSchema.optional(),
    slug: slugSchema.optional(),
    headline: headlineSchema.optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.accountType === 'provider' && !b.displayName) {
      ctx.addIssue({
        code: 'custom',
        path: ['displayName'],
        message: 'Enter the name clients will see',
      });
    }
    if (b.accountType === 'client' && (b.displayName || b.slug || b.headline)) {
      ctx.addIssue({
        code: 'custom',
        path: ['accountType'],
        message: 'Page details are only for service provider accounts',
      });
    }
  });

export const loginBody = z
  .object({
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(1, 'Password is required').max(200),
  })
  .strict();

// V2.4: the refresh/logout endpoints take the opaque refresh token.
export const refreshBody = z
  .object({
    refreshToken: z.string().min(1, 'refreshToken is required'),
  })
  .strict();

export const logoutBody = refreshBody;

// V2.5 account flows
export const verifyEmailBody = z
  .object({ token: z.string().min(1, 'token is required') })
  .strict();

export const emailOnlyBody = z
  .object({ email: z.string().trim().toLowerCase().email().max(255) })
  .strict();

export const resetPasswordBody = z
  .object({
    token: z.string().min(1, 'token is required'),
    password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  })
  .strict();
