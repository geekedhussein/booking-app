// ---------------------------------------------------------------------------
// CONFIGURATION  (Phase 1 → Part VIII: Config Management)
//
// One job: read configuration from the environment, validate it, and expose a
// single frozen `config` object to the rest of the app. Nothing else in the
// codebase ever touches `process.env` directly — they import from here.
//
// WHY validate at startup?
//   A missing or malformed variable should crash the process *immediately*,
//   loudly, with a clear message — NOT three hours later, deep inside a request
//   that happened to be the first one to read the missing value. This is the
//   "fail fast on programmer/config errors" principle from Part VIII.
// ---------------------------------------------------------------------------

import { z } from 'zod';

// The schema is the single source of truth for "what config this app needs".
// z.coerce.number() turns the string "3000" (env vars are ALWAYS strings — a
// direct consequence of Part III: everything crossing a process boundary is
// text) into a real number, and validates it in one step (Part IV: transform
// + validate happen together).
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // The MongoDB connection string. Required: if it's missing or empty, the app
  // refuses to start (Part VIII fail-fast) — far better than booting fine and
  // then throwing on the first request that touches the database. The database
  // name is the URI's path (…/booking). Multi-document transactions need a
  // replica set, even a single-node one, so the URI targets one
  // (e.g. mongodb://localhost:27017/booking?directConnection=true).
  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required')
    .refine((v) => /^mongodb(\+srv)?:\/\//.test(v), 'MONGODB_URI must start with mongodb://'),

  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // --- Auth config (Part IV) ---
  // JWT_SECRET signs and verifies tokens. It is REQUIRED and must be long enough
  // to be hard to brute-force. In production this comes from a secrets manager,
  // never source control (Part VIII/IX). A leaked signing secret means anyone
  // can forge a valid token for any user.
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  // How long an ACCESS token stays valid. Short-lived by design (Part IV): with
  // refresh tokens (V2.4) it can be minutes without hurting UX.
  JWT_EXPIRES_IN: z.string().default('15m'),
  // bcrypt work factor. Higher = slower = harder to brute-force, at a CPU cost.
  // 12 is a sane modern default (Part IV: deliberately slow hashing).
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // --- V2.4 Auth hardening ---
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().positive().default(30),
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  LOCKOUT_DURATION_MINUTES: z.coerce.number().int().positive().default(15),

  // --- V2.5 Account flows ---
  // Base URL used to build links inside emails.
  APP_BASE_URL: z.string().default('http://localhost:3000'),
  EMAIL_VERIFICATION_EXPIRES_HOURS: z.coerce.number().int().positive().default(24),
  PASSWORD_RESET_EXPIRES_MINUTES: z.coerce.number().int().positive().default(60),

  // --- V2.9 Scheduler ---
  // How often the scheduler ticks.
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  // Send a reminder this many hours before a booking starts.
  REMINDER_LEAD_HOURS: z.coerce.number().int().positive().default(24),
  // Max bookings to remind per tick (bounded work per run).
  REMINDER_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  // Retention: delete processed outbox rows / used tokens older than this.
  RETENTION_DAYS: z.coerce.number().int().positive().default(7),

  // --- Cache & queue (Part VI caching, Part VII queues) ---
  // Redis powers both the cache and the job queue. It has a default and the app
  // DEGRADES GRACEFULLY if Redis is down (Part VIII): reads fall back to the DB,
  // and enqueueing a non-critical job that fails never fails the request.
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  // --- V2.1 Hardening baseline ---
  // Comma-separated allowlist of browser origins permitted via CORS (Part II).
  // Empty = allow no cross-origin browser requests. Never use "*" with credentials.
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  // Hard ceiling on how long any request may take before we return 503.
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // Global rate limit: max requests per IP per window.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  // Stricter limit for auth endpoints (brute-force defense).
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  // Booking window: reject starts in the past or beyond this many days out.
  BOOKING_MAX_ADVANCE_DAYS: z.coerce.number().int().positive().default(365),

  // --- V2.3 Transactional outbox relay ---
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Aggregate EVERY problem and report them all at once, rather than failing on
  // the first one (Part IV: aggregate validation errors — same idea, applied to
  // config instead of a request body).
  console.error('\n❌ Invalid environment configuration:\n');
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.') || '(root)';
    console.error(`  • ${path}: ${issue.message}`);
  }
  console.error('\nFix your .env file (see .env.example) and try again.\n');
  process.exit(1);
}

// Object.freeze makes config immutable — no code anywhere can accidentally
// mutate a config value at runtime and create a "why is this different now?" bug.
export const config = Object.freeze(parsed.data);
