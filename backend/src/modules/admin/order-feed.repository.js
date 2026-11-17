/**
 * Every Order query the admin module makes: dashboard aggregates, the
 * platform-wide feed, per-customer and per-seller history, archive.
 * Statements only.
 */
const mongoose = require('mongoose');
const Order = require('../orders/order.model');

const NOT_ARCHIVED = Order.NOT_ARCHIVED;

/** An order addressed by ObjectId or order number ("TIN-2026-000108"). */
const refFilter = (raw) =>
  mongoose.isValidObjectId(raw) ? { _id: raw } : { orderNumber: String(raw || '').toUpperCase() };

/* ── dashboard ──────────────────────────────────────────────────────── */

const count = (filter) => Order.countDocuments(filter);
/** `[{ count, revenue }]` over the filter. */
const summary = (filter) =>
  Order.aggregate([{ $match: filter }, { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$total' } } }]);
const recent = () =>
  Order.find({ ...NOT_ARCHIVED })
    .sort({ createdAt: -1 })
    .limit(5)
    .populate('user', 'name email')
    .select('orderNumber status paymentMethod paymentStatus total createdAt items user');
const createdSince = (filter, since) => Order.find({ ...filter, createdAt: { $gte: since } }).select('createdAt');

/* ── customers ──────────────────────────────────────────────────────── */

/** Live order count + spend per customer id. */
const spendByCustomer = (ids) =>
  Order.aggregate([
    { $match: { user: { $in: ids }, status: { $ne: 'cancelled' }, ...NOT_ARCHIVED } },
    { $group: { _id: '$user', orders: { $sum: 1 }, spend: { $sum: '$total' } } },
  ]);
/** @returns {Promise<any>} populated: the checker cannot follow populate() */
const forCustomer = (userId) =>
  Order.find({ user: userId, ...NOT_ARCHIVED })
    .sort({ createdAt: -1 })
    .select(
      'orderNumber status total paymentMethod paymentStatus createdAt items shippingAddress confirmedAt shippedAt deliveredAt cancelledAt',
    );

/* ── sellers ────────────────────────────────────────────────────────── */

/** Revenue + distinct order count for one seller's line items, excluding cancelled orders. */
const sellerSales = (sellerId) =>
  Order.aggregate([
    { $match: { 'items.seller': sellerId, status: { $ne: 'cancelled' }, ...NOT_ARCHIVED } },
    { $unwind: '$items' },
    { $match: { 'items.seller': sellerId } },
    { $group: { _id: null, revenue: { $sum: '$items.subtotal' }, orders: { $addToSet: '$_id' } } },
    { $project: { _id: 0, revenue: 1, orders: { $size: '$orders' } } },
  ]);

/** Slice states that mean a parcel is somewhere in the courier network. */
const IN_FLIGHT = [
  'pushed',
  'awb',
  'shipped',
  'out_for_delivery',
  'undelivered',
  'rto_initiated',
  'rto_in_transit',
  'return_pickup',
];

/** What deleting a seller would strand: `{ total, inFlight, openReturns, openRefunds }`. */
async function sellerExposure(sid) {
  const [total, inFlight, openReturns, openRefunds] = await Promise.all([
    Order.countDocuments({ 'items.seller': sid }),
    Order.countDocuments({ sellerShipments: { $elemMatch: { seller: sid, status: { $in: IN_FLIGHT } } } }),
    Order.countDocuments({ returnRequests: { $elemMatch: { seller: sid, status: { $in: ['pending', 'approved'] } } } }),
    Order.countDocuments({
      returnRequests: { $elemMatch: { seller: sid, refundStatus: { $in: ['requested', 'processing'] } } },
    }),
  ]);
  return { total, inFlight, openReturns, openRefunds };
}

/* ── feed ───────────────────────────────────────────────────────────── */

const page = (filter, { skip, limit }) =>
  Order.find(filter)
    .populate('user', 'name email phone')
    .populate('archivedBy', 'name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
const countByStatus = (filter) => Order.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
/** @returns {Promise<any>} populated: the checker cannot follow populate() */
const exportRows = (filter, cap) =>
  Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).limit(cap).lean();
const failedPushPage = ({ skip, limit }) => {
  const filter = { 'sellerShipments.status': 'failed', ...NOT_ARCHIVED };
  return Promise.all([
    Order.find(filter).populate('user', 'name email phone').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
};
/** Archived orders still resolve here (that is where Restore lives). */
const findByRef = (raw) =>
  Order.findOne(refFilter(raw)).populate('user', 'name email phone').populate('archivedBy', 'name').lean();
const exists = (raw) => Order.exists(refFilter(raw));
/** Flip the archive flag only when the order is in the other state; null otherwise. */
/** @returns {Promise<any>} populated: the checker cannot follow populate() */
const setArchived = (raw, archive, { by, reason }) =>
  Order.findOneAndUpdate(
    { ...refFilter(raw), archivedAt: archive ? null : { $ne: null } },
    archive
      ? { $set: { archivedAt: new Date(), archivedBy: by, archiveReason: reason } }
      : { $set: { archivedAt: null, archiveReason: '' }, $unset: { archivedBy: 1 } },
    { returnDocument: 'after', timestamps: false },
  ).populate('user', 'name email');

module.exports = {
  NOT_ARCHIVED,
  count,
  summary,
  recent,
  createdSince,
  spendByCustomer,
  forCustomer,
  sellerSales,
  sellerExposure,
  page,
  countByStatus,
  exportRows,
  failedPushPage,
  findByRef,
  exists,
  setArchived,
};
