/**
 * A seller's own catalogue: who may list, create, update, delete, and bulk
 * publish / unpublish. The image pipeline lives in product-images.service.
 */
const mongoose = require('mongoose');
const { AppError } = require('../../errors/AppError');
const products = require('./products.repository');
const catalog = require('./catalog.repository');
const tree = require('./catalog-tree.service');
const input = require('./product-input');
const images = require('./product-images.service');

const isSuperadmin = (user) => user.role === 'superadmin';

/**
 * Two-step approval gate: KYC approved AND account approved. Super admin
 * bypasses — they manage the platform's own catalogue directly.
 */
function assertCanList(user) {
  if (user.role !== 'seller') return;
  const kycStatus = user.kyc?.status || 'not_started';
  if (kycStatus !== 'approved') {
    throw AppError.forbidden(
      {
        not_started: 'Complete your KYC before listing products.',
        pending: "Your KYC is still under review — listing will unlock once it's approved.",
        rejected: 'Your last KYC submission was rejected. Update and resubmit to start listing.',
      }[kycStatus] || 'KYC verification required before listing products.',
    );
  }
  if (user.status !== 'approved') {
    throw AppError.forbidden(
      user.status === 'suspended'
        ? 'Your account is suspended. Contact support to reactivate listing.'
        : 'Your KYC is verified — listing unlocks as soon as our team activates your store.',
    );
  }
}

function assertSkuAndWeight(sku, weight, { required }) {
  if ((required || sku !== undefined) && !String(sku || '').trim()) throw AppError.badRequest('SKU is required.');
  if (required || weight !== undefined) {
    if (weight === undefined || weight === '' || !Number.isFinite(Number(weight)) || Number(weight) <= 0) {
      throw AppError.badRequest('Weight (grams) is required and must be greater than zero.');
    }
  }
}

async function assertProductCategory(id) {
  if (!mongoose.isValidObjectId(id)) throw AppError.badRequest('Invalid category id.');
  if (!(await tree.isOutsideShopByBike(id))) throw AppError.badRequest('Pick a product category, not a bike model.');
}

async function assertBike(id) {
  if (!mongoose.isValidObjectId(id)) throw AppError.badRequest('Invalid bike id.');
  if (!(await tree.isInShopByBike(id))) throw AppError.badRequest('Selected bike must be from the Shop by Bike list.');
}

async function assertBrand(id) {
  if (!mongoose.isValidObjectId(id)) throw AppError.badRequest('Invalid brand id.');
  if (!(await catalog.brandExists(id))) throw AppError.badRequest('Selected brand does not exist.');
}

const sumStock = (variants) => variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);

/** POST /api/products — a new listing for this seller. Returns the populated product. */
async function createProduct(user, raw, uploaded) {
  assertCanList(user);
  const body = { ...raw, seller: user._id };
  for (const field of ['_id', 'rating', 'reviewsCount', 'createdAt', 'updatedAt', '__v']) delete body[field];
  if (!isSuperadmin(user)) delete body.isFeatured;
  for (const k of input.NUMERIC_FIELDS) if (body[k] !== undefined && body[k] !== '') body[k] = Number(body[k]);
  if (body.codAvailable !== undefined) body.codAvailable = input.toBool(body.codAvailable);
  delete body.gstRate;
  delete body.hsn;
  Object.assign(body, input.readTaxFields(raw));
  // Sellers pick from the self-service states; anything else falls to the schema default.
  if (body.status !== undefined) {
    const s = input.sellerStatus(body.status);
    if (s) body.status = s;
    else delete body.status;
  }
  assertSkuAndWeight(body.sku, body.weightGrams, { required: true });
  if (!body.category) throw AppError.badRequest('Category is required.');
  await assertProductCategory(body.category);
  if (body.bike) await assertBike(body.bike);
  else body.bike = null;
  if (body.brand) await assertBrand(body.brand);
  else body.brand = null;
  body.sizes = body.sizes !== undefined ? input.parseSizes(body.sizes) : [];
  // When the variants matrix is used it is the source of truth for stock.
  if (body.variants !== undefined) {
    const parsed = input.parseVariants(body.variants);
    body.variants = parsed;
    if (parsed.length > 0) body.stock = sumStock(parsed);
  }
  images.applyCreateImages(body, raw, uploaded);
  images.assertCreateHasImage(body);
  body.cities = input.normalizeCities(body.cities);
  body.states = input.normalizeCities(body.states);
  body.country = input.normalizeCities(body.country)[0] || '';

  const product = await products.create(body);
  return products.populateRefs(product);
}

/**
 * GET /api/products/mine/:id — the full record for the editor. Unlike the
 * public lookup it ignores listing and verification state: a seller still
 * waiting on KYC, or with a draft or rejected listing, must be able to open it.
 */
