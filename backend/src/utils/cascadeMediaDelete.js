/**
 * Cascade-cleanup helper for Media deletes.
 *
 * When an admin removes a Media row (single or bulk), we ALSO sweep
 * every consuming model and pull / clear any reference that pointed
 * at the now-deleted key. Without this, records like PromoBlock,
 * HomeBanner, Product, etc. retain broken image keys and the
 * storefront keeps trying to render them (404 / leaf icon).
 *
 * Two field shapes are handled:
 *
 *   - "single"  → a String field. We `$set` it to '' on every doc
 *                 whose value matches one of the deleted keys.
 *   - "array"   → a [String] field. We `$pull` each matching key.
 *
 * The list mirrors `seedMediaBackfill`'s `sources`, which is the
 * authoritative inventory of image-bearing public fields.
 *
 * Failures per-collection are logged but never thrown — cleanup is
 * best-effort. A single bad collection update must not block the
 * Media delete that triggered it (or the other collections).
 */

// NOTE: Product is intentionally NOT in this list even though products
// have an `images` field. The Media library is the admin's shared bank
// (banners / brand logos / category icons / blog featured images / CMS
// page OG images). Product photos are attached to the product doc
// directly and never picked from the library UI. Cascading a Media
// delete into Product.images caused nine separate "why did all my
// product images vanish?" incidents in Q3 2026 — see docs in
// `seedMediaReferencePrune.js` for the root-cause writeup. If you ever
// re-add Product here, make the pull idempotent AND mirror colorImages
// back into `images` when the pull leaves the doc with an empty main
// gallery.
const { logger } = require('./logger');

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

/** Refuse to operate on non-admin keys even if a caller mistakenly
 *  passes them in. Seller (sellers/<slug>/...) / KYC / evidence /
 *  products/ keys are NEVER tracked in the Media library by design —
 *  the only way one would land here is via a bug elsewhere. Filtering
 *  at the source prevents repeats of the "boot prune nuked seller
 *  product images" incident. */
function isAdminKey(k) {
  if (typeof k !== 'string' || !k) return false;
  if (/\/kyc\//i.test(k)) return false;
  if (/(^|\/)evidence\//i.test(k)) return false;
  if (/^sellers\//i.test(k)) return false;
  // Superadmin product uploads land under the flat `products/` prefix
  // (see resolveKeyPrefix in middleware/upload.js). They must NEVER be
  // treated as admin-library-owned even though they don't sit under
  // `sellers/`. This is the guard that stops the recurring wipe.
  if (/^products\//i.test(k)) return false;
  return true;
}

/**
 * Remove every reference to `keys` from every public-image field
 * across the catalogued models. Returns a summary `{ collection: {
 * docsTouched, singlesCleared, arraysPulled } }` for logging.
 */
async function cascadeMediaDelete(keys) {
  const list = Array.isArray(keys) ? keys.filter(isAdminKey) : [];
  if (list.length === 0) return {};

  const summary = {};

  for (const spec of REFERENCE_SPEC) {
    let Model;
    try {
      Model = require(`../models/${spec.model}`);
    } catch {
      continue; // Model not installed — skip silently
    }

    let singlesCleared = 0;
    let arraysPulled = 0;

    // Clear single-string fields that match any deleted key.
    // One updateMany per field keeps the Mongo query simple and lets
    // each field have its own index hit.
    for (const field of spec.singles) {
      try {
        const res = await Model.updateMany({ [field]: { $in: list } }, { $set: { [field]: '' } });
        singlesCleared += res.modifiedCount || 0;
      } catch (err) {
        logger.warn({ err }, `[cascadeMediaDelete] ${spec.model}.${field} clear failed:`);
      }
    }

    // Pull matching strings out of array-of-string fields.
    for (const field of spec.arrays) {
      try {
        const res = await Model.updateMany({ [field]: { $in: list } }, { $pull: { [field]: { $in: list } } });
        arraysPulled += res.modifiedCount || 0;
      } catch (err) {
        logger.warn({ err }, `[cascadeMediaDelete] ${spec.model}.${field} pull failed:`);
      }
    }

    const touched = singlesCleared + arraysPulled;
    if (touched > 0) {
      summary[spec.model] = { singlesCleared, arraysPulled };
    }
  }

  return summary;
}

module.exports = { cascadeMediaDelete };
