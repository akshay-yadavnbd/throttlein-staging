/**
 * Demo product seed — populates the dashboard with realistic-but-fake
 * products so the UI can be tested at scale without copying real catalog
 * data. Every product is tagged with `sku: "DEMO-NNNN"` so the cleanup
 * mode can remove them in one command before going live.
 *
 * Usage:
 *   node src/utils/seedDemoProducts.js                  # 100 products
 *   node src/utils/seedDemoProducts.js --count=50       # custom count
 *   node src/utils/seedDemoProducts.js --clear          # remove demo data
 *   node src/utils/seedDemoProducts.js --seller-email=X # pick a seller by email
 *
 * What it does:
 *   - Picks a seller (KYC-approved if available, otherwise any seller).
 *   - Walks the Category tree, takes only LEAF categories outside the
 *     Shop-by-Bike subtree (so demo products land in browse-able places).
 *   - For each product:
 *       • Builds a templated name like "Rynox Pro Touring Jacket"
 *       • Generates 3–10 deterministic Picsum images
 *       • Generates a plausible price + MRP + sizes + stock
 *       • Writes a "[DEMO PRODUCT]"-prefixed description
 *
 * Cleanup is a single one-liner: deletes every product whose sku starts
 * with the DEMO_SKU_PREFIX. Nothing else in the system is touched.
 */

require('../../config/loadEnv');
const mongoose = require('mongoose');
const Product = require('../../modules/products/product.model');
const Category = require('../../modules/catalog/category.model');
const Brand = require('../../modules/catalog/brand.model');
const User = require('../../models/User');
const { env } = require('../../config/env');

const CLEAR = process.argv.includes('--clear');
const COUNT = parseInt((process.argv.find((a) => a.startsWith('--count=')) || '').replace('--count=', '') || '100', 10);
const SELLER_EMAIL = (process.argv.find((a) => a.startsWith('--seller-email=')) || '')
  .replace('--seller-email=', '')
  .trim();

/** Every demo product's SKU starts with this so cleanup can find them. */
const DEMO_SKU_PREFIX = 'DEMO-';

/* ─── Templates ────────────────────────────────────────────────────── */

const ADJECTIVES = [
  'Pro',
  'Sport',
  'Tour',
  'Adventure',
  'Classic',
  'Urban',
  'Stealth',
  'Apex',
  'Carbon',
  'Storm',
  'Trail',
  'Speed',
  'Endurance',
  'Velocity',
  'Edge',
  'Pulse',
  'Renegade',
  'Vortex',
  'Summit',
  'Nomad',
];

const COLORS = [
  'Black',
  'Stealth Grey',
  'Gunmetal',
  'Carbon',
  'Matte White',
  'Hi-Viz Yellow',
  'Storm Blue',
  'Forest Green',
  'Crimson',
  'Sand',
];

const { TEMPLATES } = require('./demo-products.templates');

/* ─── helpers ──────────────────────────────────────────────────────── */

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}
function randomBetween(lo, hi) {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}
function expandTemplate(tpl) {
  return tpl.replace(/%adj/g, () => pick(ADJECTIVES));
}
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function templateFor(categoryName) {
  const name = (categoryName || '').toLowerCase();
  for (const key of Object.keys(TEMPLATES)) {
    if (key === 'default') continue;
    const t = TEMPLATES[key];
    if (t.matchers.some((m) => name.includes(m))) return t;
  }
  return TEMPLATES.default;
}

/**
 * Deterministic placeholder images via Picsum's seed endpoint. Each
 * `(productSeed, idx)` returns a unique-looking 640×640 shot but always
 * the same one for a given seed, so reruns produce stable URLs. Picsum
 * is CC0 — no attribution or licensing concerns.
 */
function buildImageUrls(seed, count) {
  const urls = [];
  for (let i = 0; i < count; i++) {
    urls.push(`https://picsum.photos/seed/${seed}-${i}/640/640`);
  }
  return urls;
}

/* ─── main ─────────────────────────────────────────────────────────── */

