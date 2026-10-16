// ---------------------------------------------------------------------------
// SHARED SCHEMAS
// ---------------------------------------------------------------------------

import { z } from 'zod';

// A MongoDB ObjectId as it appears in URLs and JSON: 24 hexadecimal characters.
// Validating the shape at the boundary means a malformed id is a clear 400,
// never a database error (Part IV, syntactic validation).
export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{24}$/i, 'must be a valid id');
