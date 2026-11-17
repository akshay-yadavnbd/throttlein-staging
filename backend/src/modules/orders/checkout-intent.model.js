/**
 * CheckoutIntent — the immutable snapshot a payment is verified against
 * (audit A02 / A06 / A07).
 *
 * Before this model, `/razorpay/verify` rebuilt the order from whatever the
 * customer's CART contained at verification time and never compared the
 * payment's amount to anything: a correctly-signed ₹100 payment could fund
 * a ₹50,000 cart, and a payment whose browser callback never arrived left
 * captured money with no local order.
 *
 * Now `/razorpay/init` persists this snapshot FIRST — exact line items with
 * resolved variant/offer unit prices, address, totals, amount in paise and
 * the provider order id — and both the browser verify call and the
 * `payment.captured` webhook finalize FROM THE SNAPSHOT, never from the
 * live cart. `status` acts as the idempotency/claim latch:
 *
 *   pending → finalizing → completed
 *                       ↘  (finalize error) → pending   (retryable)
 *
 * The claim transition (pending → finalizing) is a findOneAndUpdate, so a
 * browser verify racing the webhook can't both finalize.
 *
 * All provider snapshots are retained: a late capture must remain
 * recoverable even if its browser callback never arrived.
 */
const mongoose = require('mongoose');

const intentItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '' },
    image: { type: String, default: '' },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    brand: { type: String, default: '' },
    category: { type: String, default: '' },
    size: { type: String, default: '' },
    color: { type: String, default: '' },
    /** Resolved unit price actually charged (variant override − offer). */
    price: { type: Number, required: true, min: 0 },
    mrp: { type: Number, default: 0 },
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true, min: 0 },
    /** GST slab + HSN frozen at quote time (carried onto the order line). */
    gstRate: { type: Number },
    hsn: { type: String, default: '' },
    codAvailable: { type: Boolean, default: true },
    /** Seller return/exchange windows frozen at quote time (audit A19) —
     *  carried through to the order line so the policy the customer
     *  bought under is the policy that governs the return. */
    returnPolicyDays: { type: Number },
    exchangePolicyDays: { type: Number },
    /** Applied offer (if any) — audit trail for the charged discount. */
    offer: {
      _id: { type: mongoose.Schema.Types.ObjectId },
      title: { type: String, default: '' },
      savings: { type: Number, default: 0 },
    },
  },
  { _id: false },
);

const checkoutIntentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    shippingAddress: {
      label: { type: String, default: '' },
      fullName: { type: String, default: '' },
      phone: { type: String, default: '' },
      line1: { type: String, default: '' },
      line2: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      pincode: { type: String, default: '' },
      country: { type: String, default: 'India' },
    },

    items: { type: [intentItemSchema], required: true },

    itemsTotal: { type: Number, required: true },
    shippingFee: { type: Number, required: true },
    /** The courier the customer picked per seller, at the rate quoted when
     *  they paid — replayed onto the order so the parcel ships with what
     *  was charged for, even if Shiprocket's rate moves in between. */
    deliverySelections: [
      {
        sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        courierId: { type: Number },
        courierName: { type: String, default: '' },
        rate: { type: Number, default: 0 },
        etd: { type: String, default: '' },
        chosen: { type: Boolean, default: false },
      },
    ],
    /** Prepaid total in rupees — items + shipping (no COD fee online). */
    total: { type: Number, required: true },
    /** EXACT amount sent to the provider, in paise. Verification compares
     *  the captured payment against this, never against a recomputation. */
    amountPaise: { type: Number, required: true },
    currency: { type: String, default: 'INR' },

    notes: { type: String, default: '' },

    /** Provider order id — the join key for verify calls and webhooks. */
    razorpayOrderId: { type: String, default: '' },

    finalizingAt: { type: Date },
    status: {
      type: String,
      enum: ['pending', 'finalizing', 'completed', 'expired'],
      default: 'pending',
      index: true,
    },

    /** The order created from this intent (set on completion). */
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },

    /** Legacy field; startup removes the old TTL index and values. */
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

// One intent per provider order. Partial: only rows that actually carry an
// id participate (razorpayOrderId is set right after provider creation).
checkoutIntentSchema.index(
  { razorpayOrderId: 1 },
  { unique: true, partialFilterExpression: { razorpayOrderId: { $gt: '' } } },
);
module.exports = mongoose.model('CheckoutIntent', checkoutIntentSchema);
