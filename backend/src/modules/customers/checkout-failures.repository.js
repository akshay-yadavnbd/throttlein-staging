/** Checkout failure events (the admin feed) and the checkout ownership check browser reports need. */
const CheckoutFailure = require('./checkout-failure.model');
const CheckoutIntent = require('../orders/checkout-intent.model');

const create = (fields) => CheckoutFailure.create(fields);

const page = (filter, { skip, limit }) =>
  Promise.all([
    CheckoutFailure.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email')
      .lean(),
    CheckoutFailure.countDocuments(filter),
  ]);

const checkoutBelongsTo = (razorpayOrderId, userId) => CheckoutIntent.exists({ razorpayOrderId, user: userId });

module.exports = { create, page, checkoutBelongsTo };
