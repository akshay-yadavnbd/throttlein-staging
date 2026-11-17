/**
 * Give every Category an icon, borrowed from a product inside it.
 *
 *   node scripts/assignCategoryIcons.js --dry     # report only, no writes
 *   node scripts/assignCategoryIcons.js           # fill categories with no icon
 *   node scripts/assignCategoryIcons.js --force   # also replace existing icons
 *
 * WHY
 * Category icons drive the "Types of <X> to sell" grid on seller-category
 * landing pages, the category index, and the Shop-by-Bike tiles. Most
 * categories had no icon, so those grids rendered as empty grey boxes.
 * Products in each category already have photographs, so the sensible source
 * is the catalogue itself rather than sourcing new artwork.
 *
 * HOW IMAGES ARE CHOSEN
 *   - A category first looks at products assigned DIRECTLY to it.
 *   - If it has none (typical for parent categories, which usually hold no
 *     products of their own), it falls back to products anywhere in its
 *     subtree, walking breadth-first so the nearest child wins.
 *   - Every chosen image is recorded, and no image is used twice — parents
 *     and children therefore never show the same photo. Categories already
 *     carrying an icon reserve it, so a re-run can't hand their image to
 *     someone else.
 *   - Images are stored as the product's own value (a bare S3 key like
 *     `products/….webp`), which is the format Category.icon already uses.
 *
 * Deliberately conservative: only fills blanks unless --force, and never
 * clears an icon it can't replace.
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Category = require('../src/modules/catalog/category.model');
const Product = require('../src/modules/products/product.model');

const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  const cats = await Category.find({}).select('name slug parent icon').lean();
  const products = await Product.find({ category: { $ne: null } })
    .select('category images')
    .lean();

  console.log(`categories: ${cats.length}   products with a category: ${products.length}`);

  // category id -> [image, …] from products assigned directly to it
  const directImages = new Map();
  for (const p of products) {
    const key = String(p.category);
    const imgs = (Array.isArray(p.images) ? p.images : []).filter(Boolean);
    if (!imgs.length) continue;
    if (!directImages.has(key)) directImages.set(key, []);
    directImages.get(key).push(...imgs);
  }

  // parent id -> [child id, …]
  const childrenOf = new Map();
  for (const c of cats) {
    const parent = c.parent ? String(c.parent) : '__root__';
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(String(c._id));
  }

  /**
   * The "Shop by Bike" subtree is OFF LIMITS.
   *
   * Those categories are motorcycle models (Himalayan, Duke 250, Dominar) and
   * manufacturers, not product categories. Their icons are bike photographs
   * and brand logos — giving one a helmet or boot photo from a product would
   * be plainly wrong.
   *
   * They're skipped explicitly rather than relying on them having no products:
   * the moment anyone links a product to a bike model, the subtree walk below
   * would happily hand that model a product photo.
   */
  const bikeRoot = cats.find((c) => /^shop by bike$/i.test(c.name));
  const excluded = new Set();
  if (bikeRoot) {
    const queue = [String(bikeRoot._id)];
    while (queue.length) {
      const id = queue.shift();
      if (excluded.has(id)) continue;
      excluded.add(id);
      for (const child of childrenOf.get(id) || []) queue.push(child);
    }
    console.log(
      `excluding the "Shop by Bike" subtree: ${excluded.size} bike-model ` +
        'categories (they use bike photos, not product photos)',
    );
  } else {
    console.log('note: no "Shop by Bike" root found — nothing excluded.');
  }

  /** Images available to a category: its own products first, then its subtree
   *  breadth-first so the closest descendant contributes before a distant one. */
  function candidateImages(catId) {
    const out = [];
    const seen = new Set();
    const queue = [String(catId)];
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const img of directImages.get(id) || []) out.push(img);
      for (const child of childrenOf.get(id) || []) queue.push(child);
    }
    return out;
  }

  // Reserve icons already in use so a re-run never steals one.
  const used = new Set();
  for (const c of cats) if (c.icon) used.add(c.icon);

  const targets = cats.filter((c) => !excluded.has(String(c._id)) && (FORCE ? true : !c.icon));
  console.log(
    `${targets.length} categor${targets.length === 1 ? 'y' : 'ies'} to fill` +
      (FORCE ? ' (--force: existing icons may be replaced)' : ' (blank icons only)'),
  );
  if (DRY) console.log('--dry: nothing will be written\n');

  let assigned = 0;
  const skipped = [];

  for (const c of targets) {
    // On --force the category's own icon shouldn't block reuse of itself.
    if (FORCE && c.icon) used.delete(c.icon);

    const pick = candidateImages(c._id).find((img) => !used.has(img));
    if (!pick) {
      skipped.push(c.name);
      if (FORCE && c.icon) used.add(c.icon); // put it back, we're not changing it
      continue;
    }

    used.add(pick);
    assigned++;
    const depth = c.parent ? '  ' : '';
    console.log(`${depth}${c.name.padEnd(34)} <- ${pick.slice(0, 62)}`);

    if (!DRY) {
      // Full doc + save() so the stripImageUrl setter and image-cleanup hooks
      // run exactly as they would from the admin form.
      const doc = await Category.findById(c._id);
      doc.icon = pick;
      await doc.save({ validateBeforeSave: false });
    }
  }

  console.log(`\nassigned: ${assigned}`);
  if (skipped.length) {
    console.log(
      `no image available (${skipped.length}): ${skipped.slice(0, 25).join(', ')}` + (skipped.length > 25 ? ' …' : ''),
    );
    console.log('  → these categories have no products with images in their subtree.');
  }

  if (!DRY) {
    try {
      const { deleteCacheByPattern } = require('../src/utils/redisCache');
      await deleteCacheByPattern('categories:*');
      await deleteCacheByPattern('page:*');
      console.log('caches busted: categories:*, page:*');
    } catch (e) {
      console.log(`cache bust failed (${e.message}) — clear it from Cache Inspector.`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
  });
