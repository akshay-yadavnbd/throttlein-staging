/**
 * Redis inspector — powers the Cache Inspector admin page.
 *
 * Ported from Fllat's `Backend/utils/redisInspector.js`. The Fllat build uses
 * ES modules and a shared default-exported client; THROTTLEIN uses CommonJS
 * and `getClient()` from `../database/redis.js`. Everything else stays functionally
 * identical so the frontend contract matches:
 *
 *   { summary, groups }
 *
 * All keyspace traversal goes through SCAN (not KEYS) so this stays safe to
 * run on production. Bulk deletes are chunked and shrink into DEL calls.
 */
const { getClient } = require('../database/redis');

const bytesHuman = (n) => {
  if (n == null) return 'N/A';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let x = Number(n) || 0;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i += 1;
  }
  return `${x.toFixed(2)} ${u[i]}`;
};

function parseInfo(raw) {
  const info = { memory: {}, keyspace: {} };
  if (!raw) return info;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('used_memory_human:')) info.memory.used_memory_human = line.split(':')[1];
    if (line.startsWith('used_memory_rss_human:')) info.memory.used_memory_rss_human = line.split(':')[1];
    if (line.startsWith('maxmemory_human:')) info.memory.maxmemory_human = line.split(':')[1];
    if (line.startsWith('total_system_memory_human:')) info.memory.total_system_memory_human = line.split(':')[1];
    if (/^db\d+:/.test(line)) {
      const [db, rest] = line.split(':');
      const parts = Object.fromEntries(rest.split(',').map((p) => p.split('=')));
      info.keyspace[db] = {
        keys: Number(parts.keys || 0),
        expires: Number(parts.expires || 0),
        avg_ttl: Number(parts.avg_ttl || 0),
      };
    }
  }
  return info;
}

const TTL_BUCKETS = [
  { label: '<10m', min: 0, max: 600 },
  { label: '10m–1h', min: 600, max: 3600 },
  { label: '1–6h', min: 3600, max: 21600 },
  { label: '6–24h', min: 21600, max: 86400 },
  { label: '>24h', min: 86400, max: Infinity },
];

