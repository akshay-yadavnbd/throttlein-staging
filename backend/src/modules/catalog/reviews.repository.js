/** Review queries, and the order / product lookups that gate and frame them. */
const Review = require('./review.model');
const Order = require('../orders/order.model');
const Product = require('../products/product.model');

/** A delivered order of this customer containing the product (optionally a specific order). */
const deliveredOrderWith = (customerId, productId, orderId) =>
  Order.findOne({
    user: customerId,
    status: 'delivered',
    'items.product': productId,
    ...(orderId ? { _id: orderId } : {}),
  }).select('_id');

const customerOrderItems = (orderId, customerId) =>
  Order.findOne({ _id: orderId, user: customerId }).select('items.product');

/** One review per (product, customer): insert or replace in place. */
const upsert = (productId, customerId, update) =>
  Review.findOneAndUpdate({ product: productId, customer: customerId }, update, {
    upsert: true,
    returnDocument: 'after',
    setDefaultsOnInsert: true,
  });

/** findOneAndUpdate skips `save` middleware, so the product's rating / count are recomputed explicitly. */
const recomputeProductAggregates = (productId) => Review.recomputeProductAggregates(productId);

const byCustomerForProducts = (customerId, productIds) =>
  Review.find({ customer: customerId, product: { $in: productIds } }).select(
    'product rating title comment createdAt updatedAt',
  );

const byCustomerForProduct = (customerId, productId) =>
  Review.findOne({ product: productId, customer: customerId }).select('rating title comment createdAt updatedAt');

const productBySlug = (slug) => Product.findOne({ slug }).select('_id rating reviewsCount');

/** Newest first, capped at 500 so the rating distribution stays exact without paging. */
const publicForProduct = (productId) =>
  Review.find({ product: productId }).sort({ createdAt: -1 }).limit(500).populate('customer', 'name').lean();

/** The model's findOneAndDelete hook recomputes the product aggregates. */
const deleteOwn = (productId, customerId) => Review.findOneAndDelete({ product: productId, customer: customerId });

module.exports = {
  deliveredOrderWith,
  customerOrderItems,
  upsert,
  recomputeProductAggregates,
  byCustomerForProducts,
  byCustomerForProduct,
  productBySlug,
  publicForProduct,
  deleteOwn,
};
