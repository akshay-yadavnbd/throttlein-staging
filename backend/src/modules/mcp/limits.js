/**
 * Rate, quota and concurrency limits for the connector, on the shared Redis
 * with a bounded in-process fallback (an outage lowers ceilings, it does not
 * open them). Concurrency is per process: this API runs as one instance.
 */
'use strict';
const { getClient } = require('../../database/redis');

const PREFIX = 'mcp:';
const MAX_LOCAL = 10000;
const local = new Map();
let lastSweep = 0;

function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60000 && local.size < MAX_LOCAL) return;
  for (const [k, v] of local) if (v.expires <= now) local.delete(k);
  lastSweep = now;
}

function localAdd(key, n, max, windowMs) {
  sweep();
  const now = Date.now();
  let bucket = local.get(key);
  if (!bucket || bucket.expires <= now) {
    if (!bucket && local.size >= MAX_LOCAL) return { allowed: false, count: max, degraded: true };
    bucket = { count: 0, expires: now + windowMs };
    local.set(key, bucket);
  }
  if (bucket.count + n > max) return { allowed: false, count: bucket.count, degraded: true };
  bucket.count += n;
  return { allowed: true, count: bucket.count, degraded: true };
}

// INCRBY only when it fits under the ceiling, setting the expiry on first use.
const RESERVE_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local n = tonumber(ARGV[1]); local max = tonumber(ARGV[2])
if cur + n > max then return {0, cur} end
local v = redis.call('INCRBY', KEYS[1], n)
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
return {1, v}`;

/** Count `n` against `key` if it fits within `max` per window; refuse without counting otherwise. */
async function reserve(key, n, max, windowMs) {
  const client = getClient();
  if (client) {
    try {
      const [ok, count] = await client.eval(RESERVE_LUA, 1, PREFIX + key, n, max, Math.ceil(windowMs / 1000));
      return { allowed: Number(ok) === 1, count: Number(count), degraded: false };
    } catch {
      /* fall back to the local counter */
    }
  }
  return localAdd(PREFIX + key, n, max, windowMs);
}

/** One hit against a fixed window (rate limits, lockouts). */
const hit = (key, max, windowMs) => reserve(key, 1, max, windowMs);

async function peek(key) {
  const client = getClient();
  if (client) {
    try {
      return Number(await client.get(PREFIX + key)) || 0;
    } catch {
      /* fall through */
    }
  }
  const bucket = local.get(PREFIX + key);
  return bucket && bucket.expires > Date.now() ? bucket.count : 0;
}

const slots = new Map();
/** In-process concurrency slot; returns a release function or null when full. */
function acquire(key, max) {
  const current = slots.get(key) || 0;
  if (current >= max) return null;
  slots.set(key, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (slots.get(key) || 1) - 1;
    if (n <= 0) slots.delete(key);
    else slots.set(key, n);
  };
}

module.exports = { reserve, hit, peek, acquire };
