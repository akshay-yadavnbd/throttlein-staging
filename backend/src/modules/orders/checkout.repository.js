/**
 * Cart and CheckoutIntent persistence for the checkout flow.
 */
const Cart = require('../customers/cart.model');
const CheckoutIntent = require('./checkout-intent.model');

/* ── cart ─────────────────────────────────────────────────────────────── */

/**
 * The cart with everything pricing needs populated.
 * @returns {Promise<any>} populated: the checker cannot follow populate()
 */
const loadCartForCheckout = (userId) =>
  Cart.findOne({ user: userId }).populate({
    path: 'items.product',
    populate: [
      { path: 'brand', select: 'name' },
      { path: 'category', select: 'name' },
      { path: 'seller', select: 'status kyc.status codEnabled codCharge' },
    ],
  });

const cartForUser = (userId) => Cart.findOne({ user: userId });

/** Lower one cart line by the purchased quantity, only if it still reads what we saw. */
const setCartLineQuantity = (cartId, line, quantity) =>
  Cart.updateOne(
    { _id: cartId, items: { $elemMatch: { _id: line._id, quantity: line.quantity } } },
    { $set: { 'items.$.quantity': quantity } },
  );
const pullCartLine = (cartId, line) =>
  Cart.updateOne({ _id: cartId }, { $pull: { items: { _id: line._id, quantity: line.quantity } } });

/* ── checkout intents (audit A02/A06) ─────────────────────────────────── */

const createIntent = (doc) => CheckoutIntent.create(doc);
const deleteIntent = (id) => CheckoutIntent.deleteOne({ _id: id });
const findIntentById = (id) => CheckoutIntent.findById(id);
const findIntentByRazorpayOrder = (razorpayOrderId) => CheckoutIntent.findOne({ razorpayOrderId });

/**
 * Atomic pending→finalizing claim, so the browser verify call and the
 * payment.captured webhook can race safely: one finalizes, the other gets
 * the completed intent's order back. A stale claim (> 5 min) is retaken.
 */
const claimIntentForFinalize = (intentId) =>
  CheckoutIntent.findOneAndUpdate(
    {
      _id: intentId,
      $or: [
        { status: 'pending' },
        { status: 'finalizing', finalizingAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } },
        { status: 'finalizing', finalizingAt: { $exists: false } },
      ],
    },
    { $set: { status: 'finalizing', finalizingAt: new Date() }, $unset: { expiresAt: 1 } },
    { returnDocument: 'after' },
  );

/** Release a claim so a retry (or the webhook) can finalize later. */
const releaseIntentClaim = (intentId) =>
  CheckoutIntent.updateOne({ _id: intentId, status: 'finalizing' }, { $set: { status: 'pending' } });

module.exports = {
  loadCartForCheckout,
  cartForUser,
  setCartLineQuantity,
  pullCartLine,
  createIntent,
  deleteIntent,
  findIntentById,
  findIntentByRazorpayOrder,
  claimIntentForFinalize,
  releaseIntentClaim,
};
