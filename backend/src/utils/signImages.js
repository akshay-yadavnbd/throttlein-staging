/**
 * Recursive serializer that walks an object (or array of objects) and
 * rewrites every image-looking field into a fetchable URL. Designed to
 * run once on the response payload before res.json(), so controllers don't
 * have to be image-aware.
 *
 * Two URL strategies, picked per-field-name:
 *
 *   - PUBLIC fields  -> emit `/api/files/<key>` (via upload.publicFileUrl).
 *     Stable, never expires, cacheable for a year. Used for any image
 *     that ends up in HTML reachable by crawlers / social previewers
 *     (products, brands, categories, banners, blog covers, etc.).
 *
 *   - PRIVATE fields -> emit a real presigned S3 URL with a 1 h TTL
 *     (via upload.presignKey). Used for sensitive uploads — KYC
 *     documents (`file` inside pan/gst/cheque/aadhaar sub-docs) and
 *     return-request `evidence` media. These should NOT be permanently
 *     fetchable by URL.
 *
 * Rules:
 *   - Strings in known PUBLIC image fields (`image`, `icon`, `logo`,
 *     `avatar`, `thumbnail`, `imageMobile`, `ogImage`) are rewritten
 *     to stable proxy URLs.
 *   - Strings in known PRIVATE fields (`file`) are presigned.
 *   - Arrays in `images` are rewritten to stable proxy URLs; arrays
 *     in `evidence` (return-request media) are presigned.
 *   - Mongoose documents (`obj.toObject`) are converted to plain objects so
 *     the resulting JSON has the patched URLs. The original Mongoose doc is
 *     left untouched.
 *   - Public absolute URLs and disk paths pass through. Private references
 *     are canonicalized and signed again, including legacy disk files.
 *
 * Why the split? Before this, every image field was presigned with a
 * 1 hour TTL — which broke SEO. Semrush flagged 67 "broken internal
 * images" because the URLs in our rendered HTML expired before the
 * audit bot followed them. The new public strategy makes those URLs
 * permanent + Cloudflare-cacheable while leaving sensitive uploads
 * (KYC, evidence) properly access-controlled via time-limited signing.
 */
const upload = require('../middleware/upload');

/** Single-string public image fields -> stable proxy URL.
 *  Add a new field name here whenever a model introduces an
 *  image-bearing field. Otherwise the bare S3 key passes through
 *  unrewritten and the frontend ends up with a broken URL. */
const PUBLIC_SINGLE_FIELDS = new Set([
  'image',
  'icon',
  'logo',
  'avatar',
  'avatarUrl', // BlogAuthor
  'thumbnail',
  'imageMobile',
  'listingImage',
  'ogImage',
  'featuredImage', // BlogPost
  'bgImage', // SellerCta
  'portraitImage', // SellerCta
]);

/** Single-string private fields -> presigned (time-limited). */
const PRIVATE_SINGLE_FIELDS = new Set([
  'file', // KYC documents (new sub-doc shape) — pan.file, gst.file, cheque.file, aadhaar.file
  // Legacy KYC fields — top-level URLs on the seller doc. Same sensitivity
  // class as `file` above, so they get the same 1-hour presigned S3 treatment.
  // Without these, the serializer leaked the bare S3 key to the admin and
  // "View file" produced a malformed URL like `api.throttlein.comsellers/...`.
  'gstCertificate',
  'panCard',
  'cancelledCheque',
]);

/** Array fields containing public image paths -> stable proxy URLs. */
const PUBLIC_ARRAY_FIELDS = new Set([
  'images',
  'brandLogos', // HomeBanner — overlay brand-pill assets
]);

/** Array fields containing private paths -> presigned. */
const PRIVATE_ARRAY_FIELDS = new Set([
  'evidence', // return-request media
]);

/** Arrays of OBJECTS whose named string field is private and must be
 *  presigned. Return-request media is stored as
 *  `attachments: [{ url, kind, mimeType, sizeBytes }]` (Order.js), which
 *  the plain-string sets above can't reach — before this, the bare key
 *  leaked to clients and the files rode the public proxy (audit A04). */
const PRIVATE_OBJECT_ARRAY_FIELDS = new Map([
  ['attachments', 'url'], // returnRequests[].attachments
]);

/** Whether a path actually needs rewriting (i.e. it's a stored S3 key,
 *  not already a URL or disk path). */
function needsRewrite(s) {
  if (typeof s !== 'string' || !s) return false;
  if (/^https?:\/\//i.test(s)) return false;
  if (s.startsWith('data:')) return false;
  if (s.startsWith('/uploads/')) return false;
  return true;
}

/** Public rewrite — synchronous, no S3 API call. */
function publicString(s) {
  if (!needsRewrite(s)) return s;
  return upload.publicFileUrl(s);
}

/** Private rewrite — async because it signs against AWS. */
async function privateString(s) {
  return await upload.presignKey(s);
}

/**
 * Walk a value (any JSON-compatible shape) and presign image-looking fields.
 * `seen` is a WeakSet used to avoid infinite loops on circular references.
 */
async function walk(value, seen = new WeakSet()) {
  if (value == null) return value;

  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => walk(v, seen)));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);

    // Convert Mongoose docs to plain objects. Buffer / Date / ObjectId etc.
    // should pass through unchanged (they fail the toObject check).
    let obj = value;
    if (typeof value.toObject === 'function') {
      obj = value.toObject({ getters: false, virtuals: false });
    }
    if (obj === null || typeof obj !== 'object') return obj;
    if (Buffer.isBuffer(obj)) return obj;
    if (obj instanceof Date) return obj;

    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string') {
        if (PUBLIC_SINGLE_FIELDS.has(k) && needsRewrite(v)) {
          obj[k] = publicString(v);
        } else if (PRIVATE_SINGLE_FIELDS.has(k)) {
          obj[k] = await privateString(v);
        }
      } else if (Array.isArray(v)) {
        if (PUBLIC_ARRAY_FIELDS.has(k)) {
          obj[k] = v.map(publicString);
        } else if (PRIVATE_ARRAY_FIELDS.has(k)) {
          obj[k] = await Promise.all(v.map(privateString));
        } else if (PRIVATE_OBJECT_ARRAY_FIELDS.has(k)) {
          const field = PRIVATE_OBJECT_ARRAY_FIELDS.get(k);
          obj[k] = await Promise.all(
            v.map(async (entry) => {
              if (!entry || typeof entry !== 'object') return entry;
              const plain =
                typeof entry.toObject === 'function' ? entry.toObject({ getters: false, virtuals: false }) : entry;
              if (typeof plain[field] === 'string') {
                plain[field] = await privateString(plain[field]);
              }
              return plain;
            }),
          );
        } else {
          obj[k] = await walk(v, seen);
        }
      } else if (v && typeof v === 'object') {
        obj[k] = await walk(v, seen);
      }
    }
    return obj;
  }

  return value;
}

/**
 * Public entry point. Pass anything (single doc, array of docs, plain
 * response shape like { items: [...], total }) — returns a deeply-transformed
 * copy with presigned URLs in place of S3 keys.
 *
 * Works with disk and S3 storage; private files always require expiring links.
 */
async function signImagesIn(payload) {
  return walk(payload);
}

module.exports = { signImagesIn };