async function inspectRedisKeys(
  pattern = '*',
  { scanCount = 500, topN = 10, includeGroupItems = true, oversizeThresholdBytes = 512 * 1024 } = {},
) {
  const redis = getClient();
  if (!redis) {
    return {
      summary: { error: 'Redis is not configured on this instance.' },
      groups: {},
    };
  }

  try {
    let info;
    try {
      info = parseInfo(await redis.info());
    } catch {
      info = parseInfo(null);
    }

    let cursor = '0';
    const groups = {};
    const groupAgg = {};
    const ttlBuckets = TTL_BUCKETS.map((b) => ({ ...b, count: 0, sizeBytes: 0 }));

    let totalKeys = 0;
    let totalSizeBytes = 0;
    let expiringCount = 0;
    let noExpiryCount = 0;
    let ttlSum = 0;
    let ttlCount = 0;
    let ttlMin = Infinity;
    let ttlMax = -Infinity;

    const largest = [];
    const nearestExpiry = [];
    const oversizedKeys = [];

    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', scanCount);
      cursor = next;
      if (!keys.length) continue;

      const pipe = redis.multi();
      keys.forEach((k) => {
        pipe.ttl(k);
        pipe.type(k);
        pipe.strlen(k);
      });
      const replies = await pipe.exec();

      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        const ttlSeconds = replies[i * 3 + 0]?.[1];
        const type = replies[i * 3 + 1]?.[1];
        const strlen = replies[i * 3 + 2]?.[1];

        const ttl = typeof ttlSeconds === 'number' ? ttlSeconds : -2;
        const t = typeof type === 'string' ? type : 'unknown';

        let sizeBytes = null;
        if (t === 'string' && typeof strlen === 'number') sizeBytes = strlen;

        totalKeys += 1;
        if (typeof sizeBytes === 'number') totalSizeBytes += sizeBytes;

        if (ttl === -1) {
          noExpiryCount += 1;
        } else if (ttl >= 0) {
          expiringCount += 1;
          ttlSum += ttl;
          ttlCount += 1;
          if (ttl < ttlMin) ttlMin = ttl;
          if (ttl > ttlMax) ttlMax = ttl;

          const buck = ttlBuckets.find((b) => ttl >= b.min && ttl < b.max);
          if (buck) {
            buck.count += 1;
            if (typeof sizeBytes === 'number') buck.sizeBytes += sizeBytes;
          }
        }

        const [prefixRaw] = key.split(':');
        const prefix = prefixRaw || 'misc';

        if (!groupAgg[prefix]) groupAgg[prefix] = { count: 0, totalSizeBytes: 0, expiring: 0, noExpiry: 0 };
        groupAgg[prefix].count += 1;
        if (typeof sizeBytes === 'number') groupAgg[prefix].totalSizeBytes += sizeBytes;
        if (ttl === -1) groupAgg[prefix].noExpiry += 1;
        else if (ttl >= 0) groupAgg[prefix].expiring += 1;

        if (typeof sizeBytes === 'number') {
          largest.push({ key, sizeBytes, ttlSeconds: ttl });
          if (sizeBytes >= oversizeThresholdBytes) oversizedKeys.push({ key, sizeBytes, ttlSeconds: ttl });
        }
        if (ttl >= 0) {
          nearestExpiry.push({ key, ttlSeconds: ttl, sizeBytes: sizeBytes ?? null });
        }

        if (includeGroupItems) {
          if (!groups[prefix]) groups[prefix] = [];
          groups[prefix].push({
            key,
            ttl: ttl === -1 ? 'No Expiry' : ttl === -2 ? 'Expired/NA' : `${ttl}s`,
            ttlSeconds: ttl,
            type: t,
            size: typeof sizeBytes === 'number' ? bytesHuman(sizeBytes) : 'N/A',
            sizeBytes,
          });
        }
      }
    } while (cursor !== '0');

    largest.sort((a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1));
    nearestExpiry.sort((a, b) => (a.ttlSeconds ?? Infinity) - (b.ttlSeconds ?? Infinity));
    oversizedKeys.sort((a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1));

    /** @type {Array<Record<string, any>>} */
    const groupsSummary = Object.entries(groupAgg).map(([group, agg]) => ({
      group,
      count: agg.count,
      totalSizeBytes: agg.totalSizeBytes,
      totalSize: bytesHuman(agg.totalSizeBytes),
      expiring: agg.expiring,
      noExpiry: agg.noExpiry,
      avgSizeBytes: agg.count ? Math.round(agg.totalSizeBytes / agg.count) : 0,
      avgSize: bytesHuman(agg.count ? Math.round(agg.totalSizeBytes / agg.count) : 0),
    }));

    for (const g of groupsSummary) {
      g.percentOfKeys = totalKeys ? Number(((g.count / totalKeys) * 100).toFixed(2)) : 0;
      g.percentOfSize = totalSizeBytes ? Number(((g.totalSizeBytes / totalSizeBytes) * 100).toFixed(2)) : 0;
    }

    groupsSummary.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes);

    // Connection diagnostics — surfaced in the UI so misconfigurations
    // (running against DB 0 by accident when the .env said DB 1, etc.)
    // are visible without having to shell into Redis. ioredis exposes
    // the negotiated DB via `redis.options.db`; SERVER's `CLIENT INFO`
    // would confirm it but adds a round-trip and requires Redis 6.2+.
    let connectedDb = null;
    try {
      connectedDb = typeof redis.options?.db === 'number' ? redis.options.db : null;
    } catch {
      /* noop — never fail the whole inspect over this */
    }

    const summary = {
      pattern,
      connection: {
        // Which logical Redis DB this backend is actually talking to.
        // If this doesn't match your `.env`'s REDIS_DB you either forgot
        // to restart the backend after editing .env, or another env
        // variable (e.g. REDIS_URL) is overriding the config path.
        db: connectedDb,
      },
      totals: {
        keys: totalKeys,
        groups: Object.keys(groupAgg).length,
        sizeBytes: totalSizeBytes,
        sizeHuman: bytesHuman(totalSizeBytes),
      },
      expiry: {
        expiring: expiringCount,
        noExpiry: noExpiryCount,
        avgTTLSeconds: ttlCount ? Math.round(ttlSum / ttlCount) : 0,
        minTTLSeconds: ttlCount ? ttlMin : 0,
        maxTTLSeconds: ttlCount ? ttlMax : 0,
        buckets: ttlBuckets.map((b) => ({
          label: b.label,
          count: b.count,
          sizeBytes: b.sizeBytes,
          size: bytesHuman(b.sizeBytes),
          percentOfKeys: totalKeys ? Number(((b.count / totalKeys) * 100).toFixed(2)) : 0,
        })),
      },
      memory: {
        used_memory_human: info.memory.used_memory_human || null,
        used_memory_rss_human: info.memory.used_memory_rss_human || null,
        maxmemory_human: info.memory.maxmemory_human || null,
        total_system_memory_human: info.memory.total_system_memory_human || null,
        keyspace: info.keyspace,
      },
      topLargestKeys: largest.slice(0, topN).map((k) => ({
        key: k.key,
        sizeBytes: k.sizeBytes,
        size: bytesHuman(k.sizeBytes),
        ttlSeconds: k.ttlSeconds,
      })),
      topNearestExpiry: nearestExpiry.slice(0, topN).map((k) => ({
        key: k.key,
        ttlSeconds: k.ttlSeconds,
        sizeBytes: k.sizeBytes,
        size: typeof k.sizeBytes === 'number' ? bytesHuman(k.sizeBytes) : 'N/A',
      })),
      oversizedKeys: oversizedKeys.slice(0, topN).map((k) => ({
        key: k.key,
        sizeBytes: k.sizeBytes,
        size: bytesHuman(k.sizeBytes),
        ttlSeconds: k.ttlSeconds,
      })),
      groupsSummary,
      advice: buildAdvice({ groupsSummary, largest, noExpiryCount, oversizeThresholdBytes }),
    };

    return { summary, groups };
  } catch (err) {
    console.error('Redis inspection failed:', err);
    return { summary: { error: err.message }, groups: {} };
  }
}

