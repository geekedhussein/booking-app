// ---------------------------------------------------------------------------
// MONGODB CLIENT  (Part VI data layer; Part IX connection pooling)
//
// One MongoClient per process. Like the pg Pool it replaces, the client keeps a
// POOL of open connections and hands them to each operation, so requests reuse
// warm connections instead of paying a TCP + auth handshake every time.
//
// The client connects lazily on the first operation, so importing this module
// never blocks startup. Command monitoring feeds the DB latency histogram and
// logs slow commands (Part VIII observability) — the same signals the SQL layer
// produced, without touching any repository.
// ---------------------------------------------------------------------------

import { MongoClient } from 'mongodb';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { dbQueryDuration } from '../observability/metrics.js';

export const client = new MongoClient(config.MONGODB_URI, {
  maxPoolSize: 10, //                at most 10 concurrent connections from this process
  serverSelectionTimeoutMS: 5_000, // fail fast if no server is reachable in 5s
  monitorCommands: true, //          emit an event per command (metrics + slow log)
});

// The database is named in the URI path (mongodb://host/booking → "booking").
export const db = client.db();

// Commands the driver runs on its own to manage connections are noise here.
const IGNORED = new Set([
  'hello',
  'isMaster',
  'ping',
  'saslStart',
  'saslContinue',
  'endSessions',
]);

client.on('commandSucceeded', (event) => {
  if (IGNORED.has(event.commandName)) return;
  const ms = event.duration;
  dbQueryDuration.observe(ms / 1000);
  // Surface slow commands so they're findable before they become an incident.
  if (ms > 200) logger.warn({ ms, command: event.commandName }, 'Slow database command');
});

client.on('commandFailed', (event) => {
  if (IGNORED.has(event.commandName)) return;
  logger.debug(
    { command: event.commandName, err: event.failure?.message },
    'Database command failed',
  );
});
