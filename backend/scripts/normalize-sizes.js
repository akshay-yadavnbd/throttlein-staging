/**
 * normalize-sizes.js
 *
 * Cleans junk size values that came in with the Shopify migration and
 * unifies the sizing convention across every product:
 *
 *   - uppercase            s, m, xl        → S, M, XL
 *   - X-run to numeric     XXL, XXXL       → 2XL, 3XL
 *   - stray suffixes       S-3, M-3, L-3   → S, M, L
 *     (only when the base is a letter size — numeric sizes like the
 *     shoe size "10-5" (10.5) are left alone)
 *
 * Applies to BOTH `sizes` arrays and the size field of each variant.
 * If normalisation makes two variant rows collide (same size+colour),
 * their stocks are summed into one row.
 *
 * DRY RUN by default; --apply to execute. --seller=email to scope.
 *
 *   node scripts/normalize-sizes.js --seller=revvgearz@gmail.com
 *   node scripts/normalize-sizes.js --seller=revvgearz@gmail.com --apply
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Product = require('../src/modules/products/product.model');
const User = require('../src/models/User');

const APPLY = process.argv.includes('--apply');
const sellerEmail = (process.argv.find((a) => a.startsWith('--seller=')) || '').split('=')[1];

function normSize(raw) {
  let s = String(raw || '')
    .trim()
    .toUpperCase();
  if (!s) return s;
  // XXL-style runs → numeric-XL ("XXL" → 2XL, "XXXL" → 3XL, …)
  const xRun = s.match(/^(X{2,})L$/);
  if (xRun) s = `${xRun[1].length}XL`;
  //

  // Letter size with a stray "-<digit>" suffix → drop the suffix.
  const stray = s.match(/^(XS|S|M|L|XL|\dXL)[-. ]\d$/);
  if (stray) s = stray[1];
  return s;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const filter = {};
  if (sellerEmail) {
    const seller = await User.findOne({ email: sellerEmail.toLowerCase().trim() });
    if (!seller) {
      console.error(`No user ${sellerEmail}`);
      process.exit(1);
    }
    filter.seller = seller._id;
  }
  const products = await Product.find(filter).select('name sizes variants');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (--apply to execute)'}`);
  console.log(`${products.length} products scanned\n`);

  let touched = 0;
  for (const p of products) {
    let dirty = false;

    // sizes[]
    const newSizes = [...new Set((p.sizes || []).map(normSize).filter(Boolean))];
    if (JSON.stringify(newSizes) !== JSON.stringify(p.sizes || [])) {
      console.log(`  ✓ ${p.name.slice(0, 55)} — sizes [${(p.sizes || []).join(', ')}] → [${newSizes.join(', ')}]`);
      p.sizes = newSizes;
      dirty = true;
    }

    // variants[].size — merge rows that collide after normalisation
    if (Array.isArray(p.variants) && p.variants.length) {
      const byKey = new Map();
      let changedVariant = false;
      for (const v of p.variants) {
        const size = normSize(v.size);
        if (size !== String(v.size || '').trim()) changedVariant = true;
        const key = `${size}::${(v.color || '').trim()}`;
        const prev = byKey.get(key);
        if (prev) {
          prev.stock = (Number(prev.stock) || 0) + (Number(v.stock) || 0);
          changedVariant = true;
        } else {
          byKey.set(key, { ...(v.toObject ? v.toObject() : v), size });
        }
      }
      if (changedVariant) {
        const merged = Array.from(byKey.values());
        console.log(
          `  ✓ ${p.name.slice(0, 55)} — ${p.variants.length} variant rows → ${merged.length} (sizes normalised)`,
        );
        p.variants = merged;
        p.markModified('variants');
        p.stock = merged.reduce((s, v) => s + (Number(v.stock) || 0), 0);
        dirty = true;
      }
    }

    if (dirty) {
      touched += 1;
      if (APPLY) await p.save();
    }
  }
  console.log(`\n${touched} product(s) ${APPLY ? 'updated' : 'would be updated'}.`);
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
