// ---------------------------------------------------------------------------
// E2E TEST — real HTTP through the whole stack  (Phase 1 → Part XI)
//
// The top of the pyramid: no mocks, no shortcuts. supertest drives the actual
// Express app (middleware chain, validation, auth, service, repository, DB,
// cache, queue) exactly as a real client would. Slowest and most realistic —
// it's what proves the PIECES fit together, not just that each works alone.
//
// Run with: node --env-file=.env.test --test tests/e2e/*.test.js
// ---------------------------------------------------------------------------

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { col, closeDb } from '../../src/db/index.js';
import { closeCache } from '../../src/cache/index.js';
import { closeQueue } from '../../src/queue/notifications.js';
import { closePubSub } from '../../src/realtime/pubsub.js';

const app = createApp();

// Compute a future local date-time N days out (bookings must be in the future,
// V2.1) so this test doesn't rot as real time passes hardcoded dates.
function futureLocal(daysAhead, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(hour)}:00`;
}
const DAY = 7;

before(async () => {
  // Empty every collection, keeping the validators and indexes the migrations made.
  const names = [
    'users',
    'providers',
    'resources',
    'bookings',
    'outbox',
    'refresh_tokens',
    'auth_tokens',
    'idempotency_keys',
    'webhook_subscriptions',
    'webhook_deliveries',
  ];
  await Promise.all(names.map((n) => col(n).deleteMany({})));
});

after(async () => {
  // Close every open handle so the test process exits cleanly (Part VIII).
  await Promise.allSettled([closeQueue(), closePubSub(), closeCache(), closeDb()]);
});

test('full booking flow: register → auth → book → conflict', async () => {
  // 1. Register a customer.
  const reg = await request(app)
    .post('/v1/auth/register')
    .send({ email: 'e2e@x.com', password: 'password123' })
    .expect(201);
  const customerToken = reg.body.data.accessToken;
  assert.ok(customerToken);

  // 2. A customer may NOT create resources (RBAC → 403).
  await request(app)
    .post('/v1/resources')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ name: 'E2E Court' })
    .expect(403);

  // 3. Promote to staff (out of band), then log in again for a staff token.
  await col('users').updateOne({ email: 'e2e@x.com' }, { $set: { role: 'staff' } });
  const login = await request(app)
    .post('/v1/auth/login')
    .send({ email: 'e2e@x.com', password: 'password123' })
    .expect(200);
  const staffToken = login.body.data.accessToken;

  // 4. Staff creates a resource (201) and gets its id.
  const created = await request(app)
    .post('/v1/resources')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ name: 'E2E Court' })
    .expect(201);
  const resourceId = created.body.data.id;

  // 5. Book a slot (201).
  await request(app)
    .post('/v1/bookings')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ resourceId, startsAt: futureLocal(DAY, 9), endsAt: futureLocal(DAY, 10) })
    .expect(201);

  // 6. An overlapping booking is rejected end-to-end (409).
  const conflict = await request(app)
    .post('/v1/bookings')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      resourceId,
      startsAt: futureLocal(DAY, 9) /* overlaps */,
      endsAt: futureLocal(DAY, 11),
    })
    .expect(409);
  assert.equal(conflict.body.error.code, 'CONFLICT');

  // 7. The user sees exactly one booking.
  const mine = await request(app)
    .get('/v1/bookings/me')
    .set('Authorization', `Bearer ${staffToken}`)
    .expect(200);
  assert.equal(mine.body.pagination.total, 1);
});

test('validation rejects a malformed booking (400)', async () => {
  const reg = await request(app)
    .post('/v1/auth/register')
    .send({ email: 'e2e2@x.com', password: 'password123' })
    .expect(201);
  const token = reg.body.data.accessToken;

  const res = await request(app)
    .post('/v1/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({
      resourceId: '000000000000000000000000',
      startsAt: futureLocal(DAY, 12),
      endsAt: futureLocal(DAY, 11),
    })
    .expect(400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('cursor pagination: first page opts in with ?paginate=cursor (regression)', async () => {
  const reg = await request(app)
    .post('/v1/auth/register')
    .send({ email: 'cursor@x.com', password: 'password123' })
    .expect(201);
  const res = await request(app)
    .get('/v1/bookings/me?paginate=cursor&limit=5')
    .set('Authorization', `Bearer ${reg.body.data.accessToken}`)
    .expect(200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok('nextCursor' in res.body.pagination);
});

// --- V3: service providers -------------------------------------------------

async function signUp(body) {
  const res = await request(app)
    .post('/v1/auth/register')
    .send({ password: 'password123', ...body })
    .expect(201);
  return { token: res.body.data.accessToken, user: res.body.data.user };
}

test('provider sign-up creates a page; signup can never grant staff', async () => {
  const { user } = await signUp({
    email: 'lee@x.com',
    accountType: 'provider',
    displayName: 'Dr Amélie Lee',
    headline: 'Physiotherapy',
  });
  assert.equal(user.role, 'provider');
  assert.equal(user.provider.slug, 'dr-amelie-lee');

  // Same name → the next free address, not an error.
  const twin = await signUp({
    email: 'lee2@x.com',
    accountType: 'provider',
    displayName: 'Dr Amélie Lee',
  });
  assert.equal(twin.user.provider.slug, 'dr-amelie-lee-2');

  // Choosing a taken address is a field error the form can show.
  const taken = await request(app)
    .post('/v1/auth/register')
    .send({
      email: 'lee3@x.com',
      password: 'password123',
      accountType: 'provider',
      displayName: 'Lee',
      slug: 'dr-amelie-lee',
    })
    .expect(400);
  assert.equal(taken.body.error.details[0].field, 'slug');
  // …and the whole sign-up rolled back, so the email is still free.
  await signUp({ email: 'lee3@x.com', accountType: 'provider', displayName: 'Lee' });

  await request(app)
    .post('/v1/auth/register')
    .send({ email: 'boss@x.com', password: 'password123', accountType: 'staff' })
    .expect(400);
  const client = await signUp({ email: 'client@x.com' });
  assert.equal(client.user.role, 'customer');
  assert.equal(client.user.provider, null);
});

test('providers manage only their own calendars and see bookings made with them', async () => {
  const lee = await signUp({
    email: 'p1@x.com',
    accountType: 'provider',
    displayName: 'Studio One',
  });
  const rival = await signUp({
    email: 'p2@x.com',
    accountType: 'provider',
    displayName: 'Studio Two',
  });
  const client = await signUp({ email: 'c1@x.com' });
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  const cal = await request(app)
    .post('/v1/resources')
    .set(auth(lee.token))
    .send({ name: 'Private session' })
    .expect(201);
  const id = cal.body.data.id;
  assert.equal(cal.body.data.providerSlug, 'studio-one');

  // Ownership, not just role: another provider is refused everywhere.
  await request(app)
    .patch(`/v1/resources/${id}`)
    .set(auth(rival.token))
    .send({ name: 'x' })
    .expect(403);
  await request(app)
    .put(`/v1/resources/${id}/availability`)
    .set(auth(rival.token))
    .send({ windows: [] })
    .expect(403);
  await request(app)
    .post('/v1/resources')
    .set(auth(client.token))
    .send({ name: 'x' })
    .expect(403);

  const booking = await request(app)
    .post('/v1/bookings')
    .set(auth(client.token))
    .send({ resourceId: id, startsAt: futureLocal(DAY, 10), endsAt: futureLocal(DAY, 11) })
    .expect(201);
  const bid = booking.body.data.id;

  // The client's list names the calendar and its provider.
  const mine = await request(app)
    .get('/v1/bookings/me?paginate=cursor')
    .set(auth(client.token))
    .expect(200);
  assert.equal(mine.body.data[0].providerName, 'Studio One');
  assert.equal(mine.body.data[0].resourceName, 'Private session');

  // The provider's dashboard shows it, with who booked; the rival's doesn't.
  const to = futureLocal(DAY + 1, 0).slice(0, 10);
  const dash = await request(app)
    .get(`/v1/providers/me/bookings?to=${to}`)
    .set(auth(lee.token))
    .expect(200);
  assert.equal(dash.body.data.length, 1);
  assert.equal(dash.body.data[0].userEmail, 'c1@x.com');
  const other = await request(app)
    .get(`/v1/providers/me/bookings?to=${to}`)
    .set(auth(rival.token))
    .expect(200);
  assert.equal(other.body.data.length, 0);
  await request(app).get('/v1/providers/me/bookings').set(auth(client.token)).expect(403);

  await request(app).post(`/v1/bookings/${bid}/complete`).set(auth(rival.token)).expect(403);
  await request(app).delete(`/v1/bookings/${bid}`).set(auth(rival.token)).expect(403);
  await request(app).post(`/v1/bookings/${bid}/no-show`).set(auth(lee.token)).expect(200);
});

test('directory and public page list only calendars taking bookings', async () => {
  const p = await signUp({
    email: 'p3@x.com',
    accountType: 'provider',
    displayName: 'Court Club',
  });
  const auth = { Authorization: `Bearer ${p.token}` };

  // No calendars yet → not in the directory, but the page itself exists.
  let dir = await request(app).get('/v1/providers?q=court').expect(200);
  assert.equal(dir.body.data.length, 0);
  await request(app).get('/v1/providers/court-club').expect(200);

  const a = await request(app)
    .post('/v1/resources')
    .set(auth)
    .send({ name: 'Court A' })
    .expect(201);
  await request(app).post('/v1/resources').set(auth).send({ name: 'Court B' }).expect(201);
  await request(app).delete(`/v1/resources/${a.body.data.id}`).set(auth).expect(204);

  dir = await request(app).get('/v1/providers?q=court').expect(200);
  assert.equal(dir.body.data[0].calendarCount, 1);
  const page = await request(app).get('/v1/providers/court-club').expect(200);
  assert.deepEqual(
    page.body.data.calendars.map((c) => c.name),
    ['Court B'],
  );
  // The owner still sees the paused one.
  const me = await request(app).get('/v1/providers/me').set(auth).expect(200);
  assert.equal(me.body.data.calendars.length, 2);
  await request(app).get('/v1/providers/no-such-page').expect(404);
});
