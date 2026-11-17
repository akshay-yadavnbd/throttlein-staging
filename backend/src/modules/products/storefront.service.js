/**
 * What shoppers see: the public listing with its filters and search, the
 * product detail, autocomplete, and the live shipping-rate quote.
 */
const mongoose = require('mongoose');
const { AppError } = require('../../errors/AppError');
const shiprocket = require('../../infrastructure/shipping/shiprocket');
const { resolveOfferForProduct, resolveOffersForProducts } = require('../offers');
const products = require('./products.repository');
const catalog = require('./catalog.repository');
const tree = require('./catalog-tree.service');
const search = require('./search.service');
const { listingImageFor, withListingImage } = require('./listing-image');
const { slugify } = require('./product-input');

// Every sort ends with `_id: -1` as a stable tiebreaker so products that
// share a value always come back in the same order across requests —
// otherwise the storefront's SSR-then-client-refetch briefly reshuffles.
const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { price: 1, _id: -1 },
  price_desc: { price: -1, _id: -1 },
  rating: { rating: -1, _id: -1 },
};

const emptyPage = (page, limit) => ({ items: [], total: 0, page: Number(page), limit: Number(limit), pages: 0 });

/**
 * GET /api/products. Filters fail CLOSED: an unresolved category, brand or
 * seller returns an empty page rather than silently showing everything.
 */
async function listPublic(query) {
  const {
    q,
    category,
    bike,
    brand,
    seller,
    minPrice,
    maxPrice,
    sort,
    city,
    state,
    country,
    page = 1,
    limit = 24,
  } = query;
  const allowedSellers = await catalog.approvedSellerIds();
  const filter = { status: 'active', seller: { $in: allowedSellers } };

  // exact=1 disables the spell-correct retry ("Search instead for …").
  let correctedQuery = null;
  const rawQuery = q ? String(q).trim() : '';
  if (rawQuery) {
    const resolved = await search.resolveSearch(rawQuery, filter, { exact: String(query.exact || '') === '1' });
    if (resolved.conds.length) filter.$and = resolved.conds;
    correctedQuery = resolved.correctedQuery;
  }
  if (seller) {
    const isAllowed = mongoose.isValidObjectId(seller) && allowedSellers.some((id) => String(id) === String(seller));
    if (!isAllowed) return emptyPage(page, limit);
    filter.seller = seller;
  }
  if (category) {
    const cat = await tree.resolveCategory(category);
    if (!cat) return emptyPage(page, limit);
    const ids = await tree.collectCategoryAndDescendantIds(cat._id);
    // Shop-by-Bike nodes live in the category tree but products attach them
    // via `bike`, not `category` — switch the field or the bike pages are empty.
    if (await tree.isInShopByBike(cat._id)) filter.bike = { $in: ids };
    else filter.category = { $in: ids };
  }
  if (brand) {
    const brandDoc = await tree.resolveBrand(brand);
    if (!brandDoc) return emptyPage(page, limit);
    filter.brand = brandDoc._id;
  }
  if (bike && mongoose.isValidObjectId(bike)) filter.bike = bike;
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }
  // Location tags — each level matches its own field; all given levels apply.
  if (city && slugify(city)) filter.cities = slugify(city);
  if (state && slugify(state)) filter.states = slugify(state);
  if (country && slugify(country)) filter.country = slugify(country);
  // discounted=1 — the product's own MRP above its price (live SellerOffers
  // are applied after the query, so they are not matched here).
  if (String(query.discounted || '') === '1') filter.$expr = { $gt: ['$mrp', '$price'] };

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await products.listPublic(filter, {
    sort: SORTS[sort] || SORTS.newest,
    skip,
    limit: Number(limit),
  });

  // Image fields are presigned by the global middleware. Live-offer
  // decoration overrides price / mrp / discountPercent so existing cards
  // render the discounted price; `activeOffer` carries the summary.
  const decorated = await resolveOffersForProducts(items.map(withListingImage));
  return {
    items: decorated,
    page: Number(page),
    limit: Number(limit),
    total,
    pages: Math.ceil(total / Number(limit)),
    ...(rawQuery ? { query: rawQuery } : {}),
    ...(correctedQuery ? { correctedQuery } : {}),
  };
}

