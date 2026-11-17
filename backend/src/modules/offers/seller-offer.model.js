/**
 * SellerOffer — auto-applied product discount owned by one seller.
 *
 * Sellers create these in the Offers / Discounts tab of the seller
 * dashboard. When active, the storefront (phase 2) will apply the
 * discount automatically to any product the offer targets — no coupon
 * code needed. Shoppers see the reduced price on product cards + PDPs.
 *
 * Scope rules:
 *   - `scope: 'all'`      → applies to every product this seller owns.
 *                           `products[]` is ignored.
 *   - `scope: 'selected'` → applies only to the products listed in
 *                           `products[]`. Empty array = no products
 *                           get the discount (harmless — the offer
 *                           simply matches nothing).
 *
 * Validity:
 *   - `startsAt` null → the offer applies immediately on save.
 *   - `endsAt`   null → the offer never expires until the seller
 *                       disables it manually.
 *   - Both null       → an evergreen deal that runs until toggled off.
 *
 * Toggling `enabled = false` temporarily suspends the offer without
 * deleting it — useful for pausing a Diwali sale mid-run.
 *
 * The optional `maxDiscount` cap only applies to percent-type offers
 * (e.g. "20% off, max ₹500"). `minCartAmount` is honoured at checkout
 * (phase 2) — for now it's stored so the seller's intent survives.
 */
const mongoose = require('mongoose');

const sellerOfferSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 500 },

    discountType: {
      type: String,
      enum: ['percent', 'flat'],
      required: true,
      default: 'percent',
    },
    discountValue: { type: Number, required: true, min: 0 },
    maxDiscount: { type: Number, default: null, min: 0 }, // cap for percent-type
    minCartAmount: { type: Number, default: null, min: 0 },

    scope: {
      type: String,
      enum: ['all', 'selected'],
      required: true,
      default: 'all',
    },
    // Only meaningful when scope === 'selected'. Kept as ObjectIds for
    // referential integrity; UI populates product names on read.
    products: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
      default: [],
    },

    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },

    enabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Newest first for the seller's list view.
sellerOfferSchema.index({ seller: 1, createdAt: -1 });
// Used by the phase-2 storefront when filtering "live" offers for a product.
sellerOfferSchema.index({ seller: 1, enabled: 1, startsAt: 1, endsAt: 1 });

/**
 * Convenience virtual — the offer is "live" when enabled and (if
 * dates are set) the current time falls between them. Phase 2 will
 * use this to decide whether to apply the discount at read time.
 */
sellerOfferSchema.virtual('isLive').get(function isLive() {
  if (!this.enabled) return false;
  const now = Date.now();
  if (this.startsAt && now < this.startsAt.getTime()) return false;
  if (this.endsAt && now > this.endsAt.getTime()) return false;
  return true;
});

sellerOfferSchema.set('toJSON', { virtuals: true });
sellerOfferSchema.set('toObject', { virtuals: true });

// Validation guard — clamp percent-type values to a sane 0-100 range.
sellerOfferSchema.pre('validate', function clampPercent() {
  if (this.discountType === 'percent' && this.discountValue > 100) {
    this.discountValue = 100;
  }
  if (this.startsAt && this.endsAt && this.startsAt.getTime() > this.endsAt.getTime()) {
    throw new Error('startsAt must be earlier than endsAt.');
  }
});

module.exports = mongoose.model('SellerOffer', sellerOfferSchema);
