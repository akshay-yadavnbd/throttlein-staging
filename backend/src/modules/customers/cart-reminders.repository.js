/**
 * Abandoned-cart reminder queries. Every cart write here passes
 * `timestamps: false`: the admin "inactive for 24h" filter reads
 * `updatedAt`, so the worker must never make a cart look freshly touched.
 */
const Cart = require('./cart.model');
const Order = require('../orders/order.model');
const User = require('../../models/User');

/** Claim the next due cart by pushing its slot out by `leaseMs`, so other workers skip it meanwhile. */
const claimNextDue = (now, leaseMs) =>
  Cart.findOneAndUpdate(
    { reminderNextAt: { $lte: now }, 'items.0': { $exists: true } },
    { $set: { reminderNextAt: new Date(now.getTime() + leaseMs) } },
    { sort: { reminderNextAt: 1 }, returnDocument: 'after', timestamps: false },
  );

/** Write back only if the shopper hasn't edited the bag since it was claimed. */
const finish = (cart, update) =>
  Cart.updateOne({ _id: cart._id, lastActivityAt: cart.lastActivityAt }, update, { timestamps: false });

const recipient = (userId) => User.findById(userId).select('name email role status cartRemindersOptOut').lean();

const orderedSince = (userId, since) => Order.exists({ user: userId, createdAt: { $gte: since } });

const populateForEmail = (cart) =>
  cart.populate({
    path: 'items.product',
    select: 'name slug price images stock variants status seller',
    populate: { path: 'seller', select: 'status kyc.status' },
  });

/** Unsubscribe: the user opts out and any pending reminder is cancelled. */
async function optOut(userId) {
  await User.updateOne({ _id: userId }, { $set: { cartRemindersOptOut: true, cartRemindersOptOutAt: new Date() } });
  await Cart.updateOne({ user: userId }, { $set: { reminderNextAt: null } }, { timestamps: false });
}

module.exports = { claimNextDue, finish, recipient, orderedSince, populateForEmail, optOut };