/** Autocomplete rows for the navbar — same approval gate as the listing. */
async function suggestions(q) {
  const trimmed = String(q || '').trim();
  if (!trimmed) return [];
  const allowedSellers = await catalog.approvedSellerIds();
  const docs = await products.suggest(await search.suggestFilter(trimmed, allowedSellers));
  return docs.map((p) => ({
    _id: p._id,
    name: p.name,
    slug: p.slug,
    image: listingImageFor(p) || null,
    category: p.category ? { name: p.category.name, slug: p.category.slug } : null,
  }));
}

/** Public detail; 404 when the seller is not fully approved, so a pending seller's product never leaks. */
async function publicProduct(idOrSlug) {
  const product = await products.publicDetail(idOrSlug);
  if (!product) throw AppError.notFound('Product not found.');
  const v = product.seller;
  if (!(v && v.status === 'approved' && v.kyc && v.kyc.status === 'approved'))
    throw AppError.notFound('Product not found.');
  const out = product.toObject();
  // Back-office fields stripped; the return windows let the PDP fall back to the seller's defaults.
  out.seller = {
    _id: v._id,
    name: v.name,
    storeName: v.storeName,
    email: v.email,
    phone: v.phone,
    returnPolicyDays: v.returnPolicyDays,
    exchangePolicyDays: v.exchangePolicyDays,
  };
  out.listingImage = listingImageFor(out);
  return resolveOfferForProduct(out);
}

/**
 * "Will this reach me, how much, how fast" for the product page. Never
 * throws for expected cases — always `{ ok:false, reason }` so the widget
 * renders an inline message: bad-pincode | seller-not-ready |
 * seller-excluded | unserviceable | error.
 */
async function shippingRate(idOrSlug, pincodeRaw) {
  const pincode = String(pincodeRaw || '').trim();
  if (!/^[1-9][0-9]{5}$/.test(pincode)) return { ok: false, reason: 'bad-pincode' };
  const product = await products.findByIdOrSlug(idOrSlug);
  if (!product) return { ok: false, reason: 'error', detail: 'Product not found.' };

  const seller = await catalog.sellerShippingProfile(product.seller);
  const sellerApproved = seller && seller.status === 'approved' && seller.kyc && seller.kyc.status === 'approved';
  const pickupPincode = seller?.kyc?.pickupAddress?.pincode;
  if (!sellerApproved || !pickupPincode) return { ok: false, reason: 'seller-not-ready' };

  // Seller exclusions: exact 6-digit match or numeric prefix ("19" blocks 19xxxx).
  const excluded = (seller.excludedPincodes || []).some((x) => {
    const p = String(x).trim();
    return p.length === 6 ? pincode === p : pincode.startsWith(p);
  });
  if (excluded) return { ok: false, reason: 'seller-excluded' };

  let data;
  try {
    data = await shiprocket.serviceability({
      pickup_pincode: pickupPincode,
      delivery_pincode: pincode,
      weight: Math.max(0.5, (product.weightGrams || 500) / 1000),
      // cod=1 so a COD-capable courier's cod_charges come back non-zero —
      // Shiprocket has no per-courier COD flag.
      cod: 1,
    });
  } catch (err) {
    return { ok: false, reason: 'error', detail: err?.message || 'Shiprocket request failed.' };
  }
  const couriers = data?.data?.available_courier_companies || [];
  if (!couriers.length) return { ok: false, reason: 'unserviceable' };

  const recommendedId = data?.data?.recommended_by?.id;
  const best =
    couriers.find((c) => c.courier_company_id === recommendedId) ||
    couriers.reduce((a, b) => (Number(b.rate) < Number(a.rate) ? b : a), couriers[0]);
  // COD needs all three to agree, in the order checkout applies them: a
  // courier that carries COD here, a seller who has COD on, a product without
  // an online-only override.
  const courierCod = couriers.some((c) => Number(c.cod_charges) > 0);
  return {
    ok: true,
    fee: Number(best.rate) || 0,
    etaDays: Number(best.estimated_delivery_days) || null,
    etaDate: null,
    courier: best.courier_name,
    codAvailable: courierCod && seller.codEnabled !== false && product.codAvailable !== false,
  };
}

module.exports = { SORTS, listPublic, suggestions, publicProduct, shippingRate };
