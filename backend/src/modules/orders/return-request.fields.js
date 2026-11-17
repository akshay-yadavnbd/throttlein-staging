/**
 * Fields of one entry in `Order.returnRequests`: a customer return (or a prepaid
 * cancellation's refund obligation) against one seller's items. Embedded as
 * `returnRequests: [returnRequestFields]` in order.model.js (see the comment there).
 */
const mongoose = require('mongoose');

module.exports = {
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  /* 'cancellation' (audit A16) is a refund obligation raised when a
   * PREPAID order is cancelled before dispatch. It reuses this
   * pipeline so the admin refund queue sees it like any other payout
   * — previously a cancelled prepaid order left the customer with no
   * refund record at all. It has no reverse shipment. */
  kind: { type: String, enum: ['return', 'exchange', 'cancellation'], required: true },
  cancellationScope: { type: String, enum: ['seller', 'order'] },
  reason: { type: String, default: '' }, // free text
  reasonCode: { type: String, default: '' }, // e.g. "size-issue" / "damaged" / "wrong-item"
  desiredAction: { type: String, default: '' }, // for exchange — e.g. "replace with size L"
  items: [
    {
      /** The exact order line being returned (audit A19). Older
       *  requests have none — those fall back to product+size+colour. */
      orderItemId: { type: mongoose.Schema.Types.ObjectId },
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      name: { type: String, default: '' },
      size: { type: String, default: '' },
      color: { type: String, default: '' },
      /** Unit price of that line at purchase — refunds compute from the
       *  snapshot rather than re-deriving from a possibly-changed line. */
      price: { type: Number, default: 0 },
      quantity: { type: Number, default: 1 },
    },
  ],
  // Evidence uploaded by the customer when the reason is damage / wrong
  // item / not-as-described. Images render as thumbnails on the seller's
  // review modal; videos as inline players. URLs are proxied via
  // /api/files/<key> just like all our other S3 assets.
  attachments: [
    {
      url: { type: String, required: true },
      kind: { type: String, enum: ['image', 'video'], required: true },
      mimeType: { type: String, default: '' },
      sizeBytes: { type: Number, default: 0 },
    },
  ],
  status: {
    type: String,
    enum: ['pending', 'approved', 'declined', 'completed', 'cancelled'],
    default: 'pending',
  },
  decisionReason: { type: String, default: '' }, // seller's reason on decline
  decisionAt: { type: Date },
  // Once approved, links to the sellerShipments entry that holds the
  // reverse-pickup Shiprocket details (kind="return") so customer can
  // see the AWB / tracking from the same screen. For exchanges, an
  // additional `replacementShipmentEntryId` points to the new outgoing
  // shipment carrying the replacement parcel to the customer.
  returnShipmentEntryId: { type: mongoose.Schema.Types.ObjectId },
  replacementShipmentEntryId: { type: mongoose.Schema.Types.ObjectId },
  /** Set when replacement units were deducted from inventory (audit
   *  A20) — guards a retry from reserving the same units twice. */
  replacementStockReservedAt: { type: Date },
  requestedAt: { type: Date, default: Date.now },

  /**
   * Refund pipeline (only used for kind='return' — exchanges don't have a
   * refund step, the swap itself is the resolution).
   *
   * Lifecycle:
   *   not-requested → requested (seller raises after verify)
   *   requested → processing (admin picks it up)
   *   processing → completed (Razorpay refund / manual transfer done)
   *   processing → failed   (Razorpay refused / admin marks failed)
   *
   * For COD orders, customerRefundUpi is captured from the customer's
   * own return-request submission so admin knows where to transfer the
   * money. For online orders the Razorpay refund API handles it
   * automatically and customerRefundUpi stays empty.
   */
  refundStatus: {
    type: String,
    enum: ['not-requested', 'requested', 'processing', 'completed', 'failed'],
    default: 'not-requested',
  },
  refundMethod: { type: String, enum: ['razorpay', 'manual', ''], default: '' },
  refundReference: { type: String, default: '' }, // razorpay refund id OR UPI tx ref
  refundAttemptId: { type: String, default: '' },
  refundAttemptAt: { type: Date }, // when admin last sent it to the provider
  refundAmount: { type: Number, default: 0 },
  refundNotes: { type: String, default: '' }, // admin's note when processing
  refundRequestedAt: { type: Date },
  refundProcessedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // which admin
  refundCompletedAt: { type: Date },
  // Customer-supplied UPI for COD refunds — captured at request time.
  customerRefundUpi: { type: String, default: '' },
  customerRefundBankName: { type: String, default: '' },
  customerRefundAccountNo: { type: String, default: '' },
  customerRefundIfsc: { type: String, default: '' },
};
