# Booking API

> **V3:** clients and service providers. Providers sign up, get a public page
> and own the calendars clients book. See [`docs/V3.md`](docs/V3.md).

A production-shaped **booking / reservation API** built from first principles as
a complete backend-engineering teaching project. Node.js + Express 5 +
MongoDB (native driver), with Redis for caching, background jobs, and real-time
updates.

> **Database:** this version runs on MongoDB. The original PostgreSQL version is
> kept as a separate snapshot; [`docs/MONGODB.md`](docs/MONGODB.md) explains how
> every PostgreSQL technique was translated.

Service providers publish **calendars** (themselves, rooms, courts, equipment;
the `resources` collection) and clients book them for **time slots**, under one hard
invariant: **a calendar never holds more overlapping active bookings than its
capacity**. It's enforced inside a MongoDB transaction that first writes to the
calendar document, so concurrent bookings for the same calendar serialize and
the rule holds even under heavy contention.

> **Deliberate simplification:** all times are naive local wall-clock times — no
> timezones, no DST. See `CLAUDE.md` for why and where a timezone-aware system
> would differ.

---

## Quick start

Prerequisites: **Node.js 22+**, and (for anything beyond unit tests) **MongoDB 6 or newer**
running as a **replica set** (transactions need one; a single node is fine) and
**Redis**. The quickest way to get both:

```bash
docker compose up -d mongo redis   # mongo starts as single-node replica set rs0
```

### Local
```bash
npm install
cp .env.example .env          # set values; JWT_SECRET must be >= 16 chars
npm run migrate               # create collections, validators, indexes
npm run seed                  # optional: demo providers, calendars, bookings
npm run dev                   # API (auto-reload) on http://localhost:3000
npm run worker                # terminal 2: notification worker
npm run relay                 # terminal 3: outbox relay
npm run scheduler             # terminal 4: reminders + cleanup
```

Interactive API docs: **http://localhost:3000/docs**

The React frontend lives in `../booking-web` (see its README). With both
folders side by side, `docker compose up --build` also serves it at
http://localhost:8080.

### Docker (everything at once)
```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
```
Brings up MongoDB (as a replica set), Redis, runs migrations to completion, then starts the API,
worker, relay and scheduler — each waiting for its dependencies to be healthy.

---

## Try it

```bash
# 1. sign up as a service provider (returns accessToken + refreshToken)
curl -s -X POST localhost:3000/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"lee@example.com","password":"password123",
       "accountType":"provider","displayName":"Dr Amélie Lee"}'

# 2. as that provider, add a calendar clients can book
curl -s -X POST localhost:3000/v1/resources \
  -H 'content-type: application/json' -H "authorization: Bearer <PROVIDER_TOKEN>" \
  -d '{"name":"Consultation","minDurationMinutes":30,"maxDurationMinutes":60}'

# 3. sign up as a client (accountType defaults to "client") and book it
curl -s -X POST localhost:3000/v1/bookings \
  -H 'content-type: application/json' -H "authorization: Bearer <CLIENT_TOKEN>" \
  -H 'Idempotency-Key: my-unique-key-1' \
  -d '{"resourceId":"<CALENDAR_ID>","startsAt":"2026-12-01 09:00","endsAt":"2026-12-01 10:00"}'

# 4. the provider sees it, with the client's email
curl -s localhost:3000/v1/providers/me/bookings?from=2026-12-01 \
  -H "authorization: Bearer <PROVIDER_TOKEN>"
```
The provider's public page is `GET /v1/providers/dr-amelie-lee`.

---

## What's inside

Layered architecture — each layer speaks one language and knows only the layer
below it:

```
route → controller (HTTP) → service (business logic) → repository (queries) → MongoDB
```

Feature set (V1 + V2 — see `docs/V2.md` for the V2 deep dive):

- **HTTP/REST API** with versionable route groups and correct status codes.
- **Layered architecture** (controller / service / repository) for testability
  and swappable infrastructure.
- **Validation** — zod schemas via middleware; input is validated, coerced, and
  stripped of unknown fields before any controller runs.
- **Auth** — registration with bcrypt password hashing, JWT login, `authenticate`
  + `authorize` (RBAC) middleware, and row-level ownership checks.
- **Bookings with real concurrency safety** — the capacity check runs in a
  transaction that first writes to the calendar, so concurrent bookings for it
  conflict and retry one after another; exactly one of N simultaneous requests
  for a slot wins, the rest get `409`.
- **Caching** — Redis cache-aside on list reads with invalidation on writes
  (observable via the `X-Cache` header).
- **Background jobs** — BullMQ queue + a separate worker process, with retries,
  backoff, and idempotency; booking creation enqueues a confirmation.
- **Real-time** — WebSockets with token auth, and Redis pub/sub so events fan out
  across multiple server instances.
- **Testing** — unit (mocked), integration (real DB), and e2e (supertest) tiers,
  plus a load test that proves the capacity guarantee under 50-way contention.
