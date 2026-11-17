/**
 * Views for MCP tool output — allow-lists of what leaves the server.
 *
 * Tool results end up in an LLM transcript, a far leakier place than the admin
 * panel, so every record goes through one of these. The admin handlers return
 * raw documents (bank account numbers, Razorpay signatures, OTP hashes), which
 * is why they are not reused.
 *
 * Rules: keep what an operator needs to act (order numbers, statuses, amounts,
 * courier errors); mask contact details unless the connection may reveal them
 * (`view.reveal`, audited); mask what only a payment needs (account numbers,
 * UPI ids, PAN); wrap free text written by customers or sellers as
 * {untrusted: true}; drop what nothing outside the server needs.
 */
'use strict';
const { untrusted, sanitizeText, maskEmail, maskPhone } = require('./output');

const last4 = (value) => {
  const s = String(value || '').replace(/\s+/g, '');
  return s ? `••••${s.slice(-4)}` : null;
};
const maskUpi = (value) => {
  const s = String(value || '');
  const at = s.indexOf('@');
  if (at < 0) return s ? '••••' : null;
  return `${s.slice(0, Math.min(2, at))}••••${s.slice(at)}`;
};
const maskPan = (value) => {
  const s = String(value || '').toUpperCase();
  return s.length === 10 ? `${s.slice(0, 2)}••••••${s.slice(-2)}` : s ? '••••' : null;
};
const id = (value) => (value ? String(value._id || value) : null);
const name = (value) => sanitizeText(value, 200) || null;

const contact = (view, email, phone) => ({
  email: view.reveal ? email || null : maskEmail(email),
  phone: view.reveal ? phone || null : maskPhone(phone),
});

function sellerChip(sellerById, sellerId) {
  const v = sellerById.get(String(sellerId));
  return v
    ? { id: String(v._id), name: name(v.storeName || v.name), slug: v.slug || null }
    : { id: String(sellerId), name: 'Unknown seller', slug: null };
}

function shipmentSummary(s, sellerById) {
  return {
    id: id(s),
    kind: s.kind || 'forward',
    seller: sellerChip(sellerById, s.seller),
    status: s.status,
    courierStatus: untrusted(s.currentStatus, 200),
    awb: s.awbCode || null,
    courier: name(s.awbCourier),
    etd: s.etd || null,
    lastError: untrusted(s.lastError, 500),
    pushedAt: s.pushedAt || null,
    pickupScheduledAt: s.pickupScheduledAt || null,
    pickedUpAt: s.pickedUpAt || null,
    deliveredAt: s.deliveredAt || null,
    ndrCount: s.ndrCount || 0,
  };
}

function returnRequestSummary(r, sellerById) {
  return {
    id: id(r),
    kind: r.kind,
    seller: sellerChip(sellerById, r.seller),
    status: r.status,
    reason: untrusted(r.reason, 500),
    reasonCode: r.reasonCode || null,
    requestedAt: r.requestedAt || null,
    decisionAt: r.decisionAt || null,
    decisionReason: untrusted(r.decisionReason, 500),
    items: (r.items || []).map((it) => ({
      name: name(it.name),
      quantity: it.quantity,
      size: it.size || null,
      color: it.color || null,
    })),
    refund: {
      status: r.refundStatus,
      method: r.refundMethod || null,
      amount: r.refundAmount ?? null,
      reference: r.refundReference || null,
      requestedAt: r.refundRequestedAt || null,
      completedAt: r.refundCompletedAt || null,
      notes: untrusted(r.refundNotes, 500),
      customerUpi: maskUpi(r.customerRefundUpi),
      customerBank: name(r.customerRefundBankName),
      customerAccountLast4: last4(r.customerRefundAccountNo),
      customerIfsc: r.customerRefundIfsc || null,
    },
  };
}

