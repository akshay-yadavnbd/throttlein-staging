/**
 * fix-brands-by-name.js
 *
 * Reassigns products whose NAME starts with a known brand's name but
 * whose `brand` field points somewhere else. Catches Shopify-import
 * artifacts where the store listed itself as the Vendor ("Clan Scout
 * (Black)" imported under brand "RevvGearZ" instead of "Clan").
 *
 * Conservative on purpose: only a match at the very START of the
 * product name counts ("Raida BRONSON …" → Raida), so "Kawasaki Z1000
 * brake pad by Vesrah" is untouched (Kawasaki isn't a brand in the
 * catalog, and mid-name mentions don't trigger).
 *
 * DRY RUN by default; --apply to execute. --seller=email to scope.
 *
 *   node scripts/fix-brands-by-name.js --seller=revvgearz@gmail.com
 *   node scripts/fix-brands-by-name.js --seller=revvgearz@gmail.com --apply
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Product = require('../src/modules/products/product.model');
const Brand = require('../src/modules/catalog/brand.model');
const User = require('../src/models/User');

const APPLY = process.argv.includes('--apply');
const sellerEmail = (process.argv.find((a) => a.startsWith('--seller=')) || '').split('=')[1];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const brands = await Brand.find({}).select('name').lean();
  // Longest first, so "Red Rooster Performance" wins over a
  // hypothetical shorter "Red" brand.
  const sorted = brands.sort((a, b) => b.name.length - a.name.length);

  const filter = {};
  if (sellerEmail) {
    const seller = await User.findOne({ email: sellerEmail.toLowerCase().trim() });
    if (!seller) {
      console.error(`No user ${sellerEmail}`);
      process.exit(1);
    }
    filter.seller = seller._id;
  }
  const products = await Product.find(filter).select('name brand').populate('brand', 'name');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (--apply to execute)'}`);
  console.log(`${products.length} products scanned\n`);

  let fixed = 0;
  for (const p of products) {
    const name = String(p.name || '')
      .trim()
      .toLowerCase();
    const hit = sorted.find((b) => name.startsWith(b.name.toLowerCase() + ' '));
    if (!hit) continue;
    const currentName = p.brand?.name || '(none)';
    if (currentName.toLowerCase() === hit.name.toLowerCase()) continue;
    console.log(`  ✓ ${p.name.slice(0, 60)} — brand ${currentName} → ${hit.name}`);
    if (APPLY) {
      p.brand = hit._id;
      await p.save();
    }
    fixed += 1;
  }
  console.log(`\n${fixed} product(s) ${APPLY ? 'reassigned' : 'would be reassigned'}.`);
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
