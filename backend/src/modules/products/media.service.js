/**
 * The seller's Media tab: every image across their catalogue, and removing
 * product-embedded image references without ever leaving a product blank.
 */
const mongoose = require('mongoose');
const { logger } = require('../../utils/logger');
const products = require('./products.repository');

/** One row per image: kind main | color | sizeChart, with the product to link back to. */
async function mediaRows(sellerId) {
  const rows = [];
  for (const p of await products.mediaSourceForSeller(sellerId)) {
    const meta = { productId: p._id.toString(), productSlug: p.slug, productName: p.name, updatedAt: p.updatedAt };
    for (const url of Array.isArray(p.images) ? p.images : []) {
      if (typeof url === 'string' && url) rows.push({ ...meta, kind: 'main', color: null, url });
    }
    for (const bucket of Array.isArray(p.colorImages) ? p.colorImages : []) {
      const color = bucket && bucket.color ? String(bucket.color) : '';
      for (const url of Array.isArray(bucket && bucket.images) ? bucket.images : []) {
        if (typeof url === 'string' && url) rows.push({ ...meta, kind: 'color', color, url });
      }
    }
    if (p.sizeChartImage && typeof p.sizeChartImage === 'string')
      rows.push({ ...meta, kind: 'sizeChart', color: null, url: p.sizeChartImage });
  }
  return rows;
}

const blockedRow = (productId, productName, count, reason, message) => ({
  productId,
  productName,
  count,
  reason,
  message,
});

/**
 * Remove `{ productId, kind, color?, key }` references, grouped so each
 * product is loaded and saved once. A product that would be left with no
 * product photo (a size chart alone does not count) is blocked whole.
 * Returns `{ removed, blocked }`.
 */
async function bulkRemoveMedia(sellerId, items) {
  const byProduct = new Map();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const productId = String(raw.productId || '').trim();
    const kind = String(raw.kind || '').trim();
    const key = String(raw.key || '').trim();
    if (!productId || !key || !['main', 'color', 'sizeChart'].includes(kind)) continue;
    if (!byProduct.has(productId)) byProduct.set(productId, []);
    byProduct.get(productId).push({ kind, color: raw.color != null ? String(raw.color) : '', key });
  }

  const blocked = [];
  let removed = 0;
  for (const [productId, ops] of byProduct.entries()) {
    if (!mongoose.isValidObjectId(productId)) {
      blocked.push(blockedRow(productId, '', ops.length, 'NOT_FOUND', 'Product not found.'));
      continue;
    }
    const product = await products.findOwned(productId, sellerId);
    if (!product) {
      const exists = await products.exists(productId);
      blocked.push(
        blockedRow(
          productId,
          '',
          ops.length,
          exists ? 'NOT_OWNED' : 'NOT_FOUND',
          exists ? "You don't own this product." : 'Product not found.',
        ),
      );
      continue;
    }

    let localRemoved = 0;
    for (const op of ops) {
      if (op.kind === 'main') {
        const before = Array.isArray(product.images) ? product.images.length : 0;
        product.images = (Array.isArray(product.images) ? product.images : []).filter((u) => u !== op.key);
        localRemoved += before - product.images.length;
      } else if (op.kind === 'sizeChart') {
        if (product.sizeChartImage === op.key) {
          product.sizeChartImage = '';
          localRemoved += 1;
        }
      } else {
        const buckets = Array.isArray(product.colorImages) ? product.colorImages : [];
        const idx = buckets.findIndex((b) => String(b?.color || '') === op.color);
        if (idx >= 0) {
          const entry = buckets[idx];
          const before = Array.isArray(entry.images) ? entry.images.length : 0;
          entry.images = (Array.isArray(entry.images) ? entry.images : []).filter((u) => u !== op.key);
          localRemoved += before - entry.images.length;
          if (!entry.images.length) product.colorImages.splice(idx, 1); // drop the emptied colour
        }
      }
    }

    const mainCount = Array.isArray(product.images) ? product.images.length : 0;
    let colorCount = 0;
    for (const b of Array.isArray(product.colorImages) ? product.colorImages : [])
      colorCount += Array.isArray(b?.images) ? b.images.length : 0;
    if (mainCount + colorCount === 0) {
      blocked.push(
        blockedRow(
          productId,
          product.name,
          ops.length,
          'LAST_IMAGE',
          `Can't remove — this would leave "${product.name}" with no product photos ` +
            `(a size chart alone doesn't count as a listing image). Add another ` +
            `image first, or delete the product entirely.`,
        ),
      );
      continue;
    }
    // Main gallery drained but colour galleries remain: opt out of the schema
    // guard so it doesn't restore the just-removed keys.
    product.$locals.imagesWipeAcknowledged = mainCount === 0 && colorCount > 0;
    await product.save();
    removed += localRemoved;
  }

  logger.info(
    { sellerId: String(sellerId), productsAffected: byProduct.size, removed, blocked: blocked.length },
    'product media: bulk remove',
  );
  return { removed, blocked };
}

module.exports = { mediaRows, bulkRemoveMedia };
