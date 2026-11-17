/** Every Product query the admin module makes (counts, moderation). Statements only. */
const mongoose = require('mongoose');
const Product = require('../products/product.model');

const count = (filter = {}) => Product.countDocuments(filter);
const recent = () =>
  Product.find({})
    .sort({ createdAt: -1 })
    .limit(5)
    .populate('seller', 'name storeName')
    .populate('category', 'name')
    .select('name price stock status images seller category createdAt');
const createdSince = (since) => Product.find({ createdAt: { $gte: since } }).select('createdAt');

/** One seller's catalogue with its names resolved, newest first. */
const forSeller = (sellerId) =>
  Product.find({ seller: sellerId }).populate('category', 'name').populate('brand', 'name').sort({ createdAt: -1 });
/** `{ total, active, outOfStock, featured }` for one seller. */
async function sellerCounts(sellerId) {
  const [total, active, outOfStock, featured] = await Promise.all([
    Product.countDocuments({ seller: sellerId }),
    Product.countDocuments({ seller: sellerId, status: 'active' }),
    Product.countDocuments({ seller: sellerId, stock: 0 }),
    Product.countDocuments({ seller: sellerId, isFeatured: true }),
  ]);
  return { total, active, outOfStock, featured };
}

/** Moderation list page with seller / category / brand names. */
const page = (filter, { skip, limit }) =>
  Promise.all([
    Product.find(filter)
      .populate('seller', 'name email storeName')
      .populate('category', 'name')
      .populate('brand', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Product.countDocuments(filter),
  ]);

/** Apply `updates` to a product addressed by ObjectId or slug; the updated document or null. */
const updateByIdOrSlug = (idOrSlug, updates) => {
  const filter = mongoose.isValidObjectId(idOrSlug) ? { _id: idOrSlug } : { slug: String(idOrSlug).toLowerCase() };
  return Product.findOneAndUpdate(filter, updates, { returnDocument: 'after' });
};
const deleteBySeller = (sellerId) => Product.deleteMany({ seller: sellerId });

module.exports = { count, recent, createdSince, forSeller, sellerCounts, page, updateByIdOrSlug, deleteBySeller };
