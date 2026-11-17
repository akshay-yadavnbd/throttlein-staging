/**
 * One-shot seeder for sample seller products.
 *
 *   npm run seed:products
 *
 *   Optional env override:
 *     SELLER_EMAIL=<email>  node src/utils/seedSampleProducts.js
 *
 * Picks the first seller in the DB (or the one matching SELLER_EMAIL),
 * resolves the right Category + Brand for each entry below, and inserts
 * the products. Idempotent — re-running skips products that already
 * exist for that seller.
 */
require('../../config/loadEnv');

const mongoose = require('mongoose');
const Product = require('../../modules/products/product.model');
const Category = require('../../modules/catalog/category.model');
const Brand = require('../../modules/catalog/brand.model');
const User = require('../../models/User');
const { env } = require('../../config/env');

/**
 * Each sample resolves its Category and Brand by name at runtime, so the
 * seed survives if you ever rename or restructure the admin tree.
 */
/**
 * Helper — builds a THROTTLEIN-branded placeholder image URL.
 * Black background + lime accent + your wordmark style.
 */
function ph(text) {
  const safe = encodeURIComponent(text);
  return `https://placehold.co/800x800/141414/FFFFFF.png?text=${safe}&font=raleway`;
}

const SAMPLES = [
  {
    name: 'Rynox Storm Evo 3 Riding Jacket',
    categoryName: 'Jackets',
    brandName: 'Rynox',
    price: 14999,
    mrp: 17999,
    stock: 25,
    color: 'Black',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    weightGrams: 2000,
    sku: 'RYN-STM3-BLK-L',
    description:
      'Triple-layer construction with detachable thermal and rain liners. CE-rated armor at shoulders, elbows, and back. Adjustable arm and waist straps for a tailored fit.',
    images: [ph('Rynox Storm Evo 3'), ph('Storm Evo 3 — Detail')],
  },
  {
    name: 'Spyder Camo Riding Pants',
    categoryName: 'Pants',
    brandName: 'Spyder',
    price: 7499,
    mrp: 8999,
    stock: 18,
    color: 'Olive Camo',
    sizes: ['30', '32', '34', '36', '38'],
    weightGrams: 1200,
    sku: 'SPY-CAMO-34',
    description:
      'CE-rated knee and hip armor pockets, reinforced abrasion-resistant Cordura panels, stretch panels for comfort, adjustable waist.',
    images: [ph('Spyder Camo Pants'), ph('Camo Pants — Armor')],
  },
  {
    name: 'TCX Hero Waterproof Riding Boots',
    categoryName: 'Boots',
    brandName: 'TCX',
    price: 17999,
    mrp: 21999,
    stock: 12,
    color: 'Black',
    sizes: ['40', '41', '42', '43', '44'],
    weightGrams: 1800,
    sku: 'TCX-HERO-BLK-42',
    description:
      'Full-grain leather upper with TCX Comfort Fit System and waterproof breathable lining. Reinforced toe, heel, and ankle. Anti-slip rubber sole.',
    images: [ph('TCX Hero Boots'), ph('Hero Boots — Sole')],
  },
  {
    name: 'Knox Handroid Pod Mark V Gloves',
    categoryName: 'Gloves',
    brandName: 'Knox',
    price: 12499,
    mrp: 14999,
    stock: 30,
    color: 'Black',
    sizes: ['S', 'M', 'L', 'XL'],
    weightGrams: 380,
    sku: 'KNOX-HND-V-BLK-L',
    description:
      'Patented exoskeleton with carbon fibre knuckles. Goatskin palm with TPR finger protection. Touchscreen-compatible fingertips.',
    images: [ph('Knox Handroid V'), ph('Handroid — Carbon Knuckle')],
  },
  {
    name: 'Hella FF200 Auxiliary LED Spot Lamps (Pair)',
    categoryName: 'Auxiliary Light',
    brandName: 'Hella',
    price: 4999,
    mrp: 5999,
    stock: 45,
    color: 'Black',
    weightGrams: 600,
    sku: 'HEL-FF200-PAIR',
    description:
      '12W LED auxiliary spot lights with universal mounting hardware. Plug-and-play harness included. IP67 weather-resistant housing.',
    images: [ph('Hella FF200 LED'), ph('FF200 — Pair')],
  },
  {
    name: 'Quad Lock Motorcycle Handlebar Mount V2',
    categoryName: 'Mounts and Chargers',
    brandName: 'Quad Lock',
    price: 3499,
    mrp: 3999,
    stock: 60,
    color: 'Black',
    weightGrams: 120,
    sku: 'QL-MOTO-V2',
    description:
      'Twist-lock phone mount with integrated vibration dampener. Fits 22.2 mm – 31.75 mm handlebars. Compatible with Quad Lock cases sold separately.',
    images: [ph('Quad Lock Mount V2'), ph('Phone Mount — Vibration Dampener')],
  },
  {
    name: 'GIVI Trekker Outback 42L Aluminium Top Case',
    categoryName: 'Aluminium Top Cases and Panniers',
    brandName: 'GIVI',
    price: 24999,
    mrp: 27999,
    stock: 8,
    color: 'Silver',
    weightGrams: 5600,
    sku: 'GIVI-OBKN42A',
    description:
      'Hard anodized aluminium construction, MONOKEY mounting system, 42 L capacity with two reinforced lock points. Designed for adventure touring.',
    images: [ph('GIVI Trekker 42L'), ph('Trekker — MONOKEY Mount')],
  },
];

