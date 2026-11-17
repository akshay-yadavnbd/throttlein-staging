/**
 * Product reads and stock writes the order flows need. Stock moves belong
 * to the catalogue domain; until a products module owns them they live
 * here, in one place, so the conditional-decrement rule has a single home.
 */
const Product = require('../products/product.model');
const { AppError } = require('../../errors/AppError');

const DEFAULT_WEIGHT_G = 500;
const DEFAULT_DIMS = { length: 15, breadth: 15, height: 10 };
const HEX_ID = /^[a-f0-9]{24}$/i;

/**
 * Weight (grams) and box dimensions (cm) per product id, with the
 * historical defaults (500 g, 15×15×10) for anything missing or deleted.
 */
async function parcelProfiles(productIds) {
  const ids = [...new Set((productIds || []).map(String).filter((x) => HEX_ID.test(x)))];
  const products = ids.length
    ? await Product.find({ _id: { $in: ids } }).select('weightGrams lengthCm breadthCm heightCm')
    : [];
  const map = new Map();
  for (const p of products) {
    map.set(String(p._id), {
      weightGrams: p.weightGrams || DEFAULT_WEIGHT_G,
      length: Number(p.lengthCm) || DEFAULT_DIMS.length,
      breadth: Number(p.breadthCm) || DEFAULT_DIMS.breadth,
      height: Number(p.heightCm) || DEFAULT_DIMS.height,
    });
  }
  return map;
}

/** Profile for one id, defaults when unknown. */
function profileFor(map, id) {
  return map.get(String(id || '')) || { weightGrams: DEFAULT_WEIGHT_G, ...DEFAULT_DIMS };
}

/* ── Conditional stock reservation (audit A07) ─────────────────────────────
 * Decrements WITH a `$gte` predicate — MongoDB applies filter+update
 * atomically per document, so exactly one concurrent buyer wins the last
 * unit. Aggregate and exact variant move in ONE document update. */

/** Reserve stock for order lines. Returns `{ ok, applied, failed }`;
 *  `applied` is the list needed by releaseStock() to roll back. */
async function reserveStock(items, session) {
  const applied = [];
  try {
    for (const it of items) {
      const quantity = Number(it.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) throw AppError.badRequest('Invalid stock quantity');
      const size = String(it.size || '').trim(),
        color = String(it.color || '').trim();
      let result = await Product.updateOne(
        {
          _id: it.product,
          stock: { $gte: quantity },
          variants: { $elemMatch: { size, color, stock: { $gte: quantity } } },
        },
        { $inc: { stock: -quantity, 'variants.$.stock': -quantity } },
        { session },
      );
      let variantApplied = result.modifiedCount > 0;
      if (!variantApplied) {
        result = await Product.updateOne(
          { _id: it.product, stock: { $gte: quantity }, 'variants.0': { $exists: false } },
          { $inc: { stock: -quantity } },
          { session },
        );
      }
      if (!result.modifiedCount) return { ok: false, applied, failed: it };
      applied.push({ product: it.product, seller: it.seller, quantity, size, color, variantApplied });
    }
    return { ok: true, applied, failed: null };
  } catch (error) {
    if (!session) await releaseStock(applied);
    throw error;
  }
}

async function releaseStock(applied, session) {
  for (const a of applied) {
    const inc = { stock: a.quantity };
    const options = { session };
    if (a.variantApplied) {
      inc['variants.$[v].stock'] = a.quantity;
      options.arrayFilters = [{ 'v.size': a.size || '', 'v.color': a.color || '' }];
    }
    await Product.updateOne({ _id: a.product }, { $inc: inc }, options);
  }
}

module.exports = { parcelProfiles, profileFor, reserveStock, releaseStock, DEFAULT_WEIGHT_G, DEFAULT_DIMS };
