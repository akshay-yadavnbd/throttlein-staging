/**
 * One-time backfill — scan existing records for image keys and add
 * any we don't already have to the Media collection.
 *
 * Runs on every boot but is cheap: it queries each model's image
 * fields, builds a Set of unique keys, then does a single bulkWrite
 * of upserts. Re-running it never duplicates because Media.key has
 * a unique index.
 *
 * Sources scanned (matches the PUBLIC image fields the storefront
 * actually serves — KYC / evidence are intentionally excluded):
 *   - HomeBanner → image, imageMobile, brandLogos[]
 *   - PromoBlock → images[]
 *   - SellerCta  → bgImage, portraitImage
 *   - Brand      → logo
 *   - Category   → image, icon
 *   - Product    → images[]
 *   - BlogPost   → featuredImage, ogImage
 *   - BlogAuthor → avatarUrl
 *   - Page       → ogImage
 */
const Media = require('../../modules/media/media.model');
const upload = require('../../middleware/upload');
const { logger } = require('../../utils/logger');

/** Convert a possibly-wrapped value to the bare key stored in S3.
 *  Returns null for anything we shouldn't track (URLs, blobs, dataURIs). */
function toKey(v) {
  if (typeof v !== 'string' || !v) return null;
  // Already a full URL or data-URI → not an S3 key we own
  if (/^https?:\/\//i.test(v)) return null;
  if (v.startsWith('data:')) return null;
  // Disk-mode path — keep as the bare /uploads/<file> form
  if (v.startsWith('/uploads/')) return v;
  // Strip legacy proxy prefix
  return upload.normaliseToKey(v);
}

/** Decide whether a key belongs in the admin Media library.
 *  Mirrors the live trackMediaUpload middleware's predicate so the
 *  backfill never seeds anything the live tracker would reject.
 *  Excludes: KYC, evidence, and ALL seller-owned uploads. */
function isAdminTrackable(k) {
  if (!k) return false;
  if (/\/kyc\//i.test(k)) return false;
  if (/(^|\/)evidence\//i.test(k)) return false;
  if (/^sellers\//i.test(k)) return false;
  // Flat `products/...` uploads belong to the product doc, never the
  // shared admin library. Excluding them here + in the reference prune
  // guard is the fix that finally stops the recurring image wipe. See
  // the writeup in seedMediaReferencePrune.js for the full postmortem.
  if (/^products\//i.test(k)) return false;
  return true;
}

async function harvest(seenKeys) {
  // Lazy-require each model so we don't crash on boot if one happens
  // to be removed in the future. Iterating a known-good list and
  // tolerating null model lookups keeps this resilient.
  const tryAdd = (v) => {
    const k = toKey(v);
    if (k && isAdminTrackable(k)) seenKeys.add(k);
  };
  const fromArray = (a) => Array.isArray(a) && a.forEach(tryAdd);

  const sources = [
    {
      name: 'HomeBanner',
      pick: (d) => {
        tryAdd(d.image);
        tryAdd(d.imageMobile);
        fromArray(d.brandLogos);
      },
    },
    {
      name: 'PromoBlock',
      pick: (d) => fromArray(d.images),
    },
    {
      name: 'SellerCta',
      pick: (d) => {
        tryAdd(d.bgImage);
        tryAdd(d.portraitImage);
      },
    },
    {
      name: 'Brand',
      pick: (d) => tryAdd(d.logo),
    },
    {
      name: 'Category',
      pick: (d) => {
        tryAdd(d.image);
        tryAdd(d.icon);
      },
    },
    {
      name: 'Product',
      pick: (d) => fromArray(d.images),
    },
    {
      name: 'BlogPost',
      pick: (d) => {
        tryAdd(d.featuredImage);
        tryAdd(d.ogImage);
      },
    },
    {
      name: 'BlogAuthor',
      pick: (d) => tryAdd(d.avatarUrl),
    },
    {
      name: 'Page',
      pick: (d) => tryAdd(d.ogImage),
    },
  ];

  for (const s of sources) {
    let Model;
    try {
      Model = require(`../models/${s.name}`);
    } catch {
      continue; // Model missing — skip silently
    }
    let cursor;
    try {
      cursor = Model.find({}).lean().cursor();
    } catch (err) {
      logger.warn({ err }, `[seedMediaBackfill] cursor failed for ${s.name}:`);
      continue;
    }
    for await (const doc of cursor) {
      try {
        s.pick(doc);
      } catch (err) {
        logger.warn({ err }, `[seedMediaBackfill] pick failed for ${s.name}:`);
      }
    }
  }
}

/** Remove any Media rows whose key now fails the admin-trackable
 *  filter (e.g. seller uploads that landed in the library before the
 *  filter existed). Runs on every boot — cheap query, idempotent. */
async function pruneNonAdminRows() {
  try {
    const res = await Media.deleteMany({
      $or: [{ key: /^sellers\//i }, { key: /\/kyc\//i }, { key: /(^|\/)evidence\//i }],
    });
    if (res && res.deletedCount > 0) {
      logger.info(`[seedMediaBackfill] pruned ${res.deletedCount} non-admin entries from library`);
    }
  } catch (err) {
    logger.warn({ err }, '[seedMediaBackfill] prune failed:');
  }
}

async function seedMediaBackfill() {
  // First, scrub any non-admin rows that pre-date the filter.
  await pruneNonAdminRows();

  const keys = new Set();
  try {
    await harvest(keys);
  } catch (err) {
    logger.warn({ err }, '[seedMediaBackfill] harvest failed:');
    return;
  }
  if (keys.size === 0) return;

  // Filter out keys we already have rows for.
  const existing = await Media.find({ key: { $in: Array.from(keys) } }, { key: 1 }).lean();
  const have = new Set(existing.map((m) => m.key));
  const missing = Array.from(keys).filter((k) => !have.has(k));
  if (missing.length === 0) return;

  // Bulk insert in chunks of 500 so a single S3-key conflict doesn't
  // abort the whole batch. ordered:false skips dupes and continues.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const slice = missing.slice(i, i + CHUNK);
    const rows = slice.map((key) => {
      const folder = key.includes('/') ? key.split('/').slice(0, -1).join('/') : '';
      return {
        key,
        // filename is the last path segment of the key
        filename: key.split('/').pop() || '',
        mimeType: '',
        size: 0,
        folder,
      };
    });
    try {
      const res = await Media.insertMany(rows, { ordered: false });
      inserted += res.length;
    } catch (err) {
      // ordered:false → BulkWriteError; we still count what landed.
      if (err && err.insertedDocs) inserted += err.insertedDocs.length;
    }
  }
  if (inserted > 0) {
    logger.info(`[seedMediaBackfill] added ${inserted} existing assets to library`);
  }
}

module.exports = seedMediaBackfill;
