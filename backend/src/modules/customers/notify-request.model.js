const mongoose = require('mongoose');

/**
 * "Notify me when back in stock" request — one per (user, product) pair.
 * Created from the storefront's out-of-stock PDP button. Cleared (deleted)
 * once the restock email has actually been sent, so re-hitting the same
 * out-of-stock product just re-creates it (see wishlist.service notifyWhenInStock).
 */
const notifyRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

// One outstanding request per user+product — re-subscribing just no-ops.
notifyRequestSchema.index({ user: 1, product: 1 }, { unique: true });

module.exports = mongoose.model('NotifyRequest', notifyRequestSchema);
