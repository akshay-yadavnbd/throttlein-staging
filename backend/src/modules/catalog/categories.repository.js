/** Category queries, plus the product-visibility lookup the navbar tree needs. */
const Category = require('./category.model');
const User = require('../../models/User');
const Product = require('../products/product.model');

const listSorted = (filter = {}) => Category.find(filter).sort({ order: 1, name: 1 });
const exists = (id) => Category.exists({ _id: id });
const findById = (id) => Category.findById(id);
const countChildren = (id) => Category.countDocuments({ parent: id });
const create = (fields) => Category.create(fields);

/**
 * Category and bike ids carried by storefront-visible products. Same gate as
 * the public product list: active status AND a seller approved on both
 * account and KYC, so a pending seller's upload never reveals a category early.
 */
async function visibleProductCategoryIds() {
  const sellers = await User.distinct('_id', { role: 'seller', status: 'approved', 'kyc.status': 'approved' });
  /** @type {Record<string, any>} */
  const visible = { status: 'active', seller: { $in: sellers } };
  const [catIds, bikeIds] = await Promise.all([
    Product.distinct('category', visible),
    Product.distinct('bike', visible),
  ]);
  return new Set([...catIds, ...bikeIds].filter(Boolean).map(String));
}

module.exports = { listSorted, exists, findById, countChildren, create, visibleProductCategoryIds };
