// ---------------------------------------------------------------------------
// PROVIDER SCHEMAS  (V3)
// ---------------------------------------------------------------------------

import { z } from 'zod';

// A page address: lowercase words joined by single hyphens, 3–40 characters.
// Normalized at the boundary (trim + lowercase) so "Dr-Lee" means "dr-lee".
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Use at least 3 characters')
  .max(40, 'Use at most 40 characters')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use letters, numbers and single hyphens only');

export const displayNameSchema = z.string().trim().min(1, 'Enter a name').max(80);
export const headlineSchema = z.string().trim().max(160);

export const slugParam = z.object({ slug: slugSchema }).strict();

export const directoryQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    limit: z.coerce
      .number()
      .int()
      .default(50)
      .transform((v) => Math.min(Math.max(v, 1), 100)),
  })
  .strict();

export const updateProviderBody = z
  .object({
    displayName: displayNameSchema.optional(),
    headline: headlineSchema.optional(),
    slug: slugSchema.optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: 'Provide at least one field to update',
  });

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((d) => {
    const [y, m, day] = d.split('-').map(Number);
    const dt = new Date(y, m - 1, day);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === day;
  }, 'date must be a real calendar date');

const localToday = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// GET /providers/me/bookings?from&to&status — defaults to today + 30 days.
export const providerBookingsQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    status: z.enum(['pending', 'confirmed', 'cancelled', 'completed', 'no_show']).optional(),
    limit: z.coerce
      .number()
      .int()
      .default(500)
      .transform((v) => Math.min(Math.max(v, 1), 1000)),
  })
  .strict()
  .transform((q) => {
    const from = q.from ?? localToday();
    let to = q.to;
    if (!to) {
      const [y, m, d] = from.split('-').map(Number);
      const end = new Date(y, m - 1, d + 30);
      const p = (n) => String(n).padStart(2, '0');
      to = `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}`;
    }
    return { ...q, from, to };
  })
  .refine((q) => q.from <= q.to, { message: 'from must be on or before to', path: ['to'] });
