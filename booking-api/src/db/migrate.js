// ---------------------------------------------------------------------------
// MIGRATION RUNNER  (Part VI: Migrations)
//
// A migration is a version-controlled, incremental, forward-only change to the
// database. MongoDB has no schema to ALTER, but a production database still
// needs versioned changes: validators (the shape documents must have) and
// indexes (speed, and uniqueness under concurrency). This hand-written runner
// shows the whole mechanism tools like migrate-mongo perform for you:
//
//   1. Keep a bookkeeping collection (schema_migrations) of applied files.
//   2. List the NNN_*.js files in migrations/, sorted by name (001_, 002_, …:
//      filename order IS apply order). Files starting with "_" are helpers.
//   3. Skip those already recorded.
//   4. Run each pending file's `up(db)`, then record it.
//
// Unlike PostgreSQL, MongoDB can't wrap collection and index creation in one
// transaction, so a file can't be rolled back halfway. Instead every migration
// is written to be IDEMPOTENT (safe to run again): it creates what's missing
// and updates what exists. If one fails, fix it and re-run; the runner halts at
// the failure so later files never run against a half-migrated database.
//
// Run with:  npm run migrate
// ---------------------------------------------------------------------------

import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { db, closeDb } from './index.js';
import { logger } from '../utils/logger.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function run() {
  const ledger = db.collection('schema_migrations');
  await ledger.createIndex({ filename: 1 }, { unique: true });
  const applied = new Set((await ledger.find({}).toArray()).map((m) => m.filename));

  const files = (await readdir(migrationsDir)).filter((f) => /^\d+_.*\.js$/.test(f)).sort();
  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    logger.info('No pending migrations — database is up to date.');
    return;
  }

  for (const file of pending) {
    const migration = await import(pathToFileURL(join(migrationsDir, file)).href);
    logger.info(
      `Applying migration: ${file}${migration.description ? ` (${migration.description})` : ''}`,
    );
    try {
      await migration.up(db);
      await ledger.insertOne({ filename: file, applied_at: new Date() });
      logger.info(`  ✓ ${file}`);
    } catch (err) {
      // Fail LOUDLY and STOP. A failed migration must not be silently skipped,
      // and later migrations must not run on top of it.
      logger.error({ err }, `  ✗ ${file} failed. Halting; fix it and run again.`);
      throw err;
    }
  }
  logger.info(`Applied ${pending.length} migration(s).`);
}

run()
  .then(() => closeDb())
  .catch(async (err) => {
    logger.fatal({ err }, 'Migration run failed');
    await closeDb().catch(() => {});
    process.exit(1);
  });
