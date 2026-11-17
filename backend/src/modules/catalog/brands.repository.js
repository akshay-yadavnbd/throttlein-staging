/** Brand queries and the per-brand product counts the lists attach. */
const Brand = require('./brand.model');
const Product = require('../products/product.model');

const listSorted = (filter = {}) => Brand.find(filter).sort({ order: 1, name: 1 });
const findById = (id) => Brand.findById(id);
const create = (fields) => Brand.create(fields);

/** Product count per brand id, as a Map. `activeOnly` counts only active products. One aggregation for all brands. */
async function productCountsByBrand({ activeOnly }) {
  const match = activeOnly ? { status: 'active', brand: { $ne: null } } : { brand: { $ne: null } };
  const rows = await Product.aggregate([{ $match: match }, { $group: { _id: '$brand', n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

module.exports = { listSorted, findById, create, productCountsByBrand };
