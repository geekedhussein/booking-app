// ---------------------------------------------------------------------------
// RESOURCE SCHEMAS  (Phase 1 → Part IV: validation categories)
//
// These schemas ARE the contract for what each resource endpoint accepts. They
// live next to the feature, separate from the controller, so the "what is
// valid" rules are declarative and reusable (they can also drive API docs later
// — Part XI OpenAPI).
//
// Every schema is .strict(): unknown fields are REJECTED, not ignored. If a
// client sends { name, isAdmin: true } to create a resource, that's a 400, not a
// silent pass — you never process fields you didn't ask for (Part III/IV).
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { objectIdSchema } from './common.schemas.js';

// --- path param: /resources/:id ---
// URL params are always strings (Part III). Ids are MongoDB ObjectIds: 24 hex
// characters, checked here so a malformed id is a clear 400.
export const resourceIdParam = z.object({
  id: objectIdSchema,
});

// --- POST /resources body ---
export const createResourceBody = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(200),
    // capacity is optional on the wire; if omitted it defaults to 1.
    capacity: z.coerce.number().int().min(1).max(10_000).default(1),
    // V2.6 booking policies (all optional; DB defaults apply if omitted).
    minDurationMinutes: z.coerce.number().int().min(0).max(1440).optional(),
    maxDurationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    leadTimeMinutes: z.coerce.number().int().min(0).max(525600).optional(),
    bufferMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  })
  .strict();

// --- PATCH /resources/:id body ---
export const updateResourceBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    capacity: z.coerce.number().int().min(1).max(10_000).optional(),
    isActive: z.boolean().optional(),
    minDurationMinutes: z.coerce.number().int().min(0).max(1440).optional(),
    // null clears an existing limit (the repository writes NULL as-is).
    maxDurationMinutes: z
      .union([z.null(), z.coerce.number().int().min(1).max(1440)])
      .optional(),
    leadTimeMinutes: z.coerce.number().int().min(0).max(525600).optional(),
    bufferMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'Provide at least one field to update',
  });

// --- V2.6 availability windows (PUT /resources/:id/availability) ---
export const availabilityBody = z
  .object({
    windows: z
      .array(
        z
          .object({
            dayOfWeek: z.coerce.number().int().min(0).max(6), // 0=Sun..6=Sat
            opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'opensAt must be HH:MM'),
            closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'closesAt must be HH:MM'),
          })
          .strict()
          .refine((w) => w.opensAt < w.closesAt, {
            message: 'opensAt must be before closesAt',
            path: ['closesAt'],
          }),
      )
      .max(50),
  })
  .strict();

// --- GET /resources query string ---
// This SUBSUMES the old hand-rolled pagination helper: coercion, defaults, and
// bounds now live declaratively in the schema.
//
// DESIGN CHOICE: we CLAMP page/limit into range rather than reject out-of-range
// values (limit=99999 becomes 100, not a 400). Clamping is forgiving and is what
// most public APIs do. The stricter alternative — .min(1).max(100), which
// returns a 400 for anything outside the range — is equally valid; pick based on
// whether you'd rather be lenient or explicit with clients. A truly non-numeric
// value ("abc") still fails .int() and returns a 400 either way.
export const listResourceQuery = z
  .object({
    page: z.coerce
      .number()
      .int()
      .default(1)
      .transform((v) => Math.max(v, 1)),
    limit: z.coerce
      .number()
      .int()
      .default(20)
      .transform((v) => Math.min(Math.max(v, 1), 100)),
    // query values are strings; accept "true"/"false" and transform to boolean.
    activeOnly: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    // V3: only one provider's calendars.
    providerId: objectIdSchema.optional(),
  })
  .strict();

// --- Frontend support: ?date=YYYY-MM-DD (must be a real calendar date) ---
export const dayQuery = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
      .refine((d) => {
        const [y, m, day] = d.split('-').map(Number);
        const dt = new Date(y, m - 1, day);
        return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === day;
      }, 'date must be a real calendar date'),
  })
  .strict();
