/** Redis counters with a bounded local fallback: an outage must not disable login limits. */
const { getClient } = require('../database/redis');
const buckets = new Map();
let lastSweep = 0;
const MAX_BUCKETS = 10000;

function localLimit(key, max, windowSec) {
  const now = Date.now();
  if (now - lastSweep > 60000 || buckets.size >= MAX_BUCKETS) {
    for (const [id, bucket] of buckets) if (bucket.expires <= now) buckets.delete(id);
    lastSweep = now;
  }
  let bucket = buckets.get(key);
  if (!bucket || bucket.expires <= now) {
    // Do not evict live limits: rotating identifiers must not reset a victim's bucket.
    if (!bucket && buckets.size >= MAX_BUCKETS) return { allowed: false, remaining: 0, resetIn: 60 };
    bucket = { count: 0, expires: now + windowSec * 1000 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= max,
    remaining: Math.max(0, max - bucket.count),
    resetIn: Math.max(1, Math.ceil((bucket.expires - now) / 1000)),
  };
}

async function rateLimit(key, max, windowSec) {
  const c = getClient();
  if (c) {
    try {
      const [count, ttl] = await c.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 or redis.call('TTL',KEYS[1])<0 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('TTL',KEYS[1])}",
        1,
        key,
        windowSec,
      );
      return { allowed: count <= max, remaining: Math.max(0, max - count), resetIn: Math.max(1, ttl) };
    } catch (_) {
      /* Enforce a local limit while Redis is unavailable. */
    }
  }
  return localLimit(key, max, windowSec);
}
module.exports = { rateLimit };
