# From PostgreSQL to MongoDB

Reserve started on PostgreSQL. This version runs on **MongoDB (6.0 or newer) with the
native Node.js driver** (no ODM). The PostgreSQL version is kept as a separate
snapshot (`booking-app-v3-postgres.zip`), so the two can be compared file by
file.

This note explains the switch the way the rest of the docs explain features:
the idea first, then how it is built here. Its main lesson is that **the
guarantees stay the same; the tools that provide them change.** Every
correctness property the PostgreSQL version had still holds, and each section
below names the PostgreSQL technique, the MongoDB one that replaced it, and why
the replacement is still correct.

---

## 1. What moved, and what didn't

Only two layers changed:

| Layer | Changed? | Why |
| --- | --- | --- |
| routes, controllers, middleware | No | They speak HTTP, not storage. |
| services | Barely | They call repositories and `withTransaction`; the callback now receives a `session` instead of a `client`. |
| **repositories** | **Rewritten** | They are the only code that speaks the database's language. |
| **db/** (connection, migrations) | **Rewritten** | Same reason. |
| schemas | One addition | Ids are now 24-hex strings, validated by `objectIdSchema`. |
| frontend | Two lines | Ids are strings, not numbers. |

That is the payoff of the layered architecture (Part II): a repository
returns *rows* (plain objects with snake_case fields and string ids), and
every layer above depends on that shape, not on SQL. The repositories kept
their function names, arguments and return shapes, so services barely noticed.
`toRow()` in `src/db/index.js` does the translation on the way out:

- `_id` becomes `id` (hex string); every other ObjectId becomes a hex string;
- a BSON `Date` becomes the same `"YYYY-MM-DD HH:MM:SS"` local string the
  PostgreSQL driver produced, so DTO mappers didn't change.

---

## 2. Tables → collections, and what to embed

A relational schema normalizes everything into tables and joins at read time.
A document database asks a different question per relationship: **is this data
always read with its parent, owned by it, and bounded in size?** If yes, embed
it; otherwise reference it.

| PostgreSQL table | MongoDB | Embedded or referenced | Why |
| --- | --- | --- | --- |
| `users` | `users` | — | |
| `refresh_tokens`, `auth_tokens` | same names | referenced (`user_id`) | Looked up by hash, not by user; unbounded over time. |
| `providers` | `providers` | referenced (`user_id`) | Read on its own (public page, directory). |
| `resources` | `resources` | — | |
| `availability_windows` | `resources.opening_hours[]` | **embedded** | Always read and replaced as a whole week, at most a few dozen entries, meaningless without the calendar. |
| `bookings` | `bookings` | referenced (`resource_id`, `user_id`) | Unbounded per calendar; queried by many different keys. |
| `booking_audit` | `bookings.history[]` | **embedded** | Append-only, belongs to one booking, bounded (a booking changes state a handful of times). |
| `idempotency_keys`, `outbox` | same names | — | |
| `webhook_subscriptions`, `webhook_deliveries` | same names | referenced (`subscription_id`) | Deliveries grow without limit. |

Embedding removes a join *and* makes "replace the week's opening hours" a
single-document write, which MongoDB applies atomically without a
transaction. `findBookingById` projects `history` out so ordinary reads don't
carry the audit trail around.

Joins that remain (calendar + owner, booking + calendar + provider, provider
bookings + client email) are aggregation `$lookup` stages. They are fine at
this scale because each looks up by `_id` or by an indexed foreign key.

---

## 3. Schema: CHECK and NOT NULL → `$jsonSchema` validators

MongoDB accepts any document by default. A booking with `capacity: "lots"` or
no `starts_at` would be stored happily. That is not acceptable for a teaching
project about defense in depth, so every collection has a **validator**
(`src/db/migrations/_helpers.js` → `ensureCollection`):

| PostgreSQL | MongoDB validator |
| --- | --- |
| `NOT NULL` | `required: [...]` |
| column types | `bsonType` (`objectId`, `string`, `int`/`long`, `bool`, `date`) |
| `CHECK (status IN (...))` | `enum: [...]` |
| `CHECK (capacity >= 1)` | `minimum: 1` |
| `CHECK (slug ~ '^[a-z0-9-]+$')` | `pattern` |
| `CHECK (ends_at > starts_at)` (two columns) | `$expr: { $gt: ['$ends_at', '$starts_at'] }` next to the schema |

Validation is `strict` with action `error`, so a bad insert or update fails
in the database even if the zod schema and the service both had a bug.
Unknown fields are allowed (no `additionalProperties: false`); the
repositories' field whitelists keep them out instead.

---

## 4. Time

PostgreSQL had `timestamp` (wall clock, no zone) for booking times and
`timestamptz` for instants. MongoDB has one date type, an instant in UTC. The
project's deliberate rule is "booking times are naive local wall-clock times"
(see `CLAUDE.md`), so:

- **Wall-clock values are stored as fixed-width strings**:
  `"2026-12-01 09:00:00"` for bookings, `"09:00:00"` for opening hours. Fixed
  width means **string order is time order**, so `$lt`/`$gt` and indexes work
  exactly as they did on `timestamp`. The validator's `pattern` guarantees the
  width.
- **Instants** (`created_at`, `expires_at`, `locked_until`, …) are BSON
  `Date`s, so TTL indexes and `$$NOW` work.
- `addMinutesLocal()` does wall-clock arithmetic on the strings without ever
  involving a timezone.

---

## 5. Migrations

SQL migrations were `.sql` files run inside a transaction each. MongoDB can't
put collection or index creation inside a transaction, so a migration here is
a JS module exporting `up(db)` that is written to be **idempotent**:
`ensureCollection` creates the collection or updates its validator
(`collMod`); `createIndex` is a no-op if the same index exists.
`src/db/migrate.js` keeps the same ledger idea, a `schema_migrations`
collection with a unique `filename`, and stops at the first failure. Rerunning
a half-applied migration is safe because every step is idempotent.

The 14 PostgreSQL migrations were regrouped into five by area
(`001_users_and_sessions` … `005_webhooks`), since a fresh database needs only
the final shape.

---

## 6. The capacity guarantee (the important one)

**The invariant:** a calendar never holds more overlapping active bookings
than its capacity, including the buffer after each booking.

**PostgreSQL version:** inside a transaction, `SELECT … FROM resources WHERE
id = $1 FOR UPDATE` took a row lock on the calendar. Every concurrent booking
for that calendar queued behind it. Then count overlapping bookings, compare to
capacity, insert, commit.

**Why the naive version fails** (still demonstrated by
`npm run demo:race`): six requests each count zero overlapping bookings before
any of them inserts, so all six insert. Check-then-act needs the check and
the act to be one atomic step with respect to other writers.

**MongoDB has no `SELECT … FOR UPDATE`.** It has something with the same
effect: inside a transaction, **a write to a document conflicts with any other
open transaction that writes the same document.** The loser gets a
`WriteConflict`, labelled `TransientTransactionError`, and the driver's
`session.withTransaction` **aborts it and runs the callback again from the
start**. So `createBooking` does:

```js
withTransaction(async (session) => {
  // 1. Claim the calendar: a real write, so concurrent bookings conflict here.
  const cal = await resources.findOneAndUpdate(
    { _id }, { $inc: { lock_version: 1 } }, { session, returnDocument: 'after' });
  // 2. Count overlapping active bookings (in this transaction's snapshot).
  const n = await bookings.countDocuments({
    resource_id: _id, status: { $in: ['pending', 'confirmed'] },
    starts_at: { $lt: endsAt + buffer }, blocked_until: { $gt: startsAt },
  }, { session });
  if (n >= cal.capacity) throw new ConflictError(...);   // not transient: no retry
  // 3. Insert the booking and its outbox event.
});
```

Why this is correct:

1. Two transactions for the same calendar can't both pass step 1 while both
   are open. One commits; the other is aborted and retried.
2. The retry starts a **new snapshot** taken after the winner committed, so its
   count in step 2 includes the winner's booking.
3. Bookings for *different* calendars write different documents and never
   conflict, so unrelated traffic isn't serialized (same as row locks).

The integration test sends 40 concurrent requests at a capacity-3 slot and
asserts exactly 3 bookings and 37 × 409.

**Buffers.** PostgreSQL compared padded `tsrange`s with `&&` in the query. Here each booking
stores `blocked_until = ends_at + buffer_minutes` (the buffer in force when it
was booked, also stored). Two bookings collide when
`new.starts_at < existing.blocked_until` and
`existing.starts_at < new.ends_at + buffer`, which is the same interval-overlap
test, using an index on `{ resource_id, starts_at }`.

**Rule for transaction callbacks:** because the driver may run the callback
several times, it must have **no side effects outside the database**: no
cache invalidation, no publishing, no emails inside it. The services already
did those after commit (via the outbox), which is why the switch didn't need
to change them.

**Why a replica set, even with one node:** multi-document transactions are
implemented on top of the replication log, so MongoDB only offers them on a
replica set (or sharded cluster). `docker-compose.yml` starts `mongo` with
`--replSet rs0`, and its health check runs `rs.initiate()` on first boot. The
connection string uses `directConnection=true` so the driver talks to that one
node even though the set advertises the hostname `mongo`.

---

## 7. Other concurrency techniques, translated

| Guarantee | PostgreSQL | MongoDB |
| --- | --- | --- |
| Unique email, ignoring case | unique index on `lower(email)` | unique index with **collation** `{ locale: 'en', strength: 2 }`; lookups use the same collation |
| Unique slug | unique index | unique index (`E11000 duplicate key` → field error) |
| Exactly-once booking creation (`Idempotency-Key`) | `INSERT … ON CONFLICT DO NOTHING` | `insertOne` into a unique `(user_id, idempotency_key)` index; duplicate key error means someone else claimed it, so read theirs |
| Expire idempotency keys | cleanup job | **TTL index** on `expires_at` (the cleanup job still exists for the other collections) |
| Outbox: several relays never take the same event | `FOR UPDATE SKIP LOCKED` | a **lease**: `findOneAndUpdate` an event whose `locked_until` is null or past, setting `locked_until = now + 2 min`. Atomic per document, so two relays can't both claim one; a crashed relay's lease simply expires |
| Reminders sent exactly once | `UPDATE … SET reminder_sent_at = now() WHERE reminder_sent_at IS NULL RETURNING *` | the same as a `findOneAndUpdate` loop with `reminder_sent_at: null` in the filter |
| State machine (no lost transitions) | `UPDATE … WHERE id = $1 AND status = $2` | `findOneAndUpdate({ _id, status: from }, …)`; no document returned → 409 |
| Account lockout counter | `UPDATE … SET failed = failed + 1` | update **pipeline** with `$add` / `$cond` / `$$NOW`, so increment-and-maybe-lock is one atomic write |
| Provider sign-up (user + page) | transaction | transaction (`withTransaction`) |

The pattern throughout: **let one atomic operation on one document (or one
unique index) decide the race**, and reach for a multi-document transaction
only when a decision spans documents (capacity, sign-up, booking + outbox).

---

## 8. Injection

SQL injection was prevented by parameterized queries. MongoDB has its own
version: **operator injection**. If a request body like
`{ "email": { "$ne": null } }` reached a filter, it would match every user.
Three things prevent it here:

1. zod validates and coerces every input to a primitive before it reaches a
   service (`email` must be a string, ids must be 24-hex).
2. `oid()` converts ids explicitly and returns `null` for anything else.
3. Updates use field **whitelists** (`UPDATABLE` in the resource repository),
   so a client can't send `$set: { provider_id: … }` or an operator key.

Search text is escaped before it becomes a regular expression (Section 5 of
`V3.md`).

---

## 9. Observability

The `pg` pool's query hook became the driver's **command monitoring**
(`monitorCommands: true`): every `commandSucceeded` event records its duration
in the `db_query_duration_seconds` histogram, and commands slower than 200 ms
are logged. Handshake and heartbeat commands (`hello`, `ping`, auth) are
ignored. Readiness (`/health/ready`) runs `{ ping: 1 }`.

---

## 10. Trade-offs, honestly

- **Joins are more verbose.** `$lookup` pipelines are longer than SQL joins and
  easier to get subtly wrong. Embedding removed two of them.
- **Constraints are weaker by default.** There are no foreign keys: deleting a
  user does not cascade, and nothing stops a booking referencing a deleted
  calendar except the service code (calendars are deactivated, never
  deleted, for this reason). Webhook deletion cascades in the repository.
- **Transactions cost more** and require a replica set. Under heavy contention
  on one calendar, losers retry rather than wait, which wastes some work;
  measured here it stays well within limits, but a very hot calendar would
  benefit from a queue.
- **Schema flexibility** is real but was barely used: the validators
  deliberately give it back up. What MongoDB did make simpler: embedded
  opening hours and audit history, the TTL index, and the lease-based outbox.
