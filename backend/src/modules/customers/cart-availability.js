/**
 * Can this cart line be bought right now?
 *
 * One rule shared by GET /api/cart (so the storefront can show the line
 * greyed out with a reason, Flipkart-style) and by checkout (so the
 * order is built from exactly the lines the customer saw as buyable).
 *
 *   ok           — in stock for the quantity asked
 *   limited      — some stock, but less than the quantity asked
 *   out_of_stock — product (or the chosen size/colour) has no stock
 *   unavailable  — product deleted, unpublished, variant gone, or seller
 *                  no longer approved
 *
 * `line.product` must be populated; `product.seller` may be populated
 * with `status` + `kyc.status` — when it isn't, the seller gate is skipped.
 */
function lineAvailability(line) {
  const p = line?.product;
  if (!p || typeof p !== 'object')
    return { state: 'unavailable', stock: 0, message: 'This item is no longer available' };
  if (p.status && p.status !== 'active')
    return { state: 'unavailable', stock: 0, message: 'This item is no longer available' };
  const seller = p.seller;
  if (seller && typeof seller === 'object' && 'status' in seller) {
    const approved = seller.status === 'approved' && seller.kyc && seller.kyc.status === 'approved';
    if (!approved) return { state: 'unavailable', stock: 0, message: 'This seller is no longer on THROTTLEIN' };
  }

  const size = String(line.size || '').trim();
  const color = String(line.color || '').trim();
  const variants = Array.isArray(p.variants) ? p.variants : [];
  let stock = Number(p.stock) || 0;
  if (variants.length > 0 && (size || color)) {
    const v = variants.find(
      (x) => (!size || String(x.size || '').trim() === size) && (!color || String(x.color || '').trim() === color),
    );
    if (!v)
      return {
        state: 'unavailable',
        stock: 0,
        message: `No longer available in ${[size, color].filter(Boolean).join(' / ')}`,
      };
    stock = Math.min(stock, Number(v.stock) || 0);
  }

  const qty = Number(line.quantity) || 1;
  if (stock <= 0) return { state: 'out_of_stock', stock: 0, message: 'Out of stock' };
  if (stock < qty) return { state: 'limited', stock, message: `Only ${stock} left — reduce the quantity` };
  return { state: 'ok', stock, message: '' };
}

const buyable = (a) => a.state === 'ok';

module.exports = { lineAvailability, buyable };