function orderSummary(o, sellerById, view) {
  const sellerIds = [...new Set((o.items || []).map((it) => String(it.seller)).filter(Boolean))];
  return {
    id: id(o),
    orderNumber: o.orderNumber,
    placedAt: o.createdAt,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    total: o.total,
    currency: 'INR',
    customer: o.user ? { name: name(o.user.name), ...contact(view, o.user.email, o.user.phone) } : null,
    sellers: sellerIds.map((s) => sellerChip(sellerById, s).name),
    itemCount: (o.items || []).reduce((n, it) => n + (it.quantity || 0), 0),
    shipments: (o.sellerShipments || []).map((s) => ({
      status: s.status,
      awb: s.awbCode || null,
      courier: name(s.awbCourier),
    })),
    openRefunds: (o.returnRequests || []).filter((r) => ['requested', 'processing'].includes(r.refundStatus)).length,
    deliveredAt: o.deliveredAt || null,
    cancelledAt: o.cancelledAt || null,
  };
}

function orderDetail(o, sellerById, view) {
  const a = o.shippingAddress || {};
  return {
    id: id(o),
    orderNumber: o.orderNumber,
    placedAt: o.createdAt,
    updatedAt: o.updatedAt,
    status: o.status,
    currency: 'INR',
    timeline: {
      confirmedAt: o.confirmedAt || null,
      shippedAt: o.shippedAt || null,
      deliveredAt: o.deliveredAt || null,
      cancelledAt: o.cancelledAt || null,
    },
    customer: o.user ? { id: id(o.user), name: name(o.user.name), ...contact(view, o.user.email, o.user.phone) } : null,
    shippingAddress: {
      fullName: name(a.fullName),
      phone: view.reveal ? a.phone || null : maskPhone(a.phone),
      line1: view.reveal ? sanitizeText(a.line1, 300) : untrusted(a.line1, 300),
      line2: view.reveal ? sanitizeText(a.line2, 300) || null : untrusted(a.line2, 300),
      city: name(a.city),
      state: name(a.state),
      pincode: a.pincode || null,
      country: name(a.country),
    },
    amounts: {
      itemsTotal: o.itemsTotal,
      shippingFee: o.shippingFee,
      codFee: o.codFee ?? null,
      total: o.total,
      gatewayFee: o.gatewayFee?.total ?? null,
    },
    payment: {
      method: o.paymentMethod,
      status: o.paymentStatus,
      paidAt: o.paidAt || null,
      refundedAt: o.refundedAt || null,
      razorpayOrderId: o.razorpayOrderId || null,
      razorpayPaymentId: o.razorpayPaymentId || null,
      instrument: o.paymentInstrument
        ? {
            method: o.paymentInstrument.method || null,
            bank: name(o.paymentInstrument.bank),
            wallet: name(o.paymentInstrument.wallet),
            cardLast4: o.paymentInstrument.cardLast4 || null,
            cardNetwork: o.paymentInstrument.cardNetwork || null,
          }
        : null,
      refundIds: o.refundIds || [],
    },
    items: (o.items || []).map((it) => ({
      product: id(it.product),
      name: name(it.name),
      seller: sellerChip(sellerById, it.seller),
      brand: name(it.brand),
      category: name(it.category),
      size: it.size || null,
      color: it.color || null,
      price: it.price,
      mrp: it.mrp ?? null,
      quantity: it.quantity,
      subtotal: it.subtotal,
      returnedQuantity: it.returnedQuantity || 0,
    })),
    delivery: (o.delivery || []).map((d) => ({
      seller: sellerChip(sellerById, d.seller).name,
      courier: name(d.courierName),
      amount: d.amount,
      etd: d.etd || null,
    })),
    shipments: (o.sellerShipments || []).map((s) => shipmentSummary(s, sellerById)),
    returnRequests: (o.returnRequests || []).map((r) => returnRequestSummary(r, sellerById)),
    fulfillment: {
      hold: Boolean(o.fulfillmentHold),
      shippingPushPending: Boolean(o.shippingPushPending),
      trackingLastError: untrusted(o.trackingLastError, 300),
    },
  };
}

function refundRow(o, r, sellerById, view) {
  const summary = returnRequestSummary(r, sellerById);
  return {
    orderNumber: o.orderNumber,
    orderId: id(o),
    requestId: id(r),
    kind: r.kind,
    paymentMethod: o.paymentMethod,
    razorpayPaymentId: o.razorpayPaymentId || null,
    customer: o.user ? { name: name(o.user.name), ...contact(view, o.user.email, null) } : null,
    seller: summary.seller.name,
    ...summary.refund,
    items: summary.items,
  };
}

