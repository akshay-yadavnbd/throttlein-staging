/**
 * Pure offer arithmetic: what an offer saves on a price, which live offer
 * wins for a product, and how a product is decorated with it. No I/O.
 *
 * Selection rule when several offers apply: the one that saves the shopper
 * the MOST rupees on that product. Ties go to the soonest-expiring `endsAt`
 * (gentle urgency), then `_id` ascending for a stable order.
 */

/**
 * Rupees a specific offer saves on a specific list price. Honours the
 * `maxDiscount` cap on percent offers; ignores `minCartAmount` (that gates
 * at cart time, not per-product display). `null` when the offer does not
 * apply. Never takes a price below ₹1: a rounding error must not let an
 * order check out for zero.
 */
function computeSavings(offer, listPrice) {
  const price = Number(listPrice) || 0;
  if (price <= 0) return null;
  let saved;
  if (offer.discountType === 'percent') {
    const pct = Math.min(100, Math.max(0, Number(offer.discountValue) || 0));
    saved = (price * pct) / 100;
    if (offer.maxDiscount != null) saved = Math.min(saved, Number(offer.maxDiscount) || 0);
  } else if (offer.discountType === 'flat') {
    saved = Number(offer.discountValue) || 0;
  } else {
    return null;
  }
  if (!Number.isFinite(saved) || saved <= 0) return null;
  if (saved >= price) saved = Math.max(0, price - 1);
  if (saved <= 0) return null;
  return saved;
}

/** The offer with the highest savings for `product`: `{ offer, savings }`, or null when none applies. */
function bestOfferForProduct(product, offersForSeller) {
  if (!offersForSeller || offersForSeller.length === 0) return null;
  const pid = String(product._id);
  let best = null;
  for (const offer of offersForSeller) {
    // 'all' matches every product of the seller; 'selected' only the listed ones.
    if (offer.scope === 'selected') {
      const list = Array.isArray(offer.products) ? offer.products : [];
      if (!list.some((p) => String(p) === pid)) continue;
    }
    const savings = computeSavings(offer, product.price);
    if (savings == null) continue;
    if (!best || savings > best.savings) {
      best = { offer, savings };
      continue;
    }
    if (savings === best.savings) {
      const a = offer.endsAt ? offer.endsAt.getTime() : Infinity;
      const b = best.offer.endsAt ? best.offer.endsAt.getTime() : Infinity;
      if (a < b || (a === b && String(offer._id) < String(best.offer._id))) best = { offer, savings };
    }
  }
  return best;
}

/**
 * Decorate a plain product object in place with the winning offer:
 *   price            post-offer price
 *   originalPrice    the seller's pre-offer selling price (the PDP's middle tier when a
 *                    shopper removes the coupon: MRP → selling price → final price)
 *   mrp              max(mrp, original price), so the strikethrough is always higher
 *   discountPercent  recomputed off (mrp - price) / mrp
 *   activeOffer      the offer summary, or null when none applied
 */
function decorate(out, best) {
  if (!best) {
    out.activeOffer = null;
    return out;
  }
  const originalPrice = Number(out.price) || 0;
  const originalMrp = Number(out.mrp) || 0;
  const newPrice = Math.max(1, Math.round(originalPrice - best.savings));
  const effectiveMrp = Math.max(originalMrp, originalPrice);
  out.originalPrice = originalPrice;
  out.price = newPrice;
  out.mrp = effectiveMrp;
  out.discountPercent = effectiveMrp > 0 ? Math.round(((effectiveMrp - newPrice) / effectiveMrp) * 100) : 0;
  out.activeOffer = {
    _id: best.offer._id,
    title: best.offer.title,
    discountType: best.offer.discountType,
    discountValue: best.offer.discountValue,
    endsAt: best.offer.endsAt || null,
    savings: best.savings,
  };
  return out;
}

module.exports = { computeSavings, bestOfferForProduct, decorate };
