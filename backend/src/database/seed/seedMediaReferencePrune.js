/**
 * Boot-time reference prune.
 *
 * Sweeps every public image field across the catalogued models and
 * clears any reference whose key was once tracked in the Media
 * library but has since been deleted from it. Fixes "I deleted this
 * from Media library but the banner / promo block still shows it".
 *
 * IMPORTANT: only ADMIN-trackable keys are candidates for pruning.
 * Seller-owned uploads (sellers/<slug>/...), KYC documents, and
 * return-request evidence are deliberately NOT stored in Media —
 * comparing those keys to Media would always flag them as "missing"
 * and the cascade would yank seller product photos out of
 * `Product.images`. The filter mirrors `isAdminTrackable` in the
 * live `trackMediaUpload` middleware.
 *
 * Implementation: for each model.field, build the SET of admin-keyed
 * references; ask Media which of those exist; pass the missing ones
 * to `cascadeMediaDelete` (which knows how to pull / $set them).
 *
 * Idempotent. Mirrors the inventory in `cascadeMediaDelete.js`.
 */
const Media = require('../../modules/media/media.model');
const { cascadeMediaDelete } = require('../../utils/cascadeMediaDelete');
const { logger } = require('../../utils/logger');

// Product images are DELIBERATELY NOT in this list. See the same-shape
// spec in `cascadeMediaDelete.js` for the full postmortem — TL;DR:
// Products own their own gallery. When a superadmin uploads a product
// photo, it lands under the flat `products/` prefix (not `sellers/…`)
// and the Media library backfill would race with the upload. Any key
// that didn't have a matching Media row on the next server boot got
// classed as "orphan" and cascade-pruned via raw `$pull`, silently
// wiping the product gallery and bypassing every schema + controller
// guard. Products' image lifecycle stays inside the controller +
// schema guards, not the Media library.
const REFERENCE_SPEC = [
  { model: 'HomeBanner', singles: ['image', 'imageMobile'], arrays: ['brandLogos'] },
  { model: 'PromoBlock', singles: [], arrays: ['images'] },
  { model: 'SellerCta', singles: ['bgImage', 'portraitImage'], arrays: [] },
  { model: 'Brand', singles: ['logo'], arrays: [] },
  { model: 'Category', singles: ['image', 'icon'], arrays: [] },
  { model: 'BlogPost', singles: ['featuredImage', 'ogImage'], arrays: [] },
  { model: 'BlogAuthor', singles: ['avatarUrl'], arrays: [] },
  { model: 'Page', singles: ['ogImage'], arrays: [] },
];

/** A key is only a candidate for orphan-pruning if it would have
 *  been TRACKED in the Media library to begin with. Seller-owned
 *  uploads (sellers/<slug>/...), KYC documents, return-request
 *  evidence, AND flat product uploads (products/...) are all excluded —
 *  they live outside the admin library by design and a Media lookup
 *  will always come up empty for them. */
function isPruneCandidate(k) {
  if (typeof k !== 'string' || !k) return false;
  if (/\/kyc\//i.test(k)) return false;
  if (/(^|\/)evidence\//i.test(k)) return false;
  if (/^sellers\//i.test(k)) return false;
  // The extra guard that finally stops the recurring wipe: flat product
  // photo keys never get promoted to the Media library, so treating
  // them as orphans and cascading a `$pull` was the exact root cause of
  // nine separate "my product images vanished after restart" incidents.
  if (/^products\//i.test(k)) return false;
  return true;
}

async function harvestReferencedKeys() {
  const all = new Set();
  for (const spec of REFERENCE_SPEC) {
    let Model;
    try {
      Model = require(`../models/${spec.model}`);
    } catch {
      continue;
    }
    const projection = {};
    for (const f of spec.singles) projection[f] = 1;
    for (const f of spec.arrays) projection[f] = 1;
    let cursor;
    try {
      cursor = Model.find({}, projection).lean().cursor();
    } catch {
      continue;
    }
    for await (const doc of cursor) {
      for (const f of spec.singles) {
        if (isPruneCandidate(doc[f])) all.add(doc[f]);
      }
      for (const f of spec.arrays) {
        const arr = doc[f];
        if (Array.isArray(arr)) {
          for (const v of arr) {
            if (isPruneCandidate(v)) all.add(v);
          }
        }
      }
    }
  }
  return Array.from(all);
}

async function seedMediaReferencePrune() {
  let referenced;
  try {
    referenced = await harvestReferencedKeys();
  } catch (err) {
    logger.warn({ err }, '[seedMediaReferencePrune] harvest failed:');
    return;
  }
  if (referenced.length === 0) return;

  // Which of those keys actually exist in the Media library?
  let alive;
  try {
    const docs = await Media.find({ key: { $in: referenced } }, { key: 1 }).lean();
    alive = new Set(docs.map((d) => d.key));
  } catch (err) {
    logger.warn({ err }, '[seedMediaReferencePrune] media lookup failed:');
    return;
  }

  const orphaned = referenced.filter((k) => !alive.has(k));
  if (orphaned.length === 0) return;

  const summary = await cascadeMediaDelete(orphaned);
  const touched = Object.values(summary).reduce((n, s) => n + (s.singlesCleared || 0) + (s.arraysPulled || 0), 0);
  if (touched > 0) {
    logger.info(
      `[seedMediaReferencePrune] cleared ${touched} dangling reference(s) across %s`,
      Object.keys(summary).join(', '),
    );
  }
}

module.exports = seedMediaReferencePrune;
