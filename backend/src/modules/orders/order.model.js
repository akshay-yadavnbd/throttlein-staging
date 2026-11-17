const mongoose = require('mongoose');
const sellerShipmentFields = require('./seller-shipment.fields');
const returnRequestFields = require('./return-request.fields');

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // soft ref — product may be deleted later
    name: { type: String, required: true }, // snapshot
    image: { type: String, default: '' }, // snapshot
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    brand: { type: String, default: '' },
    category: { type: String, default: '' },
    size: { type: String, default: '' },
    // Variant color snapshot — populated from cart when the customer
    // picked a coloured variant. Preserved on the order so the seller
    // dashboard can render "Size S · Colour Blue" on the fulfillment
    // page, and so the checkout stock decrement can target the right
    // variants[] row on the Product doc.
    color: { type: String, default: '' },
    price: { type: Number, required: true }, // unit price at purchase time
    mrp: { type: Number },
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true }, // price * qty
    /** GST slab included in `price`, and the HSN code, as they were at
     *  purchase — the tax invoice reads these, so editing the product later
     *  can't rewrite an issued invoice. Absent on older lines (the invoice
     *  falls back to the product's current rate). */
    gstRate: { type: Number },
    hsn: { type: String, default: '' },

    /* ── Audit A19 ──────────────────────────────────────────────────────
     * Returns used to be matched by PRODUCT id alone, so returning one
     * size could select every line of that product, restore the wrong
     * variant and compute the wrong refund. Lines now carry their own
     * `_id` (see the schema options below) and these snapshots:
     *
     * `returnedQuantity` — units of THIS line already returned, so a
     * second request can't exceed what was purchased.
     * `returnPolicyDays` / `exchangePolicyDays` — the seller's policy AS
     * IT WAS at purchase. Reading the seller's CURRENT settings let a
     * seller retroactively remove a window the customer bought under. */
    returnedQuantity: { type: Number, default: 0, min: 0 },
    returnPolicyDays: { type: Number },
    exchangePolicyDays: { type: Number },
  },
  // `_id: true` (the default) — every order line gets a stable identifier
  // that return requests reference. Lines written before this change have
  // none; Mongoose assigns one the next time the order is saved, and the
  // return flow falls back to product+size+colour matching for them.
);

const shippingAddressSchema = new mongoose.Schema(
  {
    label: String,
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    country: { type: String, default: 'India' },
  },
  { _id: false },
);

/** Merge into a people-facing query (`{ ...filter, ...Order.NOT_ARCHIVED }`)
 *  so archived orders stay out of lists. `null` also matches a missing field. */
