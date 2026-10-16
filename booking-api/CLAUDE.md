# CLAUDE.md — project primer for AI agents

This file is read automatically by Claude Code. It captures the architecture,
**deliberate decisions (and their rationale)**, conventions, and current state of
this project so you can continue the work without re-deriving or accidentally
reversing choices that were made on purpose.

---

## What this project is

A **booking / reservation API** built from first principles as a teaching
project. Since V3 it is **multi-provider**: people sign up as **clients** (role
`customer`) or **service providers** (role `provider`). Each provider has a
public page (`/p/<slug>`) and owns one or more **calendars** (the `resources`
collection: themselves, rooms, courts…). Clients book calendars for **time slots**,
and a calendar never takes more overlapping active bookings than its capacity.
`staff`/`admin` remain as platform operators who can manage everything.
Built with Node.js + Express 5 + MongoDB (native driver), with Redis for caching, a job
queue, and real-time pub/sub.

The codebase intentionally exercises the full range of backend concepts:
HTTP/REST, layered architecture, validation, auth (JWT + RBAC), transactions &
concurrency control, caching, background jobs, WebSockets, testing, and Docker.

---

## Deliberate decisions — DO NOT reverse without a strong reason

These were chosen on purpose. If a change seems to require undoing one, stop and
confirm with the human first.

1. **Language: plain JavaScript (ESM), not TypeScript.** Chosen to keep the focus
   on backend concepts over the type system. If migrating to TS, do it as a
   deliberate, whole-project step — don't half-convert.

2. **Framework: Express 5.** Relied upon for automatic async-error forwarding
   (rejected promises in async handlers reach the central error handler with no
   wrapper). Don't add `express-async-handler`-style wrappers; they're redundant.

3. **Database: MongoDB, through the official native driver** (no Mongoose).
   It MUST run as a replica set — a single-node one is fine — because bookings,
   sign-up and reminders use multi-document transactions, which only exist on
   replica sets. Connection strings use `directConnection=true` so the same
   URI works from the host and from inside Docker. (The PostgreSQL version of
   this project is preserved as a separate snapshot; see `docs/MONGODB.md`.)

4. **LOCAL TIME ONLY — NO TIMEZONES.** This is a foundational simplification.
   - Two kinds of time, stored differently (see `src/db/index.js`):
     **wall-clock times a person chose** (booking `starts_at`/`ends_at`/
     `blocked_until`, opening hours) are fixed-width STRINGS
     ("2026-09-10 09:00:00", "09:00:00"), so string order is time order and
     range queries compare strings; **instants the system records**
     (`created_at`, `expires_at`, `locked_until`, …) are BSON Dates.
   - Repositories return Dates as local wall-clock strings via `toRow()`, so
     the API and services see one string format everywhere.
   - All datetime input is validated/canonicalized by `src/utils/datetime.js`.
   - If you ever need real timezones, that's a large, cross-cutting change — treat
     it as its own project, not a tweak.

5. **Overbooking is prevented by a LOCKED, COUNTING TRANSACTION.**
   `createBooking`/`rescheduleBooking` run in `withTransaction` and FIRST write
   to the calendar document (`bookingRepo.lockResourceForBooking`: `$inc
   lock_version`). MongoDB lets one open transaction modify a document; a
   concurrent one gets a WriteConflict, is aborted and retried by
   `session.withTransaction()` after the first commits. So bookings on one
   calendar serialize. Then: count overlapping ACTIVE bookings → 409 if
   `count >= capacity` → insert. **Never** replace this with an unlocked
   check-then-insert: that races and WILL overbook (`npm run demo:race` shows
   it). The integration test fires 40 concurrent requests at a capacity-3 slot
   and expects exactly 3. Consequence: ALL booking writes must go through the
   service. Half-open `[start, end)`: back-to-back is allowed; the turnover
   buffer is stored as `blocked_until = ends_at + buffer_minutes`, and two
   bookings clash when each starts before the other's `blocked_until`.
   Transaction callbacks may run more than once: keep side effects (emails,
   queue jobs) out of them — that is what the outbox is for.

