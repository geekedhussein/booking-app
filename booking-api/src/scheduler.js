// ---------------------------------------------------------------------------
// SCHEDULER PROCESS  (V2.9 → Part VII: scheduling / time-triggered work)
//
// A SEPARATE process (run: `npm run scheduler`) that ticks on an interval and
// runs recurring jobs. This is the counterpart to event-triggered work: nothing
// "happens" to prompt these — they run because it's time.
//
// MULTI-INSTANCE SAFETY — two independent defenses, because these send customer
// email and a duplicate is user-visible:
//   1. A Redis distributed lock (SET NX PX) so only ONE instance runs a given
//      job per tick. The TTL means a crashed holder's lock expires rather than
//      blocking forever.
//   2. Atomic claiming in the database: each due booking is claimed with a
//      findOneAndUpdate whose filter includes reminder_sent_at: null, so even if
//      two instances somehow ran concurrently, each booking is claimed by
//      exactly one.
//
// Reminders go through the OUTBOX (V2.3), not straight to the queue, so the
// "claim + record intent" is one atomic transaction — a crash after claiming
// can't lose the reminder.
// ---------------------------------------------------------------------------

import { withTransaction, closeDb } from './db/index.js';
import { redis } from './cache/redis.js';
import { closeCache } from './cache/index.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { sleep } from './utils/sleep.js';
import * as bookingRepo from './repositories/booking.repository.js';
import * as outboxRepo from './repositories/outbox.repository.js';
import * as cleanupRepo from './repositories/cleanup.repository.js';

/**
 * Run `fn` only if we win a short-lived Redis lock. SET key NX PX ttl is the
 * canonical single-node distributed lock: NX = only if absent, PX = auto-expire.
 */
async function withLock(name, ttlMs, fn) {
  const key = `scheduler:lock:${name}`;
  const token = `${process.pid}-${Date.now()}`;
  let acquired;
  try {
    acquired = (await redis.set(key, token, 'PX', ttlMs, 'NX')) === 'OK';
  } catch (err) {
    logger.warn({ err: err.message, name }, 'lock acquisition failed — skipping tick');
    return;
  }
  if (!acquired) return; // another instance is running this job

  try {
    await fn();
  } finally {
    // Release only if we still hold it (don't delete someone else's lock after
    // our TTL expired). Compare-and-delete via a tiny Lua script.
    try {
      await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        key,
        token,
      );
    } catch {
      /* lock will expire on its own */
    }
  }
}

// --- Job: send booking reminders -------------------------------------------
async function sendReminders() {
  const claimed = await withTransaction(async (session) => {
    // Claim + mark in ONE statement — no window for a double send.
    const rows = await bookingRepo.claimBookingsDueForReminder(
      { leadHours: config.REMINDER_LEAD_HOURS, limit: config.REMINDER_BATCH_SIZE },
      session,
    );

    // Record the email intent in the outbox, in the SAME transaction as the
    // claim (V2.3): the claim and the intent commit together or not at all.
    for (const b of rows) {
      await outboxRepo.insertEvent(
        {
          aggregateType: 'booking',
          aggregateId: b.id,
          eventType: 'booking.reminder',
          payload: {
            id: b.id,
            resourceId: b.resource_id,
            userId: b.user_id,
            startsAt: b.starts_at,
            endsAt: b.ends_at,
          },
        },
        session,
      );
    }
    return rows.length;
  });

  if (claimed > 0) logger.info({ count: claimed }, 'queued booking reminders');
  return claimed;
}

// --- Job: retention cleanup -------------------------------------------------
async function runCleanup() {
  const days = config.RETENTION_DAYS;
  const [idem, authTok, refreshTok, outbox] = await Promise.all([
    cleanupRepo.deleteExpiredIdempotencyKeys(),
    cleanupRepo.deleteStaleAuthTokens(days),
    cleanupRepo.deleteStaleRefreshTokens(days),
    cleanupRepo.deleteProcessedOutbox(days),
  ]);
  const total = idem + authTok + refreshTok + outbox;
  if (total > 0) {
    logger.info({ idem, authTok, refreshTok, outbox }, 'cleanup removed stale rows');
  }
  return { idem, authTok, refreshTok, outbox };
}

// --- Tick loop --------------------------------------------------------------
let running = true;
let ticks = 0;

async function tick() {
  // Reminders every tick; cleanup only every 60th tick (it's housekeeping, not
  // time-sensitive, and shouldn't add load every minute).
  await withLock('reminders', config.SCHEDULER_INTERVAL_MS * 2, sendReminders);
  if (ticks % 60 === 0) {
    await withLock('cleanup', 5 * 60_000, runCleanup);
  }
  ticks += 1;
}

async function loop() {
  logger.info(
    { intervalMs: config.SCHEDULER_INTERVAL_MS, leadHours: config.REMINDER_LEAD_HOURS },
    'Scheduler started',
  );
  while (running) {
    try {
      await tick();
    } catch (err) {
      // A failing tick must never kill the scheduler — log and try again next time.
      logger.error({ err: err.message }, 'scheduler tick failed');
    }
    await sleep(config.SCHEDULER_INTERVAL_MS);
  }
}

async function shutdown(signal) {
  logger.info(`${signal} received — stopping scheduler`);
  running = false;
  await Promise.allSettled([closeCache(), closeDb()]);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Exported for tests; only auto-run when executed directly.
export { sendReminders, runCleanup };

if (process.env.SCHEDULER_RUN_ONCE === '1') {
  // One-shot mode, used by tests/manual verification.
  tick()
    .then(async () => {
      await Promise.allSettled([closeCache(), closeDb()]);
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err: err.message }, 'one-shot tick failed');
      process.exit(1);
    });
} else {
  loop().catch((err) => {
    logger.fatal({ err }, 'scheduler crashed');
    process.exit(1);
  });
}
