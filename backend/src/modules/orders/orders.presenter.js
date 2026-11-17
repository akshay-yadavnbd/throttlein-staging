/**
 * Response shapes. Everything a seller or admin screen reads is built here
 * from scratch, so a payload never carries more than its reader needs.
 */
const { payoutMath: payouts } = require('../payouts');
const { SLICE_SHIPPED_SET, forwardSliceFor } = require('./order-state');

/**
 * Delivery address as a SELLER may see it: name and address only.
 *
 * A seller needs to know where a parcel goes; they don't need the buyer's
 * phone number or email to fulfil one, because we pass the contact details
 * straight to the carrier when the shipment is created. Applied in the
 * RESPONSE, not in the UI — hiding a field client-side still ships it over
 * the wire. Used by every seller-facing payload that carries an address.
 */
function sellerSafeAddress(addr) {
  if (!addr) return undefined;
  const a = typeof addr.toObject === 'function' ? addr.toObject() : addr;
  return {
    label: a.label,
    fullName: a.fullName,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    country: a.country,
  };
}

/**
 * Explicit seller-facing DTO (audit A21): only what this seller needs to
 * fulfil their own slice — no other sellers' items or shipments, no
 * customer payout details, no payment id or signature.
 */
function sellerOrderDto(orderDoc, sellerId) {
  const o = typeof orderDoc.toObject === 'function' ? orderDoc.toObject() : orderDoc;
  const sid = String(sellerId);
  const myItems = (o.items || []).filter((i) => i.seller && String(i.seller) === sid);
  const myItemsSubtotal = myItems.reduce((s, i) => s + (i.subtotal || 0), 0);
  const ownShipment = forwardSliceFor(o, sid);
  const ownStatus =
    o.status === 'cancelled'
      ? 'cancelled'
      : ownShipment?.status === 'delivered'
        ? 'delivered'
        : ownShipment?.status === 'cancelled'
          ? 'cancelled'
          : SLICE_SHIPPED_SET.has(ownShipment?.status)
            ? 'shipped'
            : ownShipment?.confirmedAt
              ? 'confirmed'
              : 'placed';
  return {
    _id: o._id,
    orderNumber: o.orderNumber,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    // Aggregate lifecycle state — context for the seller's own slice.
    status: ownStatus,
    overallStatus: o.status,
    fulfillmentHold: o.fulfillmentHold || '',
    confirmedAt: ownShipment?.confirmedAt,
    shippedAt: ownShipment?.pickedUpAt,
    deliveredAt: ownShipment?.deliveredAt,
    cancelledAt: o.cancelledAt,
    // How the customer paid, WITHOUT the payment id, signature or instrument.
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    shippingAddress: sellerSafeAddress(o.shippingAddress),
    items: myItems,
    myItemsSubtotal,
    /** What this parcel earns the seller — item total minus courier and
     *  gateway charges (modules/payouts payout-math). Null before a parcel exists. */
    earnings: payouts.sellerLine(o, sid),
    // Only this seller's shipments (forward, return and replacement legs).
    sellerShipments: (o.sellerShipments || []).filter((s) => String(s.seller) === sid),
    // Only this seller's requests, and without the customer's payout
    // destination — that's the admin's to see when issuing the refund.
    returnRequests: (o.returnRequests || [])
      .filter((r) => String(r.seller) === sid)
      .map((r) => {
        const {
          customerRefundUpi: _upi,
          customerRefundBankName: _bank,
          customerRefundAccountNo: _account,
          customerRefundIfsc: _ifsc,
          ...safe
        } = r;
        return safe;
      }),
  };
}

const paginationMeta = ({ total, page, limit }) => ({ total, page, limit, pages: Math.ceil(total / limit) });

/** One row of the seller's return-request inbox. */
function sellerReturnRequestRow(order, r) {
  return {
    orderNumber: order.orderNumber,
    customer: order.shippingAddress?.fullName,
    reqId: r._id,
    kind: r.kind,
    status: r.status,
    reason: r.reason,
    reasonCode: r.reasonCode,
    desiredAction: r.desiredAction,
    items: r.items,
    attachments: r.attachments || [],
    requestedAt: r.requestedAt,
    decisionAt: r.decisionAt,
    decisionReason: r.decisionReason,
  };
}

/** Full seller-side detail of one request — name + address only (sellerSafeAddress). */
function sellerReturnRequestDetail(order, r) {
  return { ...sellerReturnRequestRow(order, r), shippingAddress: sellerSafeAddress(order.shippingAddress) };
}

