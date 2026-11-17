/**
 * Optional per-environment folder inside the shared S3 bucket.
 *
 * Production and staging share one bucket. Setting S3_KEY_PREFIX=staging
 * makes every object the staging API touches live under `staging/…`,
 * so the two environments can never read, overwrite or delete each
 * other's files while using the same bucket and credentials.
 *
 * The prefix is applied ONLY at the S3 boundary. Keys stored in the
 * database stay environment-neutral (`products/123-foo.png`,
 * `sellers/<slug>/kyc/…`): every validation rule, public-prefix
 * allowlist and ownership check in the app keeps inspecting the bare
 * key, and a database copied between environments needs no rewrite.
 *
 *   toObjectKey('products/a.png')          → 'staging/products/a.png'
 *   fromObjectKey('staging/products/a.png') → 'products/a.png'
 *
 * Unset (production, local dev) both functions return their input.
 */
'use strict';
const { env } = require('../config/env');

const raw = String(env.S3_KEY_PREFIX || '')
  .trim()
  .replace(/^\/+|\/+$/g, '');
if (raw && !/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i.test(raw)) {
  throw new Error(`S3_KEY_PREFIX must be a folder name such as "staging" (got "${raw}")`);
}

/** Prefix with trailing slash, or '' when unset. */
const S3_KEY_PREFIX = raw ? `${raw}/` : '';

/** Bare key (as stored in the DB) → object key inside the bucket. */
function toObjectKey(key) {
  if (!S3_KEY_PREFIX || typeof key !== 'string') return key;
  return `${S3_KEY_PREFIX}${key.replace(/^\/+/, '')}`;
}

/** Object key inside the bucket → bare key (as stored in the DB). */
function fromObjectKey(objectKey) {
  if (!S3_KEY_PREFIX || typeof objectKey !== 'string') return objectKey;
  return objectKey.startsWith(S3_KEY_PREFIX) ? objectKey.slice(S3_KEY_PREFIX.length) : objectKey;
}

module.exports = { S3_KEY_PREFIX, toObjectKey, fromObjectKey };
