/**
 * Fields of one entry in `Order.sellerShipments`: a seller's parcel on the order —
 * its Shiprocket ids, AWB, carrier status, charges and invoice. Embedded as
 * `sellerShipments: [sellerShipmentFields]` in order.model.js (see the comment there).
 */
const mongoose = require('mongoose');

module.exports = {
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['forward', 'return'], default: 'forward' },
  returnOf: { type: mongoose.Schema.Types.ObjectId }, // self-ref to the forward entry's _id

  shiprocketOrderId: { type: String, default: '' }, // Shiprocket's own order_id
  shipmentId: { type: String, default: '' }, // Shiprocket shipment_id
  /** OUR external reference sent as Shiprocket's order_id (audit A15) —
   *  e.g. "TIN-2026-000013-A3F7B2[-RTN]". Webhooks match on this
   *  exactly; the old parser assumed the random suffix was a seller
   *  slug and matched nothing. */
  channelOrderId: { type: String, default: '' }, // indexed below with its siblings
  /** Seller acknowledged THIS slice (audit A12) — order-level
   *  confirmed is derived, not written directly by one seller. */
  confirmedAt: { type: Date },
  awbCode: { type: String, default: '' },
  awbCourier: { type: String, default: '' }, // courier name from AWB assignment
  awbCourierId: { type: Number }, // numeric courier_company_id (for logos / preferred-courier)

  /* Pickup booking tracked SEPARATELY from AWB assignment (audit A14):
   * an AWB can be generated while pickup scheduling fails, and the old
   * single `status` field made that look like success — the seller had
   * a label but no courier was ever coming. `pickupBookedAt` set =
   * booked; `pickupError` carries the last scheduling failure. */
  pickupBookedAt: { type: Date },
  pickupError: { type: String, default: '' },
  /** Set when THIS slice's units were returned to stock after a
   *  seller-side shipment cancellation (audit A16). Guards repeats. */
  stockRestoredAt: { type: Date },
  /** Delivery timestamp for THIS slice (audit A12/A19) — order-level
   *  deliveredAt is a multi-seller aggregate and can't anchor
   *  per-seller return windows. */
  deliveredAt: { type: Date },

  status: { type: String, default: 'queued' },

  /** The seller removed this order from their own list. A cancelled
   *  order still has to exist — admin reconciles refunds and disputes
   *  against it, and the customer can still see it — so "delete" on the
   *  seller side is this marker, never a document removal. Only ever
   *  set on a cancelled parcel. */
  sellerHiddenAt: { type: Date },
  pushAttemptedAt: Date,
  statusEventAt: Date,
  trackingSyncedAt: Date,
  lastNdrEventKey: String,
  // queued | pushed | awb | shipped | out_for_delivery | delivered
  // | undelivered | rto_initiated | rto_in_transit | rto_delivered
  // | lost | cancelled | failed | return_pickup | returned

  // Live tracking (populated by webhook)
  currentStatus: { type: String, default: '' }, // human-readable, last scan
  currentStatusId: { type: Number }, // Shiprocket numeric status code
  etd: { type: Date }, // estimated delivery from latest scan
  isReturn: { type: Boolean, default: false }, // mirror of webhook is_return (RTO flag on forward)
  pod: { type: String, default: '' }, // proof of delivery URL when available
  /** What the courier charged US for this parcel (seller payouts).
   *  Captured from Shiprocket's AWB-assign response (`freight_charges`,
   *  `cod_charges`) when the seller ships, or from the serviceability
   *  rate for the chosen courier when the response lacks it; admin can
   *  overwrite it (source 'manual'). Rupees. Absent on shipments made
   *  before this existed — the payout pages say so instead of
   *  silently treating it as ₹0. */
  courierCharge: {
    freight: { type: Number },
    cod: { type: Number },
    total: { type: Number },
    source: { type: String, default: '' }, // shiprocket-awb | shiprocket-rate | manual
    capturedAt: { type: Date },
    note: { type: String, default: '' },
  },
  // Append-only scan log. Capped to 200 entries at the controller level.
  scans: [
    {
      date: { type: Date },
      status: { type: String, default: '' },
      statusId: { type: Number },
      activity: { type: String, default: '' },
      location: { type: String, default: '' },
    },
  ],

  // NDR (Non-Delivery Report) bookkeeping
  ndrCount: { type: Number, default: 0 },
  ndrLastReason: { type: String, default: '' },
  ndrLastAction: { type: String, default: '' }, // re-attempt | return | fake-attempt
  ndrLastActionAt: { type: Date },

  // Seller inspection on receipt of a return / exchange parcel. Used to
  // gate refund processing — admin only sees a refund request after the
  // seller confirms the parcel arrived in returnable condition.
  verifiedAt: { type: Date },
  verificationNotes: { type: String, default: '' },
  verifiedOk: { type: Boolean }, // true = OK, false = rejected (damaged etc.)
  // Timestamp of the DB-level restock triggered by verifiedOk = true.
  // Purely diagnostic — used to correlate "why did stock jump on this
  // day" during ops audits. Absent = restock hasn't happened yet.
  restockedAt: { type: Date },

  // Pickup lifecycle timestamps — populated by the webhook when
  // Shiprocket transitions the shipment through the pickup states.
  // Kept separate from `status` so we can tell "courier scheduled"
  // (pickupScheduledAt set) apart from "courier came" (pickedUpAt
  // set). Undefined = event hasn't fired yet.
  pickupScheduledAt: { type: Date },
  pickedUpAt: { type: Date },

  // Cached document URLs so re-renders don't re-hit Shiprocket every time.
  labelUrl: { type: String, default: '' },
  invoiceUrl: { type: String, default: '' },
  manifestUrl: { type: String, default: '' },

  /** Our own GST tax invoice for this seller's parcel (services/taxInvoice.js).
   *  Numbered once, from the seller's own series, the first time it is
   *  issued; the seller block is frozen then so a later profile edit
   *  can't change an issued invoice. The PDF is re-rendered on demand. */
  taxInvoice: {
    number: { type: String },
    date: { type: Date },
    issuedAt: { type: Date },
    seller: {
      name: { type: String },
      gstin: { type: String },
      address: { type: String },
      state: { type: String },
    },
  },

  pushedAt: { type: Date },
  lastError: { type: String, default: '' },
};
