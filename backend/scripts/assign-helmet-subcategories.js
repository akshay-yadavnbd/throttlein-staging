/**
 * assign-helmet-subcategories.js
 *
 * Re-files every product in the "Helmets" subtree into the correct
 * helmet SUBCATEGORY (Full Face / Modular / Open Face / Half /
 * Off-Road / Adventure / Bluetooth / Kids / Touring / Helmet
 * Accessories) by matching the product name against keyword + model
 * rules, so the storefront's Category filter actually works.
 *
 * Rules (checked in order — first hit wins):
 *   - accessories keywords (visor, pinlock, spoiler, …) → Helmet Accessories
 *   - modular / flip-up            → Modular / Flip-Up Helmets
 *   - open face / OF-model codes   → Open Face Helmets
 *   - half                        → Half Helmets
 *   - motocross / off-road / MX    → Off-Road / Motocross Helmets
 *   - adventure / ADV              → Adventure Helmets
 *   - bluetooth                    → Bluetooth Helmets
 *   - kids / junior / youth        → Kids Helmets
 *   - touring                      → Touring Helmets
 *   - LS2 FF-model codes (FF800…)  → Full Face Helmets
 *   - fallback                     → Full Face Helmets (flagged in the
 *     report so you can eyeball the guesses; change with --default=<slug>)
 *
 * Only touches products whose category is inside the Helmets subtree.
 * DRY RUN by default; --apply to execute.
 *
 *   node scripts/assign-helmet-subcategories.js
 *   node scripts/assign-helmet-subcategories.js --apply
 *   node scripts/assign-helmet-subcategories.js --default=open-face-helmets
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Category = require('../src/modules/catalog/category.model');
const Product = require('../src/modules/products/product.model');

const APPLY = process.argv.includes('--apply');
const defaultArg = (process.argv.find((a) => a.startsWith('--default=')) || '').split('=')[1] || 'full-face-helmets';

// slug of target subcategory → rules
const RULES = [
  {
    slug: 'helmet-accessories',
    re: /visor|pinlock|spoiler|cheek\s*pad|chin\s*curtain|balaclava|helmet\s*(lock|bag|cover)|spare|strap|mechanism|liner/i,
  },
  // Steelbird's SBA-2 / SBA-20 / SBA-2x line are flip-up helmets.
  { slug: 'modular-flip-up-helmets', re: /modular|flip[\s-]?up|\bsba-?2\d?\b/i },
  { slug: 'open-face-helmets', re: /open\s*face|\bof\d{2,}\b/i },
  { slug: 'half-helmets', re: /\bhalf\b/i },
  { slug: 'off-road-motocross-helmets', re: /motocross|off[\s-]?road|\bmx\b|dirt/i },
  { slug: 'adventure-helmets', re: /adventure|\badv\b|\bmx701\b|pioneer/i },
  { slug: 'bluetooth-helmets', re: /bluetooth|\bbt\b|smart\s*helmet|intercom\s*ready/i },
  { slug: 'kids-helmets', re: /\bkids?\b|junior|youth/i },
  { slug: 'touring-helmets', re: /touring/i },
  { slug: 'full-face-helmets', re: /full\s*face|\bff\d{2,}\b/i },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (--apply to execute)'}\n`);

  const cats = await Category.find({});
  const byId = new Map(cats.map((c) => [String(c._id), c]));
  const bySlug = new Map(cats.map((c) => [c.slug, c]));

  const helmetsRoot = bySlug.get('helmets');
  if (!helmetsRoot) {
    console.error('No category with slug "helmets" found. Aborting.');
    process.exit(1);
  }

  // Every category inside the Helmets subtree (root + descendants).
  const subtreeIds = new Set([String(helmetsRoot._id)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cats) {
      if (c.parent && subtreeIds.has(String(c.parent)) && !subtreeIds.has(String(c._id))) {
        subtreeIds.add(String(c._id));
        grew = true;
      }
    }
  }

  // Validate rule targets exist (warn once instead of failing mid-way).
  for (const r of RULES) {
    if (!bySlug.get(r.slug)) console.log(`⚠ Rule target category missing: ${r.slug} (rule will be skipped)`);
  }
  const defaultCat = bySlug.get(defaultArg);
  if (!defaultCat) {
    console.error(`Default category "${defaultArg}" not found. Aborting.`);
    process.exit(1);
  }

  const products = await Product.find({ category: { $in: [...subtreeIds] } });
  console.log(`${products.length} products in the Helmets subtree.\n`);

  let moved = 0,
    kept = 0,
    guessed = 0;
  const summary = new Map(); // target slug -> count
  for (const p of products) {
    // Classify by name.
    let target = null;
    let viaRule = false;
    for (const r of RULES) {
      if (r.re.test(p.name) && bySlug.get(r.slug)) {
        target = bySlug.get(r.slug);
        viaRule = true;
        break;
      }
    }
    if (!target) {
      target = defaultCat;
    }

    const current = byId.get(String(p.category));
    if (current && String(current._id) === String(target._id)) {
      kept += 1;
      continue;
    }
    const guessMark = viaRule ? '' : '  [GUESS — default]';
    if (!viaRule) guessed += 1;
    console.log(`  ${p.name}\n    ${current?.name || '?'}  →  ${target.name}${guessMark}`);
    summary.set(target.slug, (summary.get(target.slug) || 0) + 1);
    moved += 1;
    if (APPLY) {
      p.category = target._id;
      await p.save();
    }
  }

  console.log(`\n── summary ─────────────────────────────`);
  for (const [slug, n] of summary) console.log(`  ${slug}: +${n}`);
  console.log(
    `\n${APPLY ? 'Moved' : 'Would move'} ${moved} · already correct ${kept} · defaulted (review these) ${guessed}`,
  );
  if (!APPLY) console.log('\nDry run only — re-run with --apply to write.');
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
