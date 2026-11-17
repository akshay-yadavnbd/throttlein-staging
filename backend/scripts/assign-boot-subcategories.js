/**
 * assign-boot-subcategories.js
 *
 * Re-files products sitting DIRECTLY on the generic "Riding Boots"
 * parent into the proper subcategory (Adventure / Off-Road / Racing /
 * Touring / Urban Riding Shoes / Waterproof / Water Resistant) by
 * matching the product name, so the storefront's Category filter works.
 *
 * NOTE: unlike the helmets script, this one only touches products on
 * the PARENT node — products already filed under Water Resistant /
 * Waterproof Boots (set deliberately by fix-boot-water-rating.js) are
 * left alone.
 *
 * Rules (first hit wins):
 *   - waterproof                        → Waterproof Boots
 *   - water resistant                   → Water Resistant
 *   - motocross / off-road / MX / dirt  → Off-Road Boots
 *   - trail / adventure / ADV           → Adventure Boots
 *   - sport / racing / race             → Racing Boots
 *   - touring                           → Touring Boots
 *   - shoes / sneaker / urban / retro / scout / stealth → Urban Riding Shoes
 *   - fallback                          → Touring Boots (flagged [GUESS];
 *     override with --default=<slug>)
 *
 * DRY RUN by default; --apply to execute.
 *
 *   node scripts/assign-boot-subcategories.js
 *   node scripts/assign-boot-subcategories.js --apply
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Category = require('../src/modules/catalog/category.model');
const Product = require('../src/modules/products/product.model');

const APPLY = process.argv.includes('--apply');
const defaultArg = (process.argv.find((a) => a.startsWith('--default=')) || '').split('=')[1] || 'touring-boots';

const RULES = [
  { slug: 'waterproof-boots', re: /water\s*proof/i },
  { slug: 'water-resistant', re: /water\s*resist/i },
  { slug: 'off-road-boots', re: /motocross|off[\s-]?road|\bmx\b|dirt/i },
  { slug: 'adventure-boots', re: /trail|adventure|\badv\b/i },
  { slug: 'racing-boots', re: /sport|racing|\brace\b|gp\b/i },
  { slug: 'touring-boots', re: /touring/i },
  { slug: 'urban-riding-shoes', re: /\bshoes?\b|sneaker|urban|retro|vintago|scout|stealth|casual/i },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (--apply to execute)'}\n`);

  const cats = await Category.find({});
  const bySlug = new Map(cats.map((c) => [c.slug, c]));
  const root = bySlug.get('riding-boots');
  if (!root) {
    console.error('No category with slug "riding-boots" found. Aborting.');
    process.exit(1);
  }
  for (const r of RULES) {
    if (!bySlug.get(r.slug)) console.log(`⚠ Rule target category missing: ${r.slug} (rule skipped)`);
  }
  const defaultCat = bySlug.get(defaultArg);
  if (!defaultCat) {
    console.error(`Default category "${defaultArg}" not found. Aborting.`);
    process.exit(1);
  }

  // ONLY products filed directly on the parent node.
  const products = await Product.find({ category: root._id });
  console.log(`${products.length} products sit directly on "Riding Boots".\n`);

  let moved = 0,
    guessed = 0;
  const summary = new Map();
  for (const p of products) {
    let target = null;
    let viaRule = false;
    for (const r of RULES) {
      if (r.re.test(p.name) && bySlug.get(r.slug)) {
        target = bySlug.get(r.slug);
        viaRule = true;
        break;
      }
    }
    if (!target) target = defaultCat;
    if (!viaRule) guessed += 1;
    console.log(`  ${p.name}\n    Riding Boots  →  ${target.name}${viaRule ? '' : '  [GUESS — default]'}`);
    summary.set(target.slug, (summary.get(target.slug) || 0) + 1);
    moved += 1;
    if (APPLY) {
      p.category = target._id;
      await p.save();
    }
  }

  console.log(`\n── summary ─────────────────────────────`);
  for (const [slug, n] of summary) console.log(`  ${slug}: +${n}`);
  console.log(`\n${APPLY ? 'Moved' : 'Would move'} ${moved} · defaulted (review these) ${guessed}`);
  if (!APPLY) console.log('\nDry run only — re-run with --apply to write.');
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
