// ---------------------------------------------------------------------------
// REDIS CACHE CONNECTION  (Phase 1 → Part VI caching + Part VIII degradation)
//
// A dedicated ioredis connection for CACHING (the queue gets its own connection
// — BullMQ requires different settings). The key design goal here is that a
// Redis outage must NEVER take the app down: maxRetriesPerRequest is small so a
// command fails fast when Redis is unreachable, and the cache helpers catch that
// and treat it as a miss (fall back to the database). Cache is an optimization,
// not a source of truth (Part VI).
// ---------------------------------------------------------------------------

import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export const redis = new Redis(config.REDIS_URL, {
  // Fail a command after a couple of retries instead of buffering forever when
  // Redis is down — so the cache helper can fall back to the DB quickly.
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err) => {
  // Log at warn, not error: a cache blip is not an app emergency.
  logger.warn({ err: err.message }, 'Redis cache connection error');
});
redis.on('connect', () => logger.info('Redis cache connected'));