6. **Layered architecture, strictly.** route → controller → service → repository
   → db. Each layer only knows the one below it. Keep concerns where they belong:
   - **controllers**: HTTP only (parse req, set status codes, shape response).
   - **services**: business logic + DTO mapping; no HTTP, no database calls.
   - **repositories**: the ONLY place database queries live. They return plain
     ROWS (`id` string + snake_case fields), never raw documents. Query
     filters are built from our own field names, never from request keys
     (operator injection, e.g. `{ "$ne": null }`, is the NoSQL injection).
   Adding a feature usually means one new file per layer, mirroring `resources`.

7. **Validation at the boundary.** All input is validated by zod schemas via the
   `validate()` middleware BEFORE controllers run. Controllers read from
   `req.validated`, never raw `req.body`/`req.query`/`req.params`. Schemas use
   `.strict()` (unknown fields are rejected).

8. **Identity comes from the token, never the body.** `req.user` is set by the
   `authenticate` middleware from the verified JWT. Never trust a `userId` in a
   request body.

9. **Graceful degradation for non-critical infra.** Cache (Redis) and the job
   queue are optimizations: if Redis is down, reads fall back to the DB and a
   failed enqueue is logged but never fails the request. Don't make these fatal.

10. **Errors are centralized.** Throw `AppError` subclasses (see
    `src/errors/app-error.js`); the central error handler maps them to status
    codes and shapes the response. Never leak internal error details to clients
    in production. Operational errors log at `warn`, unexpected at `error`.

---

11. **Every state-changing side effect goes through the TRANSACTIONAL OUTBOX
    (V2.3).** Never call the queue or pub/sub directly from a service. Write an
    `outbox` document in the SAME transaction as the business change; the relay
    process delivers it. This is what makes "booking saved but email lost"
    impossible. Delivery is at-least-once, so all consumers must be idempotent.

12. **Invariants that must hold under concurrency belong in the database.**
    Instances of one technique, worth recognizing: the booking capacity lock
    (write-conflict serialization), unique indexes as atomic claims (idempotency
    keys, emails, slugs → duplicate-key error 11000), `findOneAndUpdate` with
    the condition in the filter as an atomic claim (reminders:
    `reminder_sent_at: null`; outbox leases: `locked_until` expired), and
    `findOneAndUpdate({ _id, status: fromStatus })` for state transitions.

13. **Metrics are labelled by ROUTE PATTERN, never raw paths** (V2.11). Labelling
    by id creates one time series per entity and melts the metrics backend.

14. **Authorization is role AND ownership (V3).** `authorize()` at the route
    lets roles in; the service then checks the specific record with
    `utils/access.js` (`canManageResource`, `assertCanManageResource`). A
    provider may only touch calendars whose `provider_id` is theirs — and
    bookings on them (complete / no-show / confirm / cancel / history / day
    list). Staff/admin may touch everything. Load the record first, then check:
    404 before 403. Never decide ownership from ids in the request body.

15. **Signup can never grant staff/admin.** `accountType` is `client` or
    `provider` only. A provider account and its `providers` document are created in
    ONE transaction, so a provider never exists without a page and a taken
    address rolls the whole signup back. A derived address never fails (the
    first free `name`, `name-2`…); a chosen one that is taken is a field error.

## Architecture / directory map

```
src/
  config/        env loading + validation (fail-fast at startup)
  utils/         logger (pino), datetime (local-time parsing), pagination
  errors/        AppError + subclasses (ValidationError, NotFoundError, ...)
  db/            MongoClient, helpers (col, oid, toRow, withTransaction), migrations
  cache/         Redis connection + cache-aside helpers
  queue/         BullMQ producer (booking-notifications)
  realtime/      Redis pub/sub + WebSocket server
  observability/ metrics (Prometheus), tracing (AsyncLocalStorage), error tracker
  middleware/    validate, auth, error-handler, not-found, rate-limit,
                 request-timeout, idempotency, metrics
  schemas/       zod schemas per feature
  repositories/  queries per feature (user, resource, booking, outbox, webhook,
                 refresh-token, auth-token, availability, audit, idempotency, cleanup)
  services/      business logic per feature
  controllers/   HTTP handlers per feature
  routes/        route groups per feature (all mounted under /v1)
  docs/          OpenAPI spec
  app.js         builds the Express app + middleware chain (no port bind)
  server.js      starts HTTP + WebSocket server, owns graceful shutdown
  worker.js      SEPARATE process: consumes notification queue jobs
  outbox-relay.js SEPARATE process: delivers outbox events (queue, pub/sub, webhooks)
  scheduler.js   SEPARATE process: reminders + retention cleanup
tests/           unit/ (mocked) · integration/ (real DB) · e2e/ (supertest)
scripts/         demo-naive-race.js, seed-demo.js, load-test.js, ws-client.js,
                 verify-local.sh (not app code)
```