function verificationOf(order, r) {
  const ret = (order.sellerShipments || []).find((s) => String(s._id) === String(r.returnShipmentEntryId));
  return ret
    ? { verifiedAt: ret.verifiedAt, verifiedOk: ret.verifiedOk, verificationNotes: ret.verificationNotes }
    : null;
}

/** Admin refund-queue row. Admin sees the customer's payout destination; that is the point of the queue. */
function refundQueueRow(order, r, sellerById) {
  return {
    seller: r.seller ? sellerById[String(r.seller)] || null : null,
    reason: r.reason || '',
    refundNotes: r.refundNotes || '',
    orderNumber: order.orderNumber,
    reqId: r._id,
    kind: r.kind,
    paymentMethod: order.paymentMethod,
    razorpayPaymentId: order.razorpayPaymentId || '',
    refundStatus: r.refundStatus,
    refundMethod: r.refundMethod,
    refundAmount: r.refundAmount,
    refundReference: r.refundReference,
    refundRequestedAt: r.refundRequestedAt,
    refundAttemptAt: r.refundAttemptAt,
    refundCompletedAt: r.refundCompletedAt,
    customer: { name: order.user?.name, email: order.user?.email },
    shippingAddress: order.shippingAddress,
    items: r.items,
    customerRefundUpi: r.customerRefundUpi || '',
    customerRefundBankName: r.customerRefundBankName || '',
    customerRefundAccountNo: r.customerRefundAccountNo || '',
    customerRefundIfsc: r.customerRefundIfsc || '',
    verification: verificationOf(order, r),
  };
}

/** Admin refund detail page. */
function refundRequestDetail(order, r, seller) {
  return {
    orderNumber: order.orderNumber,
    reqId: r._id,
    kind: r.kind,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    total: order.total,
    razorpayPaymentId: order.razorpayPaymentId || '',
    seller: seller
      ? { name: seller.storeName || seller.name, slug: seller.slug, email: seller.email, phone: seller.phone }
      : null,
    customer: order.user ? { name: order.user.name, email: order.user.email, phone: order.user.phone } : null,
    shippingAddress: order.shippingAddress,
    items: r.items,
    attachments: r.attachments,
    reason: r.reason,
    reasonCode: r.reasonCode,
    desiredAction: r.desiredAction,
    refundStatus: r.refundStatus,
    refundMethod: r.refundMethod,
    refundAmount: r.refundAmount,
    refundReference: r.refundReference,
    refundNotes: r.refundNotes,
    refundRequestedAt: r.refundRequestedAt,
    refundAttemptAt: r.refundAttemptAt,
    refundCompletedAt: r.refundCompletedAt,
    customerRefundUpi: r.customerRefundUpi,
    customerRefundBankName: r.customerRefundBankName,
    customerRefundAccountNo: r.customerRefundAccountNo,
    customerRefundIfsc: r.customerRefundIfsc,
    verification: verificationOf(order, r),
  };
}

/** Shiprocket tracking payload → what the seller / customer timeline renders. */
function trackingDto(data, entry) {
  const td = data?.tracking_data || {};
  const lastScan = (td.shipment_track || [])[0] || {};
  return {
    ok: true,
    // Human-readable label (e.g. "In Transit") + numeric id (6).
    currentStatus: lastScan.current_status || '',
    currentStatusId: td.shipment_status || lastScan.current_status_id || null,
    // track_status is Shiprocket's higher-level grouping (Delivered/Pending/etc.)
    trackStatus: td.track_status || '',
    etd: lastScan.edd || td.etd || null,
    courier: lastScan.courier_name || entry.awbCourier || '',
    origin: lastScan.origin || '',
    destination: lastScan.destination || '',
    events: (td.shipment_track_activities || []).map((a) => ({
      date: a.date,
      status: a.status,
      activity: a.activity,
      location: a.location,
    })),
  };
}

/** Shiprocket serviceability → courier picker rows. */
function courierOptions(data) {
  return (data?.data?.available_courier_companies || []).map((c) => ({
    id: c.courier_company_id,
    name: c.courier_name,
    rate: c.rate,
    codCharges: c.cod_charges || 0,
    etd: c.etd || `${c.estimated_delivery_days || ''} days`,
    rating: c.rating,
    recommended: c.courier_company_id === data?.data?.recommended_by?.id,
  }));
}

module.exports = {
  sellerSafeAddress,
  sellerOrderDto,
  paginationMeta,
  sellerReturnRequestRow,
  sellerReturnRequestDetail,
  refundQueueRow,
  refundRequestDetail,
  trackingDto,
  courierOptions,
};
