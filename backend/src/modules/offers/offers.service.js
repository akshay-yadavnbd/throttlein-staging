/**
 * The seller dashboard's Offers tab (/dashboard/offers). Every read and
 * write is scoped to the signed-in seller, so a hand-crafted id can never
 * reach another seller's offer or products.
 */
const { AppError } = require('../../errors/AppError');
const offers = require('./offers.repository');
const { sanitiseOfferBody } = require('./offer-input');

const NEED_PRODUCTS = 'Pick at least one product, or switch scope to "all products".';

/**
 * Plain offer + what its card shows without a second request: product
 * summaries for scope=selected, or the seller's catalogue size for scope=all.
 */
async function withProducts(offer, sellerId) {
  const plain = offer.toObject({ virtuals: true });
  plain.productSummaries = [];
  if (plain.scope === 'selected') {
    const ids = Array.isArray(plain.products) ? plain.products : [];
    if (ids.length) {
      plain.productSummaries = (await offers.productSummaries(ids, sellerId)).map((p) => ({
        _id: p._id,
        name: p.name,
        slug: p.slug,
        thumb: Array.isArray(p.images) && p.images[0] ? p.images[0] : null,
      }));
    }
  } else {
    plain.catalogSize = await offers.catalogSize(sellerId);
  }
  return plain;
}

async function assertOwnsProducts(ids, sellerId) {
  if ((await offers.countOwnedProducts(ids, sellerId)) !== ids.length) {
    throw AppError.badRequest('One or more selected products do not belong to your catalog.');
  }
}

async function loadOwn(id, sellerId) {
  const offer = await offers.findOwn(id, sellerId);
  if (!offer) throw AppError.notFound('Offer not found.');
  return offer;
}

/** Newest first; `status=enabled|disabled` filters. */
async function list(sellerId, query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 30));
  const status = String(query.status || 'all').toLowerCase();
  const filter = { seller: sellerId };
  if (status === 'enabled') filter.enabled = true;
  else if (status === 'disabled') filter.enabled = false;
  const [docs, total] = await offers.page(filter, { skip: (page - 1) * limit, limit });
  const items = await Promise.all(docs.map((d) => withProducts(d, sellerId)));
  return { items, page, limit, total };
}

async function create(sellerId, raw) {
  const body = sanitiseOfferBody(raw || {});
  if (!body.title) throw AppError.badRequest('A title is required (e.g. "Diwali Sale 20% off").');
  if (!body.discountType) body.discountType = 'percent';
  if (body.discountValue == null || body.discountValue <= 0)
    throw AppError.badRequest('discountValue must be greater than 0.');
  if (!body.scope) body.scope = 'all';
  if (body.scope === 'selected') {
    if (!body.products || body.products.length === 0) throw AppError.badRequest(NEED_PRODUCTS);
    await assertOwnsProducts(body.products, sellerId);
  }
  const offer = await offers.create({ ...body, seller: sellerId });
  return { offer: await withProducts(offer, sellerId) };
}

async function get(sellerId, id) {
  return { offer: await withProducts(await loadOwn(id, sellerId), sellerId) };
}

async function update(sellerId, id, raw) {
  const offer = await loadOwn(id, sellerId);
  const body = sanitiseOfferBody(raw || {});
  const nextScope = body.scope || offer.scope;
  const nextProducts = 'products' in body ? body.products : offer.products;
  if (nextScope === 'selected' && (!nextProducts || nextProducts.length === 0))
    throw AppError.badRequest(NEED_PRODUCTS);
  if (nextScope === 'selected' && 'products' in body) await assertOwnsProducts(body.products, sellerId);

  for (const [k, v] of Object.entries(body)) offer[k] = v;
  // scope=all drops leftover product ids so the document stays coherent.
  if (offer.scope === 'all') offer.products = [];
  await offer.save();
  return { offer: await withProducts(offer, sellerId) };
}

async function toggle(sellerId, id) {
  const offer = await loadOwn(id, sellerId);
  offer.enabled = !offer.enabled;
  await offer.save();
  return { offer: await withProducts(offer, sellerId) };
}

async function remove(sellerId, id) {
  const r = await offers.deleteOwn(id, sellerId);
  if (r.deletedCount === 0) throw AppError.notFound('Offer not found.');
}

module.exports = { list, create, get, update, toggle, remove };
