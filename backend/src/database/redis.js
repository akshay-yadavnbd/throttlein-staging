const { env } = require('../config/env');
const { logger } = require('../utils/logger');
/**
 * Shared Redis client — pattern lifted from Fllat (Backend/db/config/redis.js).
 *
 * Supports two env styles:
 *   - REDIS_URL=redis://[:password@]host:port[/db]
 *   - REDIS_HOST / REDIS_PORT / REDIS_PASSWORD / REDIS_DB
 *
 * REDIS_URL wins if both are set. Setting REDIS_DISABLED=true (or leaving
 * both REDIS_URL and REDIS_HOST empty) returns `null` from getClient()
 * so caching is disabled; rate limits continue in a bounded local fallback.
 *
 * Connection is lazy + fail-open: short timeouts so the API doesn't hang
 * when Redis is unreachable.
 */
// Optional-dependency: the API can boot without ioredis installed.
// Cache + rate-limit helpers gracefully no-op when the client is null.
// Install with `npm install ioredis` to activate caching / distributed
// rate limiting. Local dev usually doesn't need it — the guard below
// treats a missing module the same as REDIS_DISABLED=true.
let Redis = null;
try {
  Redis = require('ioredis');
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND') {
    logger.warn(
      '[redis] ioredis not installed — cache disabled; rate limits use local fallback. `npm install ioredis` to enable.',
    );
  } else {
    throw err;
  }
}

const REDIS_URL = env.REDIS_URL || '';
const REDIS_HOST = env.REDIS_HOST || '';
const REDIS_PORT = Number(env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = env.REDIS_PASSWORD || undefined;
const REDIS_DB = Number(env.REDIS_DB) || 0;
const DISABLED = !Redis || env.REDIS_DISABLED || (!REDIS_URL && !REDIS_HOST);

let client = null;
let connectionWarned = false;

function getClient() {
  if (DISABLED) return null;
  if (client) return client;

  const sharedOpts = {
    connectTimeout: 2000,
    commandTimeout: 1500,
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 5 && !connectionWarned) {
        logger.warn('[redis] still unreachable, falling back to no-cache mode');
        connectionWarned = true;
      }
      return Math.min(times * 200, 5000);
    },
  };

  client = REDIS_URL
    ? new Redis(REDIS_URL, sharedOpts)
    : new Redis({
        ...sharedOpts,
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD,
        db: REDIS_DB,
      });

  client.on('connect', () => {
    // Log which logical DB we're actually talking to so mis-configured
    // .env files surface at boot instead of hiding inside "why are other
    // projects' keys showing up on my cache inspector" tickets. Reads
    // straight from the negotiated ioredis options, not the env, so
    // this is the ground-truth value.
    const dbNum = typeof client.options?.db === 'number' ? client.options.db : 0;
    if (connectionWarned) logger.info(`[redis] reconnected (db=${dbNum})`);
    else logger.info(`[redis] connected (db=${dbNum})`);
    connectionWarned = false;
  });
  client.on('error', (e) => {
    if (!connectionWarned) {
      logger.warn({ err: e }, '[redis] connect error:');
      connectionWarned = true;
    }
  });

  client.connect().catch(() => {
    /* error event handles it */
  });
  return client;
}

module.exports = { getClient };
