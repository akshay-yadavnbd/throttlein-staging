const { env } = require('../config/env');
/**
 * Mongoose hook that auto-deletes orphaned S3 objects when a
 * document's image fields are replaced.
 *
 * Why this exists
 *   Without it, replacing a product image or a brand logo (or any
 *   other image field) only changes the DB reference — the old S3
 *   object stays behind as an orphan. Over time the bucket fills
 *   with garbage. This hook diffs the field values pre-save vs
 *   post-save and deletes any S3 key that was removed.
 *
 * Usage
 *   const { attachImageCleanup } = require('../utils/imageCleanup');
 *   attachImageCleanup(productSchema, [
 *     { path: 'images',      isArray: true },
 *     { path: 'ogImage'                    },
 *     { path: 'description', isHtml: true  },  // parses inline <img>
 *   ]);
 *   module.exports = mongoose.model('Product', productSchema);
 *
 * Field shapes supported
 *   { path }                         — single string field (e.g. logo)
 *   { path, isArray: true }          — array of strings (e.g. images[])
 *   { path, isHtml:  true }          — HTML body; inline image refs
 *                                      (\`/api/files/<key>\`) are extracted
 *   { path, isDocArray: true,        — array of subdocuments, each holding
 *     itemPath: 'images' }             an array of strings at itemPath
 *                                      (e.g. colorImages[].images)
 *
 * Nested paths use dot-notation:
 *   { path: 'kyc.gstCertificate' }
 *
 * Assumptions
 *   - One S3 key = one owner. Two records pointing at the same key
 *     would cause one save to delete a key the other still references.
 *     Our schema is set up so this can't happen (every upload mints
 *     a unique timestamped key) — so we don't pay the cost of an
 *     "any other record using this key?" lookup before deleting.
 *   - The hook NEVER throws on cleanup failure. A bad delete logs a
 *     warning but never fails the save — better to leak one orphan
 *     than reject a legitimate update because S3 was flaky.
 */
('use strict');

const { fromObjectKey } = require('./s3KeyPrefix');

const BUCKET = env.S3_BUCKET_NAME || '';

/**
 * Extract a single S3 object key from whatever shape a field stores
 * (bare key, /api/files/<key> proxy URL, full S3 URL). Returns null
 * for non-S3 values (data URIs, /uploads/ disk paths, external CDN).
 */
function toS3Key(stored) {
  if (!stored || typeof stored !== 'string') return null;
  if (stored.startsWith('data:')) return null;
  if (stored.startsWith('/uploads/')) return null;
  // Bare key — no leading slash, no protocol, looks like a folder/file path.
  if (/^[a-z]/i.test(stored) && !stored.startsWith('http') && !stored.startsWith('/')) {
    return stored;
  }
  const proxy = stored.match(/\/api\/files\/(.+)$/);
  if (proxy) return decodeURIComponent(proxy[1]);
  if (BUCKET && /^https?:\/\//i.test(stored) && stored.includes(BUCKET)) {
    try {
      const url = new URL(stored);
      return fromObjectKey(decodeURIComponent(url.pathname.replace(/^\//, '')));
    } catch {
      return null;
    }
  }
  return null;
}

/** Parse `<img src="/api/files/...">` and full S3 URLs out of an HTML body. */
function extractKeysFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const out = [];
  // Proxy URLs
  for (const m of html.matchAll(/\/api\/files\/([^"'\s>]+)/g)) {
    out.push(decodeURIComponent(m[1]));
  }
  // Full S3 URLs (defensive — pre-presign era)
  if (BUCKET) {
    const re = new RegExp(`https?:[^"'\\s>]*${BUCKET}[^"'\\s>]*`, 'g');
    for (const m of html.matchAll(re)) {
      const k = toS3Key(m[0]);
      if (k) out.push(k);
    }
  }
  return out;
}

/**
 * Wire the diff-and-delete hooks onto a schema. Safe to call multiple
 * times per schema — the second call is a no-op via a marker flag.
 */
function attachImageCleanup(_schema, _fields) {
  // References are not proof of ownership. Removing an image from a product
  // must not delete another seller's object (or a shared library asset).
  // Physical deletion is handled by authorized media endpoints and the
  // explicit orphan-cleanup script after reference checks.
}

module.exports = {
  attachImageCleanup,
  toS3Key,
  extractKeysFromHtml,
};