const NOT_ARCHIVED = Object.freeze({ archivedAt: null });

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderNumber: { type: String, unique: true, index: true }, // e.g. TIN-2026-000123
    items: { type: [orderItemSchema], required: true },
    shippingAddress: { type: shippingAddressSchema, required: true },

    itemsTotal: { type: Number, required: true },
    /** Delivery charged to the customer — the sum of `delivery[].amount`.
     *  Sellers who absorb delivery contribute ₹0, which is why an order
     *  can total exactly its items. */
    shippingFee: { type: Number, default: 0 },

    /** What the customer paid for delivery, per seller, and the courier
     *  they picked — written at order creation from a server-side
     *  Shiprocket quote, so it survives a failed push and a rate change.
     *  Only sellers with `deliveryPaidByCustomer` appear here; the rest
     *  absorb the courier's bill in their weekly settlement.
     *
     *  Read by: the Shiprocket push (books this courier), the settlement
     *  (adds `amount` back so it cancels the courier's bill), and the
     *  order pages (shows the customer what they paid and to whom). */
    delivery: [
      {
        seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        amount: { type: Number, default: 0 },
        courierId: { type: Number },
        courierName: { type: String, default: '' },
        etd: { type: String, default: '' },
        /** false = the customer left it on the cheapest option. */
        chosen: { type: Boolean, default: false },
        quotedAt: { type: Date },
      },
    ],
    total: { type: Number, required: true },

    paymentMethod: {
      type: String,
      enum: ['cod', 'online'],
      default: 'cod',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },

    /**
     * Razorpay reconciliation fields. Only populated for paymentMethod=online.
     *   razorpayOrderId    — Razorpay's order id, created before checkout
     *   razorpayPaymentId  — set on successful capture
     *   razorpaySignature  — the checkout signature we verified
     *   paidAt             — set when paymentStatus flips to 'paid'
     *   refundedAt         — set on refund webhook / manual refund call
     *   refundIds[]        — list of refund ids if multiple partials
     */
    razorpayOrderId: { type: String, default: '', index: true },
    razorpayPaymentId: { type: String, default: '' },
    razorpaySignature: { type: String, default: '' },

    /** The CheckoutIntent this order was finalized from (online orders
     *  created after audit fix A02). Ties the charge to its immutable
     *  quote for reconciliation. */
    checkoutIntent: { type: mongoose.Schema.Types.ObjectId, ref: 'CheckoutIntent' },
    /** Client-supplied idempotency key for COD creation (audit A07);
     *  '' on orders that predate it. Unique via partial index below. */
    idempotencyKey: { type: String, default: '' },
    /** COD convenience fee actually included in `total` (audit A11) —
     *  previously folded in invisibly, so shipment charge breakdowns
     *  couldn't reconcile against the customer's payable amount. */
    codFee: { type: Number, default: 0 },
    /** What Razorpay charged us for the capture (seller payouts): `fee`
     *  already includes `tax` (GST). Rupees, read from the payment entity
     *  at capture; backfilled for older orders by scripts/backfill-gateway-fees.js.
     *  Split across sellers by their item share when the payout is computed. */
    gatewayFee: {
      fee: { type: Number },
      tax: { type: Number },
      total: { type: Number },
      source: { type: String, default: '' }, // razorpay
      capturedAt: { type: Date },
    },
    /** Set once when a cancellation returns this order's units to stock
     *  (audit A16). Guards against a repeated cancel call inflating
     *  inventory, and records when the movement happened. */
    stockRestoredAt: { type: Date },
    inventoryReserved: { type: Boolean },
    fulfillmentHold: { type: String, default: '' },
    // Durable dispatch intent is saved in the same transaction as the order.
    shippingPushPending: { type: Boolean, default: true },
    shippingPushNextAt: { type: Date, default: Date.now },
    trackingNextAt: { type: Date, default: Date.now },
    trackingLastError: { type: String, default: '' },
    fulfillmentLockToken: { type: String, select: false },
    fulfillmentLockUntil: { type: Date, select: false },
    stockReservations: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        quantity: Number,
        size: String,
        color: String,
        variantApplied: Boolean,
      },
    ],

    /**
     * What the customer actually paid WITH, read back from Razorpay
     * after capture (infrastructure/payments/razorpay.js → describePayment).
     *
     * `paymentMethod` above stays 'cod' | 'online' — it's the business
     * distinction the whole codebase branches on (COD gating, refund
     * routing) and changing its enum would ripple everywhere. This is
     * the instrument detail underneath: 'online' + method 'emi' means
     * an EMI purchase, and `emi.tenureMonths` / `emi.issuer` say which
     * bank is billing the customer and for how long.
     *
     * All optional — a payment captured before this field existed, or
     * one Razorpay can't be re-fetched for, simply has none.
     */
    paymentInstrument: {
      method: { type: String, default: '' }, // card | upi | netbanking | wallet | emi
      bank: { type: String, default: '' },
      wallet: { type: String, default: '' },
      vpa: { type: String, default: '' },
      cardLast4: { type: String, default: '' },
      cardNetwork: { type: String, default: '' },
      emi: {
        tenureMonths: { type: Number, default: 0 },
        interestRate: { type: Number, default: 0 },
        issuer: { type: String, default: '' },
      },
    },

    paidAt: { type: Date },
    refundedAt: { type: Date },
    refundIds: [{ type: String }],
    status: {
      type: String,
      enum: ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'],
      default: 'placed',
      index: true,
    },
    notes: { type: String, default: '' },
    // Lifecycle timestamps — captured when status transitions so the admin
    // / customer order detail pages can render a real timeline. `createdAt`
    // (provided by { timestamps: true }) serves as the "placed at" marker.
    confirmedAt: { type: Date },
    shippedAt: { type: Date },
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },

    /**
     * Shiprocket bookkeeping — one entry per seller in this order, plus an
     * additional `kind:"return"` entry appended if the customer returns it.
     *
     * Lifecycle (forward leg):
     *   1. Order placed                 → entry created, status = 'queued'
     *   2. Shiprocket order pushed      → status = 'pushed' + ids populated
     *   3. Seller picks courier + ships → AWB assigned + pickup scheduled
     *   4. Webhook updates status / scans live (no polling needed)
     *
     * Lifecycle (return leg, added when seller approves a return request):
     *   Status flows: return_pickup → returned (via webhook).
     *
     * Status enum kept loose (String type) so we don't need a migration every
     * time Shiprocket adds a new courier scan state — only canonical values
     * are produced by our own code; webhook-derived values are normalised in
     * the webhook handler.
     */
    sellerShipments: [sellerShipmentFields],

    /**
     * Customer-initiated return / exchange requests. Workflow:
     *   1. Customer submits via POST /api/account/orders/:id/return-request.
     *      Entry created with status='pending'.
     *   2. Seller sees it on their order detail page, decides:
     *      - approve  → triggers Shiprocket reverse pickup via createReturnOrder
     *                   (appends a kind:"return" entry to sellerShipments and
     *                   flips this request to status='approved').
     *      - decline  → status='declined' + decisionReason captured.
     *   3. Customer sees the resolution on their account/orders detail page.
     *
     * Each request is scoped to ONE seller's slice (multi-seller orders may
     * accumulate independent requests). `items` is a subset of the original
     * order.items entries the customer wants to return.
     */
    returnRequests: [returnRequestFields],

    /* Admin "delete" (archive). An archived order is hidden from every
     * people-facing list — admin orders, dashboards, seller and customer
     * order lists — but kept so it can be restored, and so the money and
     * shipping machinery (payment webhooks, refunds, settlements, tracking)
     * keeps working on it. Filter with Order.NOT_ARCHIVED. */
    archivedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    archiveReason: { type: String, default: '' },
  },
  { timestamps: true, statics: { NOT_ARCHIVED } },
);

