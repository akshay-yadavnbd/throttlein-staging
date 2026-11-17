/** A seller's own media library rows, and the product lookups that decide whether a file is still in use. Always seller-scoped. */
const SellerMedia = require('./seller-media.model');
const Product = require('../products/product.model');

/** Where a product can reference a media key. */
const REFERENCING = (keys) => ({
  $or: [{ images: { $in: keys } }, { 'colorImages.images': { $in: keys } }, { sizeChartImage: { $in: keys } }],
});

const page = (filter, { skip, limit }) =>
  Promise.all([
    SellerMedia.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    SellerMedia.countDocuments(filter),
  ]);

/** Every folder the seller has, so the picker's dropdown does not shrink while a filter is on. */
const folders = (sellerId) => SellerMedia.distinct('folder', { seller: sellerId });

/** Upsert by (seller, key): a re-run upload of the same key does not trip the unique index. */
const record = (sellerId, key, doc) =>
  SellerMedia.findOneAndUpdate(
    { seller: sellerId, key },
    { $setOnInsert: doc },
    { upsert: true, returnDocument: 'after' },
  );

const findOwn = (id, sellerId) => SellerMedia.findOne({ _id: id, seller: sellerId });
const findOwnMany = (ids, sellerId) => SellerMedia.find({ seller: sellerId, _id: { $in: ids } });
const deleteOwnMany = (ids, sellerId) => SellerMedia.deleteMany({ seller: sellerId, _id: { $in: ids } });
const ownsKey = (sellerId, key) => SellerMedia.findOne({ seller: sellerId, key }).select('_id');

/** The seller's products that reference any of `keys`, with the fields that hold them. */
const productsUsing = (sellerId, keys) =>
  Product.find({ seller: sellerId, ...REFERENCING(keys) })
    .select('_id name slug images colorImages sizeChartImage')
    .lean();

const productUsingKey = (sellerId, key) =>
  Product.findOne({
    seller: sellerId,
    $or: [{ images: key }, { 'colorImages.images': key }, { sizeChartImage: key }],
  }).select('_id');

module.exports = {
  page,
  folders,
  record,
  findOwn,
  findOwnMany,
  deleteOwnMany,
  ownsKey,
  productsUsing,
  productUsingKey,
};
