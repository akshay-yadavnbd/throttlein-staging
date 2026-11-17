/** Seller offers, always scoped to their seller, and the product reads offer cards need. */
const SellerOffer = require('./seller-offer.model');
const Product = require('../products/product.model');

/**
 * Every LIVE offer of the given sellers, in one indexed query
 * (seller + enabled + dates). Live = enabled, started (or no start), not ended (or no end).
 */
const liveForSellers = (sellerIds, now) =>
  SellerOffer.find({
    seller: { $in: sellerIds },
    enabled: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  }).lean();

const page = (filter, { skip, limit }) =>
  Promise.all([
    SellerOffer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    SellerOffer.countDocuments(filter),
  ]);

const create = (fields) => SellerOffer.create(fields);
const findOwn = (id, sellerId) => SellerOffer.findOne({ _id: id, seller: sellerId });
const deleteOwn = (id, sellerId) => SellerOffer.deleteOne({ _id: id, seller: sellerId });

const productSummaries = (ids, sellerId) =>
  Product.find({ _id: { $in: ids }, seller: sellerId })
    .select('_id name slug images')
    .lean();
const catalogSize = (sellerId) => Product.countDocuments({ seller: sellerId });
const countOwnedProducts = (ids, sellerId) => Product.countDocuments({ _id: { $in: ids }, seller: sellerId });

module.exports = {
  liveForSellers,
  page,
  create,
  findOwn,
  deleteOwn,
  productSummaries,
  catalogSize,
  countOwnedProducts,
};
