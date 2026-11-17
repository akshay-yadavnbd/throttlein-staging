/**
 * Stock arithmetic for offline sales, on a loaded product document. Pure.
 *
 *   No variants        → the change goes to `product.stock`.
 *   Variants + a size / colour that matches a row → the change goes to that
 *                        row, and `product.stock` is recomputed as the sum of
 *                        all rows, so "In stock" filters stay accurate.
 *   A sale whose variant no longer exists → the change goes to `product.stock`
 *                        rather than being lost.
 */

const hasVariants = (product) => Array.isArray(product.variants) && product.variants.length > 0;

/** Index of the variant row matching size + colour exactly (both trimmed), or -1. */
function findVariantIndex(product, size, color) {
  const list = Array.isArray(product.variants) ? product.variants : [];
  const s = String(size || '').trim();
  const c = String(color || '').trim();
  return list.findIndex((v) => String(v.size || '').trim() === s && String(v.color || '').trim() === c);
}

function sumVariantStock(product) {
  const list = Array.isArray(product.variants) ? product.variants : [];
  return list.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
}

/** Apply a signed change; returns the stock that was there BEFORE it, at the row that was touched. */
function applyStockChange(product, variant, change) {
  if (hasVariants(product) && (variant?.size || variant?.color)) {
    const idx = findVariantIndex(product, variant.size, variant.color);
    if (idx >= 0) {
      const before = Number(product.variants[idx].stock) || 0;
      product.variants[idx].stock = before + change;
      product.stock = sumVariantStock(product);
      return before;
    }
  }
  const before = Number(product.stock) || 0;
  product.stock = before + change;
  return before;
}

module.exports = { hasVariants, findVariantIndex, sumVariantStock, applyStockChange };
