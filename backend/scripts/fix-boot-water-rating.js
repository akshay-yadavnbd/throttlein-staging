/**
 * fix-boot-water-rating.js
 *
 * The Shopify migration folded the "Water Protection Level" option into
 * the SIZE slot, producing sizes like "WATER RESISTANT/10" and
 * "NON WATER RESISTANT/8" (visible as garbage entries in the storefront
 * size filter). This script:
 *
 *   1. Strips the rating prefix from every affected size — variant
 *      sizes AND the `sizes` array — leaving just the shoe size
 *      ("WATER RESISTANT/10" → "10"). Colliding variant rows after the
 *      strip are merged with stocks summed.
 *   2. Re-categorises the product by its rating:
 *        WATERPROOF        → existing "Waterproof Boots" category
 *        WATER RESISTANT   → "Water Resistant" (created under Riding
 *                            Boots if missing)
 *        NON WATER RESISTANT → category left unchanged (that's the
 *                            absence of a feature, not a category)
 *
 * Legitimate slash sizes like "6 UK / EU 40" are untouched — only the
 * three rating phrases trigger.
 *
 * DRY RUN by default; --apply to execute. --seller=email to scope.
 *
 *   node scripts/fix-boot-water-rating.js --seller=revvgearz@gmail.com
 *   node scripts/fix-boot-water-rating.js --seller=revvgearz@gmail.com --apply
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Product = require('../src/modules/products/product.model');
const Category = require('../src/modules/catalog/category.model');
const User = require('../src/models/User');

const APPLY = process.argv.includes('--apply');
const sellerEmail = (process.argv.find((a) => a.startsWith('--seller=')) || '').split('=')[1];

const RATING_RE = /^(non water resistant|water resistant|waterproof)\s*\/\s*(.+)$/i;
const RATING_RE_REV = /^(.+?)\s*\/\s*(non water resistant|water resistant|waterproof)$/i;

/** → { size, rating: 'waterproof'|'resistant'|'non'|null } */
function splitSize(raw) {
  const s = String(raw || '').trim();
  let m = s.match(RATING_RE);
  if (m) return { size: m[2].trim(), rating: classify(m[1]) };
  m = s.match(RATING_RE_REV);
  if (m) return { size: m[1].trim(), rating: classify(m[2]) };
  return { size: s, rating: null };
}
function classify(phrase) {
  const p = phrase.toLowerCase();
  if (p.startsWith('non')) return 'non';
  if (p === 'waterproof') return 'waterproof';
  return 'resistant';
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  // Resolve/create the target categories under Riding Boots.
  const ridingBoots = await Category.findOne({ name: 'Riding Boots' });
  if (!ridingBoots) {
    console.error('"Riding Boots" category not found.');
    process.exit(1);
  }
  const waterproofCat = await Category.findOne({ name: 'Waterproof Boots', parent: ridingBoots._id });
  let resistantCat = await Category.findOne({ name: 'Water Resistant', parent: ridingBoots._id });
  if (!resistantCat) {
    console.log('  + create category "Riding Boots > Water Resistant"');
    resistantCat = new Category({ name: 'Water Resistant', parent: ridingBoots._id, isActive: true });
    if (APPLY) await resistantCat.save();
  }

  const filter = {};
  if (sellerEmail) {
    const seller = await User.findOne({ email: sellerEmail.toLowerCase().trim() });
    if (!seller) {
      console.error(`No user ${sellerEmail}`);
      process.exit(1);
    }
    filter.seller = seller._id;
  }
  const products = await Product.find(filter).select('name sizes variants category');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (--apply to execute)'}`);
  console.log(`${products.length} products scanned\n`);

  let touched = 0;
  for (const p of products) {
    let rating = null;
    let dirty = false;

    // sizes[]
    const strippedSizes = [];
    for (const s of p.sizes || []) {
      const r = splitSize(s);
      if (r.rating) {
        rating = rating === 'waterproof' ? rating : r.rating;
        dirty = true;
      }
      if (r.size && !strippedSizes.includes(r.size)) strippedSizes.push(r.size);
    }

    // variants[].size — merge collisions after stripping
    let mergedVariants = null;
    if (Array.isArray(p.variants) && p.variants.length) {
      const byKey = new Map();
      let changed = false;
      for (const v of p.variants) {
        const r = splitSize(v.size);
        if (r.rating) {
          rating = rating === 'waterproof' ? rating : r.rating;
          changed = true;
        }
        const key = `${r.size}::${(v.color || '').trim()}`;
        const prev = byKey.get(key);
        if (prev) {
          prev.stock = (Number(prev.stock) || 0) + (Number(v.stock) || 0);
          changed = true;
        } else {
          byKey.set(key, { ...(v.toObject ? v.toObject() : v), size: r.size });
        }
      }
      if (changed) {
        mergedVariants = Array.from(byKey.values());
        dirty = true;
      }
    }

    if (!dirty) continue;
    touched += 1;

    const targetCat = rating === 'waterproof' ? waterproofCat : rating === 'resistant' ? resistantCat : null;
    const catNote = targetCat && String(p.category) !== String(targetCat._id) ? ` · category → ${targetCat.name}` : '';
    console.log(`  ✓ ${p.name.slice(0, 55)} — sizes cleaned${catNote}`);

    if (APPLY) {
      p.sizes = strippedSizes;
      if (mergedVariants) {
        p.variants = mergedVariants;
        p.markModified('variants');
        p.stock = mergedVariants.reduce((s, v) => s + (Number(v.stock) || 0), 0);
      }
      if (targetCat) p.category = targetCat._id;
      await p.save();
    }
  }
  console.log(`\n${touched} product(s) ${APPLY ? 'updated' : 'would be updated'}.`);
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
