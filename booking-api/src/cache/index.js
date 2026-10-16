// ---------------------------------------------------------------------------
// CACHE HELPERS  (Phase 1 → Part VI: cache-aside + invalidation)
//
// Small JSON-oriented helpers over Redis. EVERY operation is wrapped so that if
// Redis is unavailable, a get returns null (→ cache miss → DB), and a set/delete
// is a silent no-op. The caller never has to think about Redis being down.
// ---------------------------------------------------------------------------

import { redis } from './redis.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export async function cacheGetJson(key) {
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ err: err.message, key }, 'cache get failed — treating as miss');
    return null; // graceful degradation: behave as a miss
  }
}

export async function cacheSetJson(key, value, ttlSeconds = config.CACHE_TTL_SECONDS) {
  try {
    // EX sets a TTL (Part VI eviction): stale data can only live so long, which
    // bounds the damage of any missed invalidation.
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ err: err.message, key }, 'cache set failed — skipping');
  }
}

// Invalidate every key under a prefix (Part VI: invalidation on write). Uses
// SCAN, not KEYS: SCAN iterates in small batches without blocking the Redis
// server, which KEYS would do on a large keyspace (a real production footgun).
export async function cacheDelByPrefix(prefix) {
  try {
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== '0');
    return deleted;
  } catch (err) {
    logger.warn({ err: err.message, prefix }, 'cache invalidation failed');
    return 0;
  }
}

export async function closeCache() {
  try {
    await redis.quit();
  } catch {
    /* already closed */
  }
}