Request pipeline (per protected write route):
`helmet → cors → timeout → rate-limit → log/metrics/trace → parse →
 authenticate → authorize → idempotency → validate → controller → service →
 repository → db`

**Four processes** run in production (all in docker-compose): `app`, `worker`,
`relay`, `scheduler`.

---

## Conventions

- **ESM only** (`"type": "module"`); use `import`/`export`, `.js` extensions in
  import paths.
- **Node 22+** required (uses built-in `--watch`, `--env-file`, `node:test`).
- Repositories return rows (snake_case fields, ObjectIds as 24-hex strings). Services
  map rows → camelCase DTOs and are the only place that decides what leaves the
  API. Never let `password_hash` into a response.
- New feature "X": add `schemas/x.schemas.js`, `repositories/x.repository.js`,
  `services/x.service.js`, `controllers/x.controller.js`, `routes/x.routes.js`,
  mount it in `app.js`. Follow the `resources` feature as the template.
- Every new schema-validated route reads from `req.validated`.
- Add DB changes as a NEW numbered migration in `src/db/migrations/` (e.g.
  `006_*.js` exporting `up(db)`) — never edit an applied migration. Migrations
  set `$jsonSchema` validators (our CHECK constraints) and indexes, and must be
  idempotent: MongoDB can't run them inside one transaction.
- Modelling rule: EMBED what is small, bounded and read with its parent
  (opening hours in `resources`, history in `bookings`); REFERENCE what is
  shared or unbounded (providers, webhook deliveries) and join with `$lookup`.
- Config: add new env vars to the zod schema in `src/config/index.js` AND to
  `.env.example`. Read config from the `config` object, never `process.env`
  directly outside that file.

---

## Running it

```bash
npm install
cp .env.example .env            # fill in values (JWT_SECRET must be >= 16 chars)
# needs MongoDB (replica set) + Redis:  docker compose up -d mongo redis
npm run migrate                 # apply validators + indexes
npm run seed                    # optional: demo providers, calendars, bookings
npm run dev                     # API with --watch
npm run worker                  # terminal 2: notification worker
npm run relay                   # terminal 3: outbox relay
npm run scheduler               # terminal 4: reminders + cleanup
```

Or the whole stack in Docker:
```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
```

### Tests
```bash
npm test                 # unit (no infra needed)
npm run test:integration # needs MongoDB + a migrated booking_test DB
npm run test:e2e         # needs MongoDB + Redis + migrated booking_test DB
npm run lint             # ESLint (bugs)
npm run format:check     # Prettier (formatting)
node scripts/load-test.js  # load/contention test against a running API
```
CI (`.github/workflows/ci.yml`) runs all of the above on every push with real
MongoDB/Redis containers.
Integration/e2e use `.env.test` (see `.env.test.example`) pointing at a separate
`booking_test` database. MongoDB creates it on first write; run
`node --env-file=.env.test src/db/migrate.js` once so validators and indexes exist.
`scripts/verify-local.sh` does all of it (start mongo + redis, migrate, every test tier).

---

## Domain model

- **users**: id, email (unique, case-insensitive via collation), password_hash (bcrypt),
  role (`customer` | `provider` | `staff` | `admin`), timestamps. Signup
  creates `customer` or `provider`; staff/admin are granted out-of-band.
