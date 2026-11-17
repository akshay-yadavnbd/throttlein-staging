/** Offline sale queries, always scoped to their seller, and the product / seller reads they need. */
const OfflineSale = require('./offline-sale.model');
const Product = require('../products/product.model');
const User = require('../../models/User');
const Counter = require('../../models/Counter');

const page = (filter, { skip, limit }) =>
  Promise.all([
    OfflineSale.find(filter).sort({ saleDate: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    OfflineSale.countDocuments(filter),
  ]);

/** Revenue and units over everything the filter matches, not just one page. */
async function totals(filter) {
  const [row] = await OfflineSale.aggregate([
    { $match: filter },
    { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' }, totalUnits: { $sum: '$quantity' } } },
  ]);
  return { totalRevenue: row?.totalRevenue || 0, totalUnits: row?.totalUnits || 0 };
}

const create = (fields) => OfflineSale.create(fields);
/** `liveOnly` skips sales already undone (soft-deleted). */
const findOwn = (id, sellerId, { liveOnly = false } = {}) =>
  OfflineSale.findOne({ _id: id, seller: sellerId, ...(liveOnly ? { deletedAt: null } : {}) });

const ownProductIds = (sellerId) => Product.find({ seller: sellerId }).distinct('_id');
const ownProduct = (id, sellerId) => Product.findOne({ _id: id, seller: sellerId });
const lookupProducts = (filter) =>
  Product.find(filter).select('_id name slug price stock variants sku').sort({ name: 1 }).limit(50).lean();

const sellerTaxFields = (sellerId) => User.findById(sellerId).select('kyc.gstin kyc.pickupAddress.state').lean();
const sellerInvoiceFields = (sellerId) =>
  User.findById(sellerId).select('name storeName email phone address kyc.gstin kyc.pickupAddress').lean();

const nextSequence = (name) => Counter.next(name);

module.exports = {
  page,
  totals,
  create,
  findOwn,
  ownProductIds,
  ownProduct,
  lookupProducts,
  sellerTaxFields,
  sellerInvoiceFields,
  nextSequence,
};
