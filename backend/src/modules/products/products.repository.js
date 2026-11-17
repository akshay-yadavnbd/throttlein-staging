/**
 * Product persistence — every query that names the Product collection.
 * Services receive documents and may call `doc.save()`.
 */
const mongoose = require('mongoose');
const Product = require('./product.model');

const isId = (v) => mongoose.isValidObjectId(v);

/** Route param that may be an ObjectId OR a slug; null when neither matches. */
async function findByIdOrSlug(idOrSlug) {
  if (!idOrSlug) return null;
  if (isId(idOrSlug)) {
    const p = await Product.findById(idOrSlug);
    if (p) return p;
  }
  return Product.findOne({ slug: String(idOrSlug).toLowerCase() });
}

/* ── storefront ───────────────────────────────────────────────────────── */

/**
 * Public detail with the seller's approval fields and return windows populated.
 * @returns {Promise<any>} populated: the checker cannot follow populate()
 */
const publicDetail = (idOrSlug) =>
  Product.findOne(isId(idOrSlug) ? { _id: idOrSlug } : { slug: String(idOrSlug).toLowerCase() })
    .populate('seller', 'name storeName slug email phone status kyc returnPolicyDays exchangePolicyDays')
    .populate('category', 'name slug parent')
    .populate('brand', 'name slug logo')
    .populate('bike', 'name slug parent');

const listPublic = (filter, { sort, skip, limit }) =>
  Promise.all([
    Product.find(filter)
      .populate('seller', 'name storeName')
      .populate('category', 'name slug parent')
      .populate('bike', 'name slug parent')
      .populate('brand', 'name slug logo')
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Product.countDocuments(filter),
  ]);

const countPublic = (filter) => Product.countDocuments(filter);

/** @returns {Promise<any>} populated: the checker cannot follow populate() */
const suggest = (filter, limit = 8) =>
  Product.find(filter)
    .select('name slug images colorImages listingColor category')
    .populate('category', 'name slug')
    .limit(limit)
    .lean();

/** Active product names, for the spell-correction vocabulary. */
const activeNames = (limit = 3000) => Product.find({ status: 'active' }).select('name').limit(limit);

/* ── seller catalogue ─────────────────────────────────────────────────── */

const listForSeller = (sellerId) =>
  Product.find({ seller: sellerId })
    .populate('category', 'name slug parent')
    .populate('bike', 'name slug parent')
    .sort({ createdAt: -1 });

const mediaSourceForSeller = (sellerId) =>
  Product.find({ seller: sellerId })
    .select('name slug images colorImages sizeChartImage updatedAt')
    .sort({ updatedAt: -1 });

/** @returns {Promise<any>} populated: the checker cannot follow populate() */
const exportSourceForSeller = (sellerId) =>
  Product.find({ seller: sellerId })
    .populate('category', 'name')
    .populate('brand', 'name')
    .populate({ path: 'bike', select: 'name parent', populate: { path: 'parent', select: 'name' } })
    .sort({ createdAt: -1 });

const create = (doc) => Product.create(doc);
const newProduct = (doc) => new Product(doc);

/** Populate the refs a saved product is answered with. */
async function populateRefs(product) {
  await product.populate('category', 'name slug parent');
  await product.populate('bike', 'name slug parent');
  await product.populate('brand', 'name slug logo');
  return product;
}

const bulkSetStatus = (filter, status) => Product.updateMany(filter, { $set: { status } });

const findOwned = (id, sellerId) => Product.findOne({ _id: id, seller: sellerId });
const exists = (id) => Product.exists({ _id: id });
const findOwnedBySku = (sellerId, sku) => Product.findOne({ seller: sellerId, sku });
const findOwnedByNameInCategory = (sellerId, name, categoryId) =>
  Product.findOne({ seller: sellerId, name, category: categoryId });

module.exports = {
  isId,
  findByIdOrSlug,
  publicDetail,
  listPublic,
  countPublic,
  suggest,
  activeNames,
  listForSeller,
  mediaSourceForSeller,
  exportSourceForSeller,
  create,
  newProduct,
  populateRefs,
  bulkSetStatus,
  findOwned,
  exists,
  findOwnedBySku,
  findOwnedByNameInCategory,
};