/* Feed indexes (audit P2). Both order lists sort by newest-first and
 * filter by owner (customer) or participating seller; without these the
 * paginated queries degrade into collection scans as history grows. */
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ 'items.seller': 1, createdAt: -1 });
orderSchema.index({ shippingPushPending: 1, shippingPushNextAt: 1 });
orderSchema.index({ trackingNextAt: 1 });
orderSchema.index({ archivedAt: 1, createdAt: -1 });

for (const field of ['channelOrderId', 'shiprocketOrderId', 'shipmentId', 'awbCode']) {
  orderSchema.index({ [`sellerShipments.${field}`]: 1 });
}

/* Uniqueness for online payments (audit A07): a Razorpay payment id may
 * fund at most ONE order. The old duplicate guard was a read-before-create
 * race; this index makes the database the referee. Partial so the empty
 * string on COD orders doesn't collide. */
orderSchema.index(
  { razorpayPaymentId: 1 },
  { unique: true, partialFilterExpression: { razorpayPaymentId: { $gt: '' } } },
);
/* COD idempotency (audit A07): the client sends a per-checkout key; a
 * network retry of POST /orders re-sends the same key and gets the same
 * order back instead of creating a second one. */
orderSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $gt: '' } } });

orderSchema.pre('save', async function () {
  if (!this.orderNumber) {
    /* Audit A10: numbers used to come from `countDocuments() + 1`, which
     * two concurrent checkouts could both compute — one insert then failed
     * on the unique orderNumber index (after payment, on the online path),
     * and deletions could reissue a live number. Counter.next() is an
     * atomic $inc; the floor fast-forwards a fresh counter past whatever
     * the legacy scheme already issued. */
    const Counter = require('../../models/Counter');
    const year = new Date().getFullYear();
    const floor = await mongoose.model('Order').countDocuments({});
    const seq = await Counter.next(`order-${year}`, floor);
    this.orderNumber = `TIN-${year}-${String(seq).padStart(6, '0')}`;
  }
});

module.exports = mongoose.model('Order', orderSchema);
