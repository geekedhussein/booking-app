// ---------------------------------------------------------------------------
// LOAD TEST  (V2.12 → Part XI: load/performance testing)
//
// The only test tier that can falsify "no overbooking under load". Our earlier
// demo fired 6 concurrent requests; this drives HUNDREDS at a single slot, where
// lock contention, connection-pool limits and timeouts actually show up.
//
// It asserts the invariant that matters: however many requests fight for a
// capacity-N slot, EXACTLY N bookings exist afterwards.
//
// Usage:  node --env-file=.env scripts/load-test.js [concurrency] [capacity]
// (requires the API to be running)
// ---------------------------------------------------------------------------

import { col, oid, closeDb } from '../src/db/index.js';

const BASE = process.env.LOAD_TEST_URL ?? 'http://localhost:3000';
const CONCURRENCY = Number(process.argv[2] ?? 200);
const CAPACITY = Number(process.argv[3] ?? 5);

const post = async (path, body, token) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

function futureSlot(daysAhead, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { startsAt: `${date} ${p(hour)}:00`, endsAt: `${date} ${p(hour + 1)}:00` };
}

async function main() {
  console.log(
    `Load test: ${CONCURRENCY} concurrent requests for a capacity-${CAPACITY} slot\n`,
  );

  const email = `load_${Date.now()}@example.com`;
  await post('/v1/auth/register', { email, password: 'password123' });
  await col('users').updateOne({ email }, { $set: { role: 'staff' } });
  const login = await post('/v1/auth/login', { email, password: 'password123' });
  const token = login.body.data.accessToken;

  const created = await post(
    '/v1/resources',
    { name: `Load ${Date.now()}`, capacity: CAPACITY },
    token,
  );
  const resourceId = created.body.data.id;
  const slot = futureSlot(30, 9);

  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      post('/v1/bookings', { resourceId, ...slot }, token).catch((err) => ({
        status: 0,
        error: err.message,
      })),
    ),
  );
  const elapsed = Date.now() - started;

  const tally = {};
  for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;

  const confirmed = await col('bookings').countDocuments({
    resource_id: oid(resourceId),
    status: { $in: ['pending', 'confirmed'] },
  });

  console.log('Status codes:', tally);
  console.log(`Elapsed: ${elapsed}ms  (${Math.round((CONCURRENCY / elapsed) * 1000)} req/s)`);
  console.log(`Bookings actually created: ${confirmed} (capacity ${CAPACITY})`);

  const ok = confirmed === CAPACITY && (tally['201'] ?? 0) === CAPACITY;
  console.log(
    ok
      ? `\nPASS - exactly ${CAPACITY} bookings under ${CONCURRENCY}-way contention. No overbooking.`
      : `\nFAIL - expected exactly ${CAPACITY}, got ${confirmed} (201s: ${tally['201'] ?? 0}).`,
  );

  await closeDb();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Load test error:', err);
  await closeDb();
  process.exit(1);
});