function buildAdvice({ groupsSummary, largest, noExpiryCount, oversizeThresholdBytes }) {
  const tips = [];
  const biggestGroup = groupsSummary[0];
  if (biggestGroup?.percentOfSize >= 70) {
    tips.push(
      `Group "${biggestGroup.group}" holds ${biggestGroup.percentOfSize}% of cache size. Consider shorter TTL or slimming payloads there.`,
    );
  }
  if (noExpiryCount > 0) {
    tips.push(`${noExpiryCount} keys have no expiry. Add TTLs or a janitor to prevent bloat.`);
  }
  const huge = largest.filter((k) => (k.sizeBytes ?? 0) >= oversizeThresholdBytes);
  if (huge.length) {
    tips.push(`${huge.length} keys exceed ${bytesHuman(oversizeThresholdBytes)}. Consider paging or compressing.`);
  }
  if (!tips.length) tips.push('All good. Nothing obviously risky detected.');
  return tips;
}

async function deleteByPattern(patterns, opts = {}) {
  const redis = getClient();
  if (!redis) return { totalDeleted: 0, details: [] };

  const scanCount = opts.scanCount ?? 500;
  const chunkSize = opts.chunkSize ?? 500;

  const pats = Array.isArray(patterns) ? patterns : [patterns];
  const details = [];
  let totalDeleted = 0;

  for (const p of pats) {
    if (!p || typeof p !== 'string') continue;
    let cursor = '0';
    let deleted = 0;

    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', p, 'COUNT', scanCount);
      cursor = next;
      if (keys.length) {
        for (let i = 0; i < keys.length; i += chunkSize) {
          const slice = keys.slice(i, i + chunkSize);
          deleted += await redis.del(...slice);
        }
      }
    } while (cursor !== '0');

    details.push({ pattern: p, deleted });
    totalDeleted += deleted;
  }

  return { totalDeleted, details };
}

async function deleteByPrefixes(prefixes, opts = {}) {
  const arr = Array.isArray(prefixes) ? prefixes : [prefixes];
  const patterns = [];
  for (const pre of arr) {
    if (!pre || typeof pre !== 'string') continue;
    patterns.push(pre.includes('*') ? pre : `${pre.replace(/:?$/, ':')}*`);
    if (!pre.includes('*')) patterns.push(pre);
  }
  return deleteByPattern(patterns, opts);
}

module.exports = { inspectRedisKeys, deleteByPattern, deleteByPrefixes };
