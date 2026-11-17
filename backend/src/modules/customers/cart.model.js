const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    size: { type: String, default: '' },
    // Selected variant color, when the product uses colour variants.
    // Blank means the shopper didn't pick a colour or the product
    // isn't variant-scoped.
    color: { type: String, default: '' },

    /* What the shopper put in the bag, captured at add time and
     * refreshed on every read while the product still exists. When a
     * seller later deletes the product the ref resolves to null — the
     * bag would otherwise show a blank card with no name or picture.
     * This is display-only: price is NEVER read from here at checkout,
     * which always re-prices from the live product. */
    snapshot: {
      name: { type: String, default: '' },
      image: { type: String, default: '' },
      slug: { type: String, default: '' },
      price: { type: Number, default: 0 },
    },
  },
  { _id: true, timestamps: true },
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    items: { type: [cartItemSchema], default: [] },

    /* Abandoned-cart reminders (modules/customers/cart-reminders.service.js).
     * lastActivityAt — last time the SHOPPER changed the bag (add / qty /
     *   remove / clear). Not bumped by viewing it, unlike updatedAt.
     * reminderStage  — how many reminder slots have been used since then.
     * reminderNextAt — when the worker should look at this cart next;
     *   null = nothing scheduled. Also doubles as the worker's lease. */
    lastActivityAt: { type: Date },
    reminderStage: { type: Number, default: 0 },
    reminderNextAt: { type: Date, default: null },
    reminderLastSentAt: { type: Date },
    reminderSentCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

cartSchema.index({ updatedAt: -1, _id: -1 });
cartSchema.index({ reminderNextAt: 1 }, { partialFilterExpression: { reminderNextAt: { $type: 'date' } } });

module.exports = mongoose.model('Cart', cartSchema);
