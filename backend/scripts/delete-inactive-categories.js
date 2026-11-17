/**
 * delete-inactive-categories.js
 *
 * Permanently DELETES categories that are invisible on the storefront:
 * every category that is inactive itself OR sits under an inactive
 * ancestor (the public tree hides whole subtrees, so those descendants
 * never render either).
 *
 * Safety rails:
 *   - A candidate that still has PRODUCTS pointing at it (via
 *     `product.category` or `product.bike`) is SKIPPED — deleting it
 *     would leave products with a dead reference. The report lists
 *     them so you can reassign the products first (or reactivate the
 *     category).
 *   - If a candidate is skipped, all its ANCESTORS are skipped too, so
 *     we never delete a parent out from under a surviving child.
 *   - Admin Page records that reference deleted categories are cleaned:
 *     ids pulled from `filter.categories`, `filter.category` /
 *     `parentCategory` nulled.
 *   - Deletion runs through each doc's delete hooks, so S3 icon images
 *     belonging to the removed categories are cleaned up as well.
 *
 * DRY RUN by default; --apply to execute.
 *
 *   node scripts/delete-inactive-categories.js
 *   node scripts/delete-inactive-categories.js --apply
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Category = require('../src/modules/catalog/category.model');
const Product = require('../src/modules/products/product.model');
const Page = require('../src/modules/cms/page.model');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (--apply to execute)'}\n`);

  const cats = await Category.find({});
  const byId = new Map(cats.map((c) => [String(c._id), c]));

  // A category is "hidden" when it or ANY ancestor is inactive — the
  // public tree renders active nodes recursively, so an active child
  // under an inactive parent never shows either.
  const hiddenCache = new Map();
  function isHidden(c) {
    const key = String(c._id);
    if (hiddenCache.has(key)) return hiddenCache.get(key);
    let cur = c;
    let hidden = false;
    const seen = new Set();
    while (cur) {
      if (seen.has(String(cur._id))) break; // cycle guard
      seen.add(String(cur._id));
      if (cur.isActive === false) {
        hidden = true;
        break;
      }
      cur = cur.parent ? byId.get(String(cur.parent)) : null;
    }
    hiddenCache.set(key, hidden);
    return hidden;
  }

  const candidates = cats.filter(isHidden);
  if (candidates.length === 0) {
    console.log('No inactive/hidden categories found. Nothing to do.');
    process.exit(0);
  }

  // Product usage per candidate — a category still referenced by
  // products must survive until those products are reassigned.
  const excluded = new Set(); // ids kept because of product refs (or a kept descendant)
  const usage = new Map(); // id -> { asCategory, asBike }
  for (const c of candidates) {
    const [asCategory, asBike] = await Promise.all([
      Product.countDocuments({ category: c._id }),
      Product.countDocuments({ bike: c._id }),
    ]);
    usage.set(String(c._id), { asCategory, asBike });
    if (asCategory + asBike > 0) excluded.add(String(c._id));
  }
  // Propagate exclusion upward: never delete an ancestor of a kept node.
  for (const id of [...excluded]) {
    let cur = byId.get(id);
    while (cur && cur.parent) {
      cur = byId.get(String(cur.parent));
      if (cur) excluded.add(String(cur._id));
    }
  }

  const toDelete = candidates.filter((c) => !excluded.has(String(c._id)));
  const skipped = candidates.filter((c) => excluded.has(String(c._id)));

  const label = (c) => {
    const chain = [];
    let cur = c;
    const seen = new Set();
    while (cur && !seen.has(String(cur._id))) {
      seen.add(String(cur._id));
      chain.unshift(cur.name);
      cur = cur.parent ? byId.get(String(cur.parent)) : null;
    }
    return chain.join(' › ');
  };

  console.log(`── deleting (${toDelete.length}) ─────────────────────────`);
  for (const c of toDelete) {
    console.log(`  ✗ ${label(c)}  [${c.slug}]${c.isActive === false ? '' : '  (hidden via inactive ancestor)'}`);
  }
  if (toDelete.length === 0) console.log('  (none)');

  console.log(`\n── skipped — still referenced by products (${skipped.length}) ──`);
  for (const c of skipped) {
    const u = usage.get(String(c._id)) || { asCategory: 0, asBike: 0 };
    const why =
      u.asCategory + u.asBike > 0
        ? `${u.asCategory} product(s)${u.asBike ? `, ${u.asBike} bike ref(s)` : ''}`
        : 'ancestor of a kept category';
    console.log(`  ○ ${label(c)}  [${c.slug}] — ${why}`);
  }
  if (skipped.length === 0) console.log('  (none)');

  if (!APPLY) {
    console.log('\nDry run only — re-run with --apply to delete.');
    process.exit(0);
  }

  // ── Apply ──────────────────────────────────────────────────────────
  const deleteIds = toDelete.map((c) => c._id);

  // Clean admin Page references BEFORE the deletes so no page is left
  // pointing at a missing document.
  const r1 = await Page.updateMany(
    { 'filter.categories': { $in: deleteIds } },
    { $pull: { 'filter.categories': { $in: deleteIds } } },
  );
  const r2 = await Page.updateMany({ 'filter.category': { $in: deleteIds } }, { $set: { 'filter.category': null } });
  const r3 = await Page.updateMany({ parentCategory: { $in: deleteIds } }, { $set: { parentCategory: null } });
  console.log(
    `\nPage cleanup: pulled from ${r1.modifiedCount} page(s), ` +
      `nulled filter.category on ${r2.modifiedCount}, parentCategory on ${r3.modifiedCount}.`,
  );

  // Delete one by one through document middleware so the icon
  // image-cleanup hooks run for each removed category.
  let deleted = 0;
  for (const c of toDelete) {
    await c.deleteOne();
    deleted += 1;
  }
  console.log(`Deleted ${deleted} categories.`);
  console.log('\nDone. Restart the backend (or wait for cache TTL) so the storefront tree refreshes.');
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
