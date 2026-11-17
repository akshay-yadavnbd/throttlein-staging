/**
 * Live-offer pricing for product responses and checkout.
 *
 * Decorating at read time (rather than storing the discounted price on the
 * product) is deliberate: offers switch on and off with a time window, so
 * the live price is evaluated per request. Offers are seller-scoped, so a
 * batch costs one query for all its sellers, not one per product.
 */
const offers = require('./offers.repository');
const { bestOfferForProduct, decorate } = require('./offer-pricing');

const plainOf = (p) => (typeof p.toObject === 'function' ? p.toObject() : { ...p });
const sellerOf = (p) => p.seller && (p.seller._id || p.seller);

/** `Map<sellerId, offer[]>` of every live offer for the given sellers. */
async function loadLiveOffersForSellers(sellerIds) {
  const out = new Map();
  const unique = Array.from(new Set(sellerIds.map((id) => String(id))));
  if (unique.length === 0) return out;
  for (const o of await offers.liveForSellers(unique, new Date())) {
    const k = String(o.seller);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(o);
  }
  return out;
}

/** One product (plain object or document) → a new plain object priced with its best live offer. */
async function resolveOfferForProduct(product) {
  if (!product) return product;
  const plain = plainOf(product);
  const sellerId = sellerOf(plain);
  if (!sellerId) {
    plain.activeOffer = null;
    return plain;
  }
  const bySeller = await loadLiveOffersForSellers([sellerId]);
  return decorate(plain, bestOfferForProduct(plain, bySeller.get(String(sellerId)) || []));
}

/** Many products, same order, each a new plain object. */
async function resolveOffersForProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return products || [];
  const plainList = products.map(plainOf);
  const bySeller = await loadLiveOffersForSellers(plainList.map(sellerOf).filter(Boolean));
  return plainList.map((p) => decorate(p, bestOfferForProduct(p, bySeller.get(String(sellerOf(p))) || [])));
}

module.exports = { loadLiveOffersForSellers, resolveOfferForProduct, resolveOffersForProducts };