function sellerSummary(u, view) {
  return {
    id: id(u),
    storeName: name(u.storeName),
    name: name(u.name),
    ...contact(view, u.email, u.phone),
    slug: u.slug || null,
    status: u.status,
    emailVerified: Boolean(u.emailVerified),
    kycStatus: u.kyc?.status || 'not_started',
    codEnabled: Boolean(u.codEnabled),
    joinedAt: u.createdAt,
  };
}

function sellerDetail(u, view) {
  const k = u.kyc || {};
  const b = k.bankDetails || {};
  const p = k.pickupAddress || {};
  return {
    ...sellerSummary(u, view),
    address: untrusted(u.address, 300),
    returnPolicyDays: u.returnPolicyDays ?? null,
    exchangePolicyDays: u.exchangePolicyDays ?? null,
    codCharge: u.codCharge ?? null,
    excludedStates: (u.excludedStates || []).map((s) => name(s)),
    excludedPincodeCount: (u.excludedPincodes || []).length,
    kyc: {
      status: k.status || 'not_started',
      submittedAt: k.submittedAt || null,
      reviewedAt: k.reviewedAt || null,
      rejectionReason: untrusted(k.rejectionReason, 500),
      gstin: k.gstin || null,
      pan: maskPan(k.pan),
      documents: {
        gstCertificate: Boolean(k.gstCertificate),
        panCard: Boolean(k.panCard),
        cancelledCheque: Boolean(b.cancelledCheque),
      },
      bank: {
        accountHolder: name(b.accountHolder),
        bankName: name(b.bankName),
        ifsc: b.ifsc || null,
        accountLast4: last4(b.accountNumber),
      },
      pickupAddress: {
        line1: untrusted(p.line1 || p.address, 300),
        city: name(p.city),
        state: name(p.state),
        pincode: p.pincode || null,
      },
      shiprocketPickupLocation: name(k.shiprocket?.pickupLocation),
    },
  };
}

function productSummary(p) {
  return {
    id: id(p),
    name: name(p.name),
    slug: p.slug || null,
    sku: p.sku || null,
    status: p.status,
    price: p.price,
    mrp: p.mrp ?? null,
    currency: 'INR',
    stock: p.stock ?? null,
    variantCount: (p.variants || []).length,
    seller: p.seller ? name(p.seller.storeName || p.seller.name) : null,
    brand: name(p.brand?.name),
    category: name(p.category?.name),
    isFeatured: Boolean(p.isFeatured),
    updatedAt: p.updatedAt,
  };
}

function checkoutFailureRow(f, view) {
  return {
    at: f.createdAt,
    step: f.step,
    source: f.source,
    message: untrusted(f.message, 600),
    code: f.code || null,
    paymentMethod: f.paymentMethod,
    httpStatus: f.httpStatus ?? null,
    customer: f.user ? { name: name(f.user.name), ...contact(view, f.user.email, null) } : null,
    razorpayOrderId: f.razorpayOrderId || null,
    razorpayPaymentId: f.razorpayPaymentId || null,
  };
}

function settlementRow(s) {
  return {
    id: id(s),
    weekKey: s.weekKey,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    currency: 'INR',
    seller: s.seller
      ? { id: id(s.seller), name: name(s.seller.storeName || s.seller.name), slug: s.seller.slug || null }
      : null,
    orders: s.orders,
    itemTotal: s.itemTotal,
    courierCharge: s.courierCharge,
    gatewayCharge: s.gatewayCharge,
    refunds: s.refunds,
    net: s.net,
    amountPaid: s.amountPaid,
    utr: s.utr || null,
    note: untrusted(s.note, 300),
    paidAt: s.paidAt,
    paidBy: s.paidByEmail ? maskEmail(s.paidByEmail) : null,
    lineCount: (s.lines || []).length,
  };
}

module.exports = {
  last4,
  maskUpi,
  maskPan,
  sellerChip,
  shipmentSummary,
  returnRequestSummary,
  orderSummary,
  orderDetail,
  refundRow,
  sellerSummary,
  sellerDetail,
  productSummary,
  checkoutFailureRow,
  settlementRow,
};
