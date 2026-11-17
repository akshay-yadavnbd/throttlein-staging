/**
 * merge-duplicates.js
 *
 * Finds BRANDS and CATEGORIES whose names differ only by spacing /
 * casing / punctuation ("Moto Torque" vs "MotoTorque") and merges each
 * group into one canonical record:
 *
 *   - canonical = the one with the most products (tiebreak: has a
 *     logo/icon, then the older record)
 *   - products on the duplicates are reassigned to the canonical
 *   - duplicate CATEGORIES also hand their child categories over
 *   - duplicates are DEACTIVATED, not deleted (deleting would trigger
 *     the image-cleanup hooks and could remove S3 assets; an inactive
 *     empty record is invisible and harmless)
 *
 * Categories inside the Shop by Bike tree are ignored.
 *
 * DRY RUN by default; --apply to execute.
 *
 *   node scripts/merge-duplicates.js
 *   node scripts/merge-duplicates.js --apply
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Brand = require('../src/modules/catalog/brand.model');
const Category = require('../src/modules/catalog/category.model');
const Product = require('../src/modules/products/product.model');

const APPLY = process.argv.includes('--apply');
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

async function mergeGroup(kind, docs, countField) {
  // Product counts per doc decide the canonical.
  const counts = await Promise.all(docs.map((d) => Product.countDocuments({ [countField]: d._id })));
  const ranked = docs
    .map((d, i) => ({ d, n: counts[i] }))
    .sort(
      (a, b) =>
        b.n - a.n ||
        (b.d.logo || b.d.icon ? 1 : 0) - (a.d.logo || a.d.icon ? 1 : 0) ||
        new Date(a.d.createdAt || 0) - new Date(b.d.createdAt || 0),
    );
  const canonical = ranked[0].d;
  const dups = ranked.slice(1);

  console.log(`  ${kind}: keeping "${canonical.name}" (${ranked[0].n} products)`);
  for (const { d, n } of dups) {
    console.log(`    ← merging "${d.name}" (${n} products) → deactivated`);
    if (!APPLY) continue;
    await Product.updateMany({ [countField]: d._id }, { $set: { [countField]: canonical._id } });
    if (kind === 'category') {
      await Category.updateMany({ parent: d._id }, { $set: { parent: canonical._id } });
    }
    d.isActive = false;
    await d.save();
  }
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (--apply to execute)'}\n`);

  // ── Brands ───────────────────────────────────────────────────────────
  const brands = await Brand.find({});
  const brandGroups = new Map();
  for (const b of brands) {
    const k = norm(b.name);
    if (!brandGroups.has(k)) brandGroups.set(k, []);
    brandGroups.get(k).push(b);
  }
  console.log('── duplicate brands ────────────────────');
  let found = 0;
  for (const group of brandGroups.values()) {
    // Only consider ACTIVE duplicates — an already-deactivated leftover
    // isn't worth merging again.
    const active = group.filter((b) => b.isActive !== false);
    if (active.length > 1) {
      found += 1;
      await mergeGroup('brand', active, 'brand');
    }
  }
  if (!found) console.log('  (none)');

  // ── Categories (outside Shop by Bike) ───────────────────────────────
  const cats = await Category.find({});
  const byId = new Map(cats.map((c) => [String(c._id), c]));
  const sbb = cats.find((c) => c.parent === null && c.name === 'Shop by Bike');
  const inBikeTree = (c) => {
    let cur = c;
    while (cur) {
      if (sbb && String(cur._id) === String(sbb._id)) return true;
      cur = cur.parent ? byId.get(String(cur.parent)) : null;
    }
    return false;
  };
  const catGroups = new Map();
  for (const c of cats) {
    if (inBikeTree(c)) continue;
    const k = norm(c.name);
    if (!catGroups.has(k)) catGroups.set(k, []);
    catGroups.get(k).push(c);
  }
  console.log('\n── duplicate categories ────────────────');
  found = 0;
  for (const group of catGroups.values()) {
    const active = group.filter((c) => c.isActive !== false);
    if (active.length > 1) {
      found += 1;
      await mergeGroup('category', active, 'category');
    }
  }
  if (!found) console.log('  (none)');

  console.log('\nDone.');
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