- **providers** (V3): id, user_id (unique reference), slug (unique, always lowercase,
  `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–40 chars), display_name, headline. The public
  page is `/p/<slug>` in the frontend, `GET /v1/providers/:slug` in the API.
- **resources** ("calendars" in the UI): id, name, capacity, rules (min/max
  duration, lead time, buffer), is_active (soft delete), provider_id
  (reference; null = a house resource run by staff), opening_hours (embedded
  array), lock_version (bumped by every booking transaction; see #5). Reads are public; writes need staff
  or the owning provider.
- **bookings**: id, resource_id, user_id, starts_at, ends_at, blocked_until,
  buffer_minutes, reminder_sent_at, history (embedded audit trail), status
  (`pending` | `confirmed` | `completed` | `no_show` | `cancelled`, new
  bookings are `confirmed`), timestamps. Capacity is enforced by the locked
  counting transaction (#5). The client who booked may cancel/reschedule;
  everything else belongs to the calendar's provider or staff.

---

## API surface (current — all under /v1)

```
GET    /health · /health/live      liveness (dependency-free)
GET    /health/ready               readiness (checks DB; Redis reported only)
GET    /health/metrics             Prometheus scrape
GET    /docs · /docs/openapi.json  Swagger UI + OpenAPI spec

POST   /v1/auth/register · /login · /refresh · /logout
POST   /v1/auth/verify-email · /resend-verification
POST   /v1/auth/forgot-password · /reset-password
GET    /v1/auth/me            POST /v1/auth/logout-all

GET    /v1/providers?q=            directory (providers with an active calendar)
GET    /v1/providers/:slug         public page: profile + active calendars
GET    /v1/providers/me            my profile + all my calendars        (provider)
PATCH  /v1/providers/me            displayName, headline, slug          (provider)
GET    /v1/providers/me/bookings   ?from&to&status, with client emails  (provider)

GET    /v1/resources · /v1/resources/:id    (public; ?providerId= filters)
POST   /v1/resources · PATCH · DELETE /v1/resources/:id   (staff or owning provider)
GET    /v1/resources/:id/availability · /schedule?date=   (public)
PUT    /v1/resources/:id/availability                     (staff or owning provider)
GET    /v1/resources/:id/bookings?date=                   (staff or owning provider)

POST   /v1/bookings                (auth; optional Idempotency-Key header)
GET    /v1/bookings/me             (cursor or offset paginated)
PATCH  /v1/bookings/:id            reschedule (the client, the owning provider, or staff)
DELETE /v1/bookings/:id            cancel (the client, the owning provider, or staff)
POST   /v1/bookings/:id/confirm · /complete · /no-show   (staff or owning provider)
GET    /v1/bookings/:id/audit      change history

POST   /v1/webhooks · GET /v1/webhooks · DELETE /v1/webhooks/:id
GET    /v1/webhooks/:id/deliveries

WS     /ws?token=<JWT>             subscribe to per-resource booking events
```

Ids everywhere are MongoDB ObjectIds as 24-hex strings.

Response envelope: success `{ data, pagination? }`; error
`{ error: { code, message, details? }, requestId }`.

---

## Status: what's built

**V1** foundation, DB layer + migrations, layered CRUD, validation, auth,
bookings, caching, jobs, WebSockets, tests, Docker.

**V2** (see `docs/V2.md` for per-milestone detail):
1. Hardening — CORS, helmet, request timeout, Redis rate limiting, future-date rule
2. Idempotency-Key on POST /bookings
3. Transactional outbox + relay process
4. Refresh tokens with rotation & reuse detection, logout, account lockout
5. Email verification + password reset (generalized notification pipeline)
6. Availability windows + booking rules (duration, lead time, buffer)
7. Capacity > 1 (locked counting transaction)
8. Reschedule, booking state machine, audit trail
9. Scheduler process: reminders (exactly-once) + retention cleanup
10. /v1 versioning, cursor pagination, OpenAPI, webhooks with HMAC signatures
11. Observability — liveness/readiness split, Prometheus metrics, tracing, error tracking
12. ESLint/Prettier, GitHub Actions CI, load testing

**V3** (see `docs/V3.md`): service providers. Client/provider signup, provider
profiles and public pages, a directory, ownership-based authorization, and a
provider dashboard endpoint for bookings across their calendars.

**Not yet built (natural next steps):** emailing providers when they're
booked, provider logos/photos, admin endpoints for user/role management,
multi-resource/group bookings, payments, recurring bookings, search/filtering
across resources, i18n, and timezone support (a deliberate, large exclusion).

When adding any of these, follow the layering and conventions above.