async function run() {
  const mongoUri = env.MONGODB_URI || env.MONGO_URI;
  if (!mongoUri) {
    console.error('Missing MONGODB_URI in .env');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);

  if (CLEAR) {
    const res = await Product.deleteMany({
      sku: { $regex: `^${DEMO_SKU_PREFIX}` },
    });
    console.log(`Removed ${res.deletedCount} demo-seeded products.`);
    await mongoose.disconnect();
    return;
  }

  // Build helpers for the category tree.
  const categories = await Category.find({ isActive: true });
  const byId = new Map(categories.map((c) => [c._id.toString(), c]));
  function isUnderShopByBike(cat) {
    if (!cat) return false;
    if ((cat.name || '').toLowerCase() === 'shop by bike') return true;
    const pid = cat.parent ? cat.parent.toString() : null;
    return pid ? isUnderShopByBike(byId.get(pid)) : false;
  }
  // Only categories WITH NO CHILDREN get products — that way the demo
  // data lands in browse-able leaves rather than parent aggregators.
  const childCount = new Map();
  for (const c of categories) {
    if (c.parent) {
      const k = c.parent.toString();
      childCount.set(k, (childCount.get(k) || 0) + 1);
    }
  }
  const leafCategories = categories.filter((c) => !isUnderShopByBike(c) && !childCount.get(c._id.toString()));

  if (!leafCategories.length) {
    console.error('No leaf product categories found. Seed Categories first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const brands = await Brand.find({});
  if (!brands.length) {
    console.error('No brands found. Seed Brands first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  // Seller selection: --seller-email overrides, else KYC-approved, else any.
  let seller = null;
  if (SELLER_EMAIL) {
    seller = await User.findOne({ email: SELLER_EMAIL });
    if (!seller) {
      console.error(`No user found with email "${SELLER_EMAIL}".`);
      await mongoose.disconnect();
      process.exit(1);
    }
  }
  if (!seller) seller = await User.findOne({ role: 'seller', kycStatus: 'approved' });
  if (!seller) seller = await User.findOne({ role: 'seller' });
  if (!seller) {
    console.error('No seller users in the DB. Create a seller first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Seller: ${seller.name || seller.email}`);
  console.log(
    `Spread: ${COUNT} products across ${leafCategories.length} leaf categor${
      leafCategories.length === 1 ? 'y' : 'ies'
    } and ${brands.length} brand${brands.length === 1 ? '' : 's'}.\n`,
  );

  let created = 0;
  for (let i = 0; i < COUNT; i++) {
    const category = pick(leafCategories);
    const brand = pick(brands);
    const tpl = templateFor(category.name);

    const nameStub = expandTemplate(pick(tpl.nameTemplates));
    const name = `${brand.name} ${nameStub}`;

    const price = randomBetween(tpl.priceRange[0], tpl.priceRange[1]);
    const onSale = Math.random() > 0.45;
    const mrp = onSale ? Math.round(price * (1 + (Math.random() * 0.35 + 0.1))) : undefined;

    const imageCount = randomBetween(3, 10);
    const seed = `${slugify(name)}-${i}`;
    const images = buildImageUrls(seed, imageCount);

    const features = pickN(tpl.features, Math.min(3, tpl.features.length));
    const description = [
      '[DEMO PRODUCT — generated for testing only]',
      '',
      `${name} — premium gear engineered for the modern rider.`,
      '',
      ...features.map((f) => `• ${f}`),
      '',
      'This is demo content used to exercise the storefront UI. Replace ' + 'with real product copy before going live.',
    ].join('\n');

    const sku = `${DEMO_SKU_PREFIX}${(i + 1).toString().padStart(4, '0')}`;
    const stock = randomBetween(0, 80);

    try {
      await Product.create({
        seller: seller._id,
        name,
        category: category._id,
        brand: brand._id,
        description,
        price,
        mrp,
        stock,
        images,
        sku,
        color: pick(COLORS),
        // 70% of items in size-bearing templates expose their sizes.
        sizes: tpl.sizes.length && Math.random() > 0.3 ? tpl.sizes : [],
        weightGrams: randomBetween(200, 3500),
        status: stock > 0 ? 'active' : 'out_of_stock',
        rating: +(Math.random() * 2 + 3).toFixed(1),
        reviewsCount: randomBetween(0, 250),
        isFeatured: Math.random() < 0.15,
      });
      created++;
      // Progress ping every 10 products so a long seed shows life.
      if (created % 10 === 0) {
        console.log(`  … ${created}/${COUNT} created`);
      }
    } catch (err) {
      // A duplicate SKU/slug from a previous partial run shouldn't abort
      // the whole seed — report it and keep going.
      console.warn(`  ✗  "${name}" skipped: ${err.message}`);
    }
  }

  console.log(`\nDone. ${created}/${COUNT} demo products created for ${seller.email || seller.name}.`);
  console.log(`Remove them later with:  SKU prefix "${DEMO_SKU_PREFIX}"`);
  await mongoose.disconnect();
}

// Stand-alone runner — this file is only ever executed directly
// (npm run seed:demo-products), never imported.
run().catch(async (err) => {
  console.error('Seed failed:', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
