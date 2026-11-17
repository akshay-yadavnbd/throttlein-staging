/** The shopper's cart, the product lookups adding to it needs, and the saved address it ships to. */
const mongoose = require('mongoose');
const Cart = require('./cart.model');
const Product = require('../products/product.model');
const User = require('../../models/User');

const findByUser = (userId) => Cart.findOne({ user: userId });
const createForUser = (userId) => Cart.create({ user: userId, items: [] });

/**
 * Fill each line's product with what the cart renders and decides on:
 * the seller's COD and return defaults (COD is hidden if any seller opted
 * out), the per-product COD and return overrides, `variants` (a sold-out
 * SIZE vs a sold-out product) and the seller's approval state (a de-listed
 * seller's line reads as unavailable rather than buyable).
 */
const populateLines = (cart) =>
  cart.populate({
    path: 'items.product',
    select:
      'name slug price mrp images stock sizes variants status brand category seller codAvailable returnPolicyDays exchangePolicyDays',
    populate: [
      { path: 'brand', select: 'name slug' },
      { path: 'category', select: 'name slug' },
      { path: 'seller', select: 'codEnabled codCharge returnPolicyDays exchangePolicyDays status kyc.status' },
    ],
  });

/**
 * A product by id or slug (the storefront passes whichever is in its URL).
 * @param {string} ref
 * @param {{ select?: string, populateSeller?: boolean }} [opts]
 * @returns {Promise<any>} populated: the checker cannot follow populate()
 */
function productByRef(ref, { select, populateSeller = false } = {}) {
  const filter = mongoose.isValidObjectId(ref) ? { _id: ref } : { slug: String(ref).toLowerCase() };
  let query = Product.findOne(filter);
  if (select) query = query.select(select);
  if (populateSeller) query = query.populate('seller', 'status kyc');
  return query;
}

/** What a delivery quote needs of each seller: pickup address, who pays delivery, excluded pincodes / states. */
const QUOTE_SELLER_FIELDS =
  'name storeName slug status kyc.status kyc.pickupAddress deliveryPaidByCustomer excludedPincodes excludedStates';
const quoteSellers = (ids) =>
  User.find({ _id: { $in: ids } })
    .select(QUOTE_SELLER_FIELDS)
    .lean();
const productWeights = (ids) =>
  Product.find({ _id: { $in: ids } })
    .select('weightGrams')
    .lean();

/** The user's saved addresses (subdocuments, so `.id()` works on the result). */
const userWithAddresses = (userId) => User.findById(userId).select('addresses');

module.exports = {
  findByUser,
  createForUser,
  populateLines,
  productByRef,
  userWithAddresses,
  quoteSellers,
  productWeights,
};