async function getOwnProduct(user, idOrSlug) {
  const product = await products.findByIdOrSlug(idOrSlug);
  if (!product || (!isSuperadmin(user) && product.seller.toString() !== user._id.toString()))
    throw AppError.notFound('Product not found.');
  return products.populateRefs(product);
}

/** Fields the generic assign loop copies straight from the body. */
const ASSIGNABLE = [
  'name',
  'category',
  'description',
  'price',
  'mrp',
  'stock',
  'sku',
  'color',
  'listingColor',
  'weightGrams',
  'lengthCm',
  'breadthCm',
  'heightCm',
  'seoTitle',
  'seoDescription',
  'ogImage',
  'returnPolicyDays',
  'exchangePolicyDays',
];

/** PUT /api/products/:id — the seller's own product (admin: any). Returns the populated product. */
async function updateProduct(user, idOrSlug, raw, uploaded) {
  const product = await products.findByIdOrSlug(idOrSlug);
  if (!product) throw AppError.notFound('Product not found.');
  if (!isSuperadmin(user) && product.seller.toString() !== user._id.toString())
    throw AppError.forbidden('You can only update your own products.');

  const taxFields = input.readTaxFields(raw);
  // Never let a client blank SKU or weight on an existing product.
  assertSkuAndWeight(raw.sku, raw.weightGrams, { required: false });
  if (raw.category !== undefined && raw.category !== '') await assertProductCategory(raw.category);
  if (raw.bike !== undefined) {
    if (!raw.bike) product.bike = null;
    else await assertBike(raw.bike);
  }
  if (raw.brand !== undefined) {
    if (!raw.brand) product.brand = null;
    else await assertBrand(raw.brand);
  }

  for (const k of ASSIGNABLE) if (raw[k] !== undefined) product[k] = raw[k];
  if (raw.isFeatured !== undefined && isSuperadmin(user)) product.isFeatured = raw.isFeatured;
  Object.assign(product, taxFields);
  if (raw.codAvailable !== undefined) product.codAvailable = input.toBool(raw.codAvailable);
  // Junk status values are ignored rather than tripping enum validation.
  const status = input.sellerStatus(raw.status);
  if (status) product.set('status', status);
  if (raw.bike) product.bike = raw.bike;
  if (raw.brand) product.brand = raw.brand;
  if (raw.sizes !== undefined) product.sizes = input.parseSizes(raw.sizes);
  if (raw.cities !== undefined) product.cities = input.normalizeCities(raw.cities);
  if (raw.states !== undefined) product.states = input.normalizeCities(raw.states);
  if (raw.country !== undefined) product.country = input.normalizeCities(raw.country)[0] || '';

  // Variants: a payload with rows replaces the matrix; a LITERAL '[]' clears
  // it; anything else leaves the prior matrix alone. Top-level stock is
  // recomputed only when a row's stock changed — orders decrement
  // `product.stock` but not variants[].stock, so round-tripping an unchanged
  // matrix must not resurrect sold units.
  if (raw.variants !== undefined) {
    const parsed = input.parseVariants(raw.variants);
    if (parsed.length > 0) {
      const prior = Array.isArray(product.variants) ? product.variants : [];
      const stocksUnchanged =
        prior.length === parsed.length &&
        parsed.every((v) => {
          const old = prior.find((o) => o.size === v.size && o.color === v.color);
          return old && Number(old.stock) === Number(v.stock);
        });
      product.set('variants', parsed);
      if (!stocksUnchanged) product.stock = sumStock(parsed);
    } else if (input.isExplicitEmptyArray(raw.variants)) {
      product.set('variants', []);
    }
  }

  images.applyUpdateImages(product, raw, uploaded);
  await product.save();
  return products.populateRefs(product);
}

/**
 * POST /api/products/bulk-status. Only the caller's own products move; a
 * rejected listing cannot be re-activated this way (that is the admin's
 * call), so those ids come back as skipped.
 */
async function bulkSetStatus(user, rawIds, status) {
  const ids = Array.isArray(rawIds) ? rawIds.filter((x) => mongoose.isValidObjectId(x)).slice(0, 500) : [];
  if (!ids.length || !['active', 'draft'].includes(status))
    throw AppError.badRequest('Provide product ids and a status of active or draft.');
  const filter = { _id: { $in: ids } };
  if (!isSuperadmin(user)) filter.seller = user._id;
  if (status === 'active') filter.status = { $ne: 'rejected' };
  const result = await products.bulkSetStatus(filter, status);
  return { updated: result.modifiedCount, skipped: ids.length - result.matchedCount };
}

/** DELETE /api/products/:id */
async function removeProduct(user, idOrSlug) {
  const product = await products.findByIdOrSlug(idOrSlug);
  if (!product) throw AppError.notFound('Product not found.');
  if (!isSuperadmin(user) && product.seller.toString() !== user._id.toString())
    throw AppError.forbidden('You can only delete your own products.');
  await product.deleteOne();
}

module.exports = { assertCanList, createProduct, getOwnProduct, updateProduct, bulkSetStatus, removeProduct };