- **Ops** — structured logging, request IDs, centralized error handling, config
  validation, graceful shutdown, Docker + docker-compose.

**V2 additions:**

- **Hardening** — CORS allowlist, helmet security headers, Redis-backed rate
  limiting, request timeouts, future-date booking rules.
- **Exactly-once creation** — `Idempotency-Key` support so retries never
  duplicate a booking.
- **Transactional outbox** — business writes and their events commit atomically;
  a relay process delivers them, so an event can never be lost.
- **Auth hardening** — short access tokens + rotating refresh tokens with reuse
  (theft) detection, logout / logout-everywhere, account lockout.
- **Account flows** — email verification and password reset (enumeration-safe,
  single-use tokens; reset revokes all sessions).
- **Scheduling rules** — per-resource opening hours, min/max duration, lead time,
  and buffer between bookings (buffer enforced inside the capacity check).
- **Capacity > 1** — N concurrent bookings per resource, race-safe under load
  (verified to 1000-way concurrency).
- **Lifecycle** — reschedule, a real state machine
  (`pending → confirmed → completed | no_show | cancelled`), and an append-only
  audit trail.
- **Scheduled jobs** — booking reminders (exactly-once) and retention cleanup.
- **API maturity** — `/v1` versioning, cursor pagination, OpenAPI docs at
  `/docs`, and webhooks with HMAC signatures + retries.
- **Observability** — liveness/readiness split, Prometheus `/health/metrics`,
  request tracing, fingerprinted error tracking.
- **Tooling** — ESLint + Prettier, GitHub Actions CI (real MongoDB replica set
  and Redis), and a load-test script.

---

## Project layout

```
src/
  config/  utils/  errors/            cross-cutting foundations
  db/                                 client, helpers, JS migrations
  cache/  queue/  realtime/           Redis-backed cache, jobs, pub/sub + WS
  middleware/  schemas/               validate, auth, error handling; zod schemas
  repositories/  services/  controllers/  routes/   the layered feature slices
  app.js  server.js  worker.js        app factory, HTTP entrypoint, job worker
tests/   unit/  integration/  e2e/
scripts/ demo-naive-race.js  seed-demo.js  load-test.js  ws-client.js
```

See **`CLAUDE.md`** for the full architecture, the rationale behind every major
decision, conventions for adding features, and the roadmap of what's not yet
built. (It's written for an AI coding assistant, but it's the best orientation
for a human too.)

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API with auto-reload |
| `npm start` | API (reads `.env`) |
| `npm run worker` | background job worker |
| `npm run relay` | outbox relay (delivers events) |
| `npm run scheduler` | reminders + retention cleanup |
| `npm run migrate` | apply pending migrations (validators + indexes) |
| `npm run seed` | demo data on an empty database |
| `npm run demo:race` | naive vs transactional booking, side by side |
| `npm test` | unit tests (no infra needed) |
| `npm run test:integration` | service tests against a real test database |
| `npm run test:e2e` | full-stack HTTP tests (supertest) |
| `npm run loadtest -- 500 10` | contention + throughput load test (API must be running) |
| `npm run lint` / `npm run format` | ESLint (bugs) / Prettier (formatting) |

Integration/e2e tests use `.env.test` (see `.env.test.example`) against a separate
`booking_test` database on the same replica set. MongoDB creates the database on
first write; run `node --env-file=.env.test src/db/migrate.js` once so its
validators and indexes exist before the tests.

Demo accounts from `npm run seed` (password `password123`): clients
`sam@example.com`, `casey@example.com`; providers `courts@`, `yoga@`, `hub@`,
`lee@example.com`; staff `staff@example.com`.

---

## API summary

```
GET    /health/live · /health/ready · /health/metrics · /docs
POST   /v1/auth/register · /login · /refresh · /logout · /verify-email
POST   /v1/auth/forgot-password · /reset-password      GET /v1/auth/me
GET    /v1/providers?q= · /v1/providers/:slug                    (public)
GET    /v1/providers/me · PATCH /v1/providers/me · /me/bookings   (provider)
GET    /v1/resources · /v1/resources/:id · /:id/availability      (public)
POST   /v1/resources · PATCH · DELETE · PUT /:id/availability     (owning provider or staff)
POST   /v1/bookings          GET /v1/bookings/me
PATCH  /v1/bookings/:id      DELETE /v1/bookings/:id
POST   /v1/bookings/:id/confirm · /complete · /no-show            (owning provider or staff)
GET    /v1/bookings/:id/audit
POST   /v1/webhooks          GET /v1/webhooks
WS     /ws?token=<JWT>       subscribe to per-resource booking events
```

Full machine-readable contract: `/docs/openapi.json` (browsable at `/docs`).

Success responses: `{ data, pagination? }`.
Error responses: `{ error: { code, message, details? }, requestId }`.
