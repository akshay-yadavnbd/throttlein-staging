/**
 * Read-through cache helpers — function names mirror Fllat's
 * `Backend/utils/redisCache.js` so the pattern is portable between
 * the two codebases.
 *
 *   getOrSetCache(key, ttlSec, fetchFn) — return cached value, or call
 *     fetchFn(), store its result under `key` for `ttlSec` seconds, and
 *     return it. Falls back to fetchFn() if Redis is down or returns
 *     a corrupt value.
 *
 *   deleteCacheByPattern(pattern) — wipe every key matching the glob.
 *     Uses SCAN (non-blocking) instead of Fllat's `redis.keys()` so it's
 *     safe on production keyspaces; behaviour from the caller's side is
 *     identical.
 */
const { getClient } = require('../database/redis');
const { logger } = require('./logger');

async function getOrSetCache(key, ttlInSeconds, fetchFn) {
  const redis = getClient();
  if (!redis) return fetchFn();
  try {
    const cached = await redis.get(key);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* corrupt entry, fall through */
      }
    }
  } catch (err) {
    logger.error({ err }, 'Redis error in getOrSetCache:');
    return fetchFn(); // fallback
  }
  const freshData = await fetchFn();
  if (freshData !== undefined) {
    try {
      await redis.set(key, JSON.stringify(freshData), 'EX', Math.max(1, Math.floor(ttlInSeconds)));
    } catch (err) {
      logger.error({ err }, 'Redis write error in getOrSetCache:');
    }
  }
  return freshData;
}

async function deleteCacheByPattern(pattern) {
  const redis = getClient();
  if (!redis) return;
  try {
    // SCAN-based pattern delete — safer than KEYS on large keyspaces.
    // For simple single keys (no `*`) skip the scan.
    if (!pattern.includes('*')) {
      await redis.del(pattern);
      return;
    }
    const stream = redis.scanStream({ match: pattern, count: 200 });
    const keys = [];
    await new Promise((resolve, reject) => {
      stream.on('data', (chunk) => keys.push(...chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    if (keys.length) {
      await redis.del(...keys);
      logger.info(`Deleted ${keys.length} Redis keys matching: ${pattern}`);
    }
  } catch (err) {
    logger.error({ err }, 'Redis error in deleteCacheByPattern:');
  }
}

module.exports = { getOrSetCache, deleteCacheByPattern };
