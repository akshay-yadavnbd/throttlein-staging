/**
 * The marketplace reads behind the tin_* tools. Every query is bounded by
 * the caller (page size, date window) because these run on the live
 * cluster. Statements only.
 */
const mongoose = require('mongoose');
const Order = require('../orders/order.model');
const User = require('../../models/User');
const Product = require('../products/product.model');
const CheckoutFailure = require('../customers/checkout-failure.model');
const Settlement = require('../payouts/settlement.model');
const McpAuditLog = require('./mcp-audit-log.model');

const NOT_ARCHIVED = Order.NOT_ARCHIVED;
const page = (q, skip, n) => q.skip(skip).limit(n).lean();

/* ── sellers and users ──────────────────────────────────────────────── */
/** By id, email or slug. */
const findSeller = (ref) => {
  const match = mongoose.isValidObjectId(ref)
    ? { _id: ref }
    : ref.includes('@')
      ? { email: ref.toLowerCase() }
      : { slug: ref.toLowerCase() };
  return User.findOne({ ...match, role: 'seller' }).lean();
};
const sellerNames = (ids) =>
  User.find({ _id: { $in: ids } })
    .select('storeName name slug')
    .lean();
const customersMatching = (re) =>
  User.find({ role: 'customer', $or: [{ name: re }, { email: re }] })
    .select('_id')
    .limit(200)
    .lean();
const countUsers = (filter) => User.countDocuments(filter);
const sellersPage = (filter, skip, n) =>
  page(
    User.find(filter)
      .select('name email storeName slug phone status emailVerified kyc.status codEnabled createdAt')
      .sort({ createdAt: -1, _id: -1 }),
    skip,
    n,
  );
const kycQueuePage = (filter, skip, n) =>
  page(
    User.find(filter)
      .select('name email storeName slug phone status emailVerified kyc codEnabled createdAt')
      .sort({ 'kyc.submittedAt': 1, _id: 1 }),
    skip,
    n,
  );
const userIdByRef = (ref) =>
  (mongoose.isValidObjectId(ref) ? User.findById(ref) : User.findOne({ email: String(ref).toLowerCase() }))
    .select('_id')
    .lean();

/* ── orders ─────────────────────────────────────────────────────────── */
const ordersByStatus = () =>
  Order.aggregate([{ $match: { ...NOT_ARCHIVED } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
const ordersByPayment = () =>
  Order.aggregate([{ $match: { ...NOT_ARCHIVED } }, { $group: { _id: '$paymentStatus', n: { $sum: 1 } } }]);
/** `[{ orders, paidRevenue, cancelled }]` since an instant. */
const orderWindow = (since) =>
  Order.aggregate([
    { $match: { createdAt: { $gte: since }, ...NOT_ARCHIVED } },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        paidRevenue: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$total', 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
      },
    },
  ]);
const countOrders = (filter) => Order.countDocuments(filter);
const ordersPage = (filter, skip, n) =>
  page(Order.find(filter).populate('user', 'name email phone').sort({ createdAt: -1, _id: -1 }), skip, n);
const findOrder = (ref) =>
  Order.findOne(mongoose.isValidObjectId(ref) ? { _id: ref } : { orderNumber: ref.toUpperCase() })
    .populate('user', 'name email phone')
    .lean();
const shipmentsPage = (status, skip, n) =>
  page(
    Order.find({ 'sellerShipments.status': status, ...NOT_ARCHIVED })
      .select('orderNumber createdAt updatedAt status items.seller sellerShipments')
      .sort({ updatedAt: -1, _id: -1 }),
    skip,
    n,
  );
const refundsPage = (statuses, skip, n) =>
  page(
    Order.find({ 'returnRequests.refundStatus': { $in: statuses } })
      .select('orderNumber paymentMethod paymentStatus total razorpayPaymentId returnRequests user createdAt updatedAt')
      .populate('user', 'name email')
      .sort({ updatedAt: -1, _id: -1 }),
    skip,
    n,
  );

/* ── checkout failures ──────────────────────────────────────────────── */
const countCheckoutFailures = (filter) => CheckoutFailure.countDocuments(filter);
const checkoutFailuresPage = (filter, skip, n) =>
  page(CheckoutFailure.find(filter).populate('user', 'name email').sort({ createdAt: -1, _id: -1 }), skip, n);
const checkoutFailuresByStep = (since) =>
  CheckoutFailure.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$step', n: { $sum: 1 } } }]);

/* ── products and settlements ───────────────────────────────────────── */
const productsByStatusForSeller = (sellerId) =>
  Product.aggregate([{ $match: { seller: sellerId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
const productsPage = (filter, skip, n) =>
  page(
    Product.find(filter)
      .select('name slug sku status price mrp stock variants.size seller brand category isFeatured updatedAt')
      .populate('seller', 'storeName name')
      .populate('brand', 'name')
      .populate('category', 'name')
      .sort({ updatedAt: -1, _id: -1 }),
    skip,
    n,
  );
const settlementsPage = (filter, skip, n) =>
  page(
    Settlement.find(filter)
      .select('-lines.order')
      .populate('seller', 'storeName name slug')
      .sort({ paidAt: -1, _id: -1 }),
    skip,
    n,
  );

/* ── the connector's own audit trail ────────────────────────────────── */
const auditPage = (filter, skip, n) =>
  page(McpAuditLog.find(filter).select('-mac -argsMac').sort({ seq: -1 }), skip, n);
const recentAudit = (rows) => McpAuditLog.find({}).sort({ seq: -1 }).limit(rows).lean();

module.exports = {
  NOT_ARCHIVED,
  findSeller,
  sellerNames,
  customersMatching,
  countUsers,
  sellersPage,
  kycQueuePage,
  userIdByRef,
  ordersByStatus,
  ordersByPayment,
  orderWindow,
  countOrders,
  ordersPage,
  findOrder,
  shipmentsPage,
  refundsPage,
  countCheckoutFailures,
  checkoutFailuresPage,
  checkoutFailuresByStep,
  productsByStatusForSeller,
  productsPage,
  settlementsPage,
  auditPage,
  recentAudit,
};