async function pickSeller() {
  const overrideEmail = (env.SELLER_EMAIL || '').toLowerCase().trim();
  if (overrideEmail) {
    const u = await User.findOne({ email: overrideEmail, role: 'seller' });
    if (!u) throw new Error(`No seller found with email ${overrideEmail}`);
    return u;
  }
  const u = await User.findOne({ role: 'seller' }).sort({ createdAt: 1 });
  if (!u) {
    throw new Error('No seller user found. Register a seller at http://localhost:3000/register first.');
  }
  return u;
}

async function seedSampleProducts() {
  const seller = await pickSeller();
  let created = 0;
  let skipped = 0;
  let missing = 0;

  let imagesBackfilled = 0;

  for (const s of SAMPLES) {
    const exists = await Product.findOne({ seller: seller._id, name: s.name });
    if (exists) {
      // Backfill images if this product was inserted before image URLs existed
      let touched = false;
      if ((!exists.images || exists.images.length === 0) && s.images?.length) {
        exists.images = s.images;
        imagesBackfilled++;
        touched = true;
      }
      if ((!exists.sizes || exists.sizes.length === 0) && s.sizes?.length) {
        exists.sizes = s.sizes;
        touched = true;
      }
      if (touched) {
        await exists.save();
        console.log(`  ↻ Back-filled "${s.name}"`);
      }
      skipped++;
      continue;
    }

    const cat = await Category.findOne({ name: s.categoryName });
    if (!cat) {
      console.warn(`  ! Skipping "${s.name}" — category "${s.categoryName}" not found`);
      missing++;
      continue;
    }

    const brand = s.brandName ? await Brand.findOne({ name: s.brandName }) : null;
    if (s.brandName && !brand) {
      console.warn(`  ! Brand "${s.brandName}" missing — saving without brand link`);
    }

    await Product.create({
      seller: seller._id,
      name: s.name,
      category: cat._id,
      brand: brand?._id || null,
      price: s.price,
      mrp: s.mrp,
      stock: s.stock,
      color: s.color,
      sizes: s.sizes || [],
      sku: s.sku,
      weightGrams: s.weightGrams,
      description: s.description,
      images: s.images || [],
      status: 'active',
    });
    created++;
  }

  console.log(
    `Sample products → seller: ${seller.email}  | created: ${created}, skipped: ${skipped} (images back-filled: ${imagesBackfilled}), missing-category: ${missing}`,
  );
}

if (require.main === module) {
  (async () => {
    try {
      await mongoose.connect(env.MONGO_URI);
      await seedSampleProducts();
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      console.error('Seed error:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = seedSampleProducts;
