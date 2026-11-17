/** Upload keys and prefixes: unique object names, the per-request folder, and stored-value normalisation. Pure. */
const path = require('path');

/** Build a safe, unique S3 key for an uploaded image. */
function makeKey(originalname, prefix = 'products') {
  const safeBase = path
    .basename(originalname, path.extname(originalname))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}/${Date.now()}-${rand}-${safeBase}${path.extname(originalname).toLowerCase()}`;
}

/**
 * Resolve the S3 key prefix for an upload by inspecting the request.
 *
 * `req._uploadPrefix` (set by `setUploadPrefix(...)` below) takes
 * precedence — the route opts in explicitly via a middleware. Otherwise
 * we infer from the authenticated user:
 *   - role 'seller'   → sellers/<id>/<purpose>/
 *   - everyone else   → flat `products/` (legacy admin uploads, etc.)
 *
 * `purpose` defaults to 'products' but can be overridden when the
 * route handles non-product files (KYC docs, profile photos, …).
 */
function resolveKeyPrefix(req, purpose = 'products') {
  // Route-level override wins. e.g. seller KYC routes set
  // req._uploadPrefix = 'sellers/<slug>/kyc' so EVERY field on that
  // route lands under the right folder regardless of role inference.
  if (req && req._uploadPrefix) return req._uploadPrefix;

  const user = req && req.user;
  if (user && user._id && user.role === 'seller') {
    // Folder name = seller's URL slug (auto-derived from storeName by
    // the User pre-save hook, unique by index). Falls back to _id when
    // slug is missing — shouldn't happen for sellers post-onboarding
    // but keeps the legacy bucket layout addressable for older accounts.
    const folder = user.slug || user._id;
    return `sellers/${folder}/${purpose}`;
  }
  // Admin uploads (brand logos, category icons, banners, blog images)
  // keep the legacy flat prefix — they aren't tied to a deletable
  // owner, so seller-cleanup doesn't apply.
  return purpose;
}

/**
 * Express middleware factory — call inline before a multer middleware
 * to lock in the upload prefix for that request.
 *
 * Usage:
 *   router.post('/upload',
 *     protect,
 *     setUploadPrefix((req) => `sellers/${req.user._id}/kyc`),
 *     upload.single('file'),
 *     handler);
 *
 * The function form lets the route compute the prefix from `req`
 * after auth middleware has populated `req.user`.
 */
function setUploadPrefix(prefixOrFn) {
  return (req, _res, next) => {
    try {
      req._uploadPrefix = typeof prefixOrFn === 'function' ? prefixOrFn(req) : prefixOrFn;
    } catch (err) {
      return next(err);
    }
    next();
  };
}

/**
 * Strip any legacy wrapper around an S3 key so the bare key is left over.
 * Handles:
 *   "products/abc.png"             → "products/abc.png"   (already bare)
 *   "/api/files/products/abc.png"  → "products/abc.png"   (legacy proxy)
 *   "api/files/products/abc.png"   → "products/abc.png"   (legacy proxy, no slash)
 *   "https://.../<key>?X-Amz..."   → returns unchanged (already a URL)
 *   "/uploads/123-foo.png"         → returns unchanged (disk-stored)
 *
 * Returns `null` if the input doesn't look like an S3 key at all so callers
 * can decide whether to fall through.
 */
function normaliseToKey(s) {
  if (typeof s !== 'string' || !s) return null;
  // Already an absolute URL — pass through unchanged
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return null;
  // Disk-stored asset — leave alone
  if (s.startsWith('/uploads/')) return null;
  // Frontend-static asset (ships inside the Next.js build's /public, e.g.
  // "/images/seller-category/why-illustration.png") — NOT an S3 key.
  // CMS fields may reference these; rewriting one into a bucket URL
  // manufactures a 404.
  if (s.startsWith('/images/')) return null;
  // Strip the legacy /api/files/ proxy prefix
  let key = s.replace(/^\/+/, ''); // strip leading slashes
  key = key.replace(/^api\/files\//, ''); // strip api/files/ prefix
  return key || null;
}

/** Private uploads (KYC documents, return evidence) never go to the public bucket or proxy. */
const isPrivatePrefix = (prefix) => /(^|\/)(kyc|return-evidence)(\/|$)/.test(prefix);

module.exports = { makeKey, resolveKeyPrefix, setUploadPrefix, normaliseToKey, isPrivatePrefix };
