/**
 * randomize-stock.js
 *
 * Sets every product of one seller to a random stock of 5, 6, or 7 so
 * nothing shows as out of stock.
 *
 * - Simple products: `stock` = random 5–7.
 * - Variant products: EACH variant gets its own random 5–7, and the
 *   top-level `stock` is recomputed as the sum (that's what the
 *   storefront's in-stock filter reads).
 * - Products stuck in status 'out_of_stock' flip back to 'active'.
 *   Drafts stay drafts — they're intentionally unpublished.
 *
 * Usage (from the backend folder):
 *   node scripts/randomize-stock.js revvgearz@gmail.com
 *   node scripts/randomize-stock.js revvgearz@gmail.com --min=5 --max=7
 */
require('../loadEnv');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Product = require('../src/modules/products/product.model');

const email = process.argv[2];
const opt = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const MIN = opt('min', 5);
const MAX = opt('max', 7);

if (!email) {
  console.error('Usage: node scripts/randomize-stock.js <seller-email> [--min=5] [--max=7]');
  process.exit(1);
}
const rand = () => MIN + Math.floor(Math.random() * (MAX - MIN + 1));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const seller = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (!seller) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }

  const products = await Product.find({ seller: seller._id });
  console.log(`${products.length} products for ${seller.storeName || seller.name}`);

  let simple = 0,
    withVariants = 0,
    reactivated = 0;
  for (const p of products) {
    if (Array.isArray(p.variants) && p.variants.length > 0) {
      for (const v of p.variants) v.stock = rand();
      p.markModified('variants');
      p.stock = p.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0);
      withVariants += 1;
    } else {
      p.stock = rand();
      simple += 1;
    }
    if (p.status === 'out_of_stock') {
      p.status = 'active';
      reactivated += 1;
    }
    await p.save();
  }

  console.log(
    `Done: ${simple} simple products set to ${MIN}-${MAX}, ` +
      `${withVariants} variant products (each variant ${MIN}-${MAX}, total = sum), ` +
      `${reactivated} flipped out_of_stock → active.`,
  );
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
