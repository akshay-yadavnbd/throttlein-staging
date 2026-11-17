/**
 * Order persistence — every query and bulk update that names the Order
 * collection lives here. Services receive documents from these functions
 * and may call `doc.save()` on them; they never build a query themselves.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { AsyncLocalStorage } = require('node:async_hooks');
const Order = require('./order.model');
const { AppError } = require('../../errors/AppError');

/* ── identity ─────────────────────────────────────────────────────────── */

/**
 * Resolve a route param that may be a MongoDB ObjectId OR an orderNumber
 * (e.g. "TIN-2026-000123"). orderNumber is uppercased before lookup since
 * Mongo treats strings as case-sensitive. Callers add their own scope
 * (user, seller) — this is the generic resolver.
 */
function identityFilter(idOrNumber) {
  if (typeof idOrNumber !== 'string' || !idOrNumber.trim() || idOrNumber.length > 80) {
    throw AppError.badRequest('Invalid order id');
  }
  if (mongoose.isValidObjectId(idOrNumber)) return { _id: idOrNumber };
  return { orderNumber: String(idOrNumber).toUpperCase() };
}

const sellerScope = (sellerId) => ({ 'items.seller': sellerId });
const customerScope = (userId) => ({ user: userId });

/* ── single lookups ───────────────────────────────────────────────────── */

const findForSeller = (idOrNumber, sellerId) =>
  Order.findOne({ ...identityFilter(idOrNumber), ...sellerScope(sellerId) });
const findForCustomer = (idOrNumber, userId) =>
  Order.findOne({ ...identityFilter(idOrNumber), ...customerScope(userId) });
const findByIdentity = (idOrNumber) => Order.findOne(identityFilter(idOrNumber));
/** Just the id, for lock acquisition before a handler runs. */
const findIdByIdentity = (idOrNumber, scope = {}) =>
  Order.findOne({ ...identityFilter(idOrNumber), ...scope }).select('_id');
const findById = (id) => Order.findById(id);
/** @returns {Promise<any>} populated: the checker cannot follow populate() */
const findByIdWithCustomer = (id) => Order.findById(id).populate('user', 'name email');
const findByIdInSession = (id, session) => Order.findById(id).session(session);
const findForSellerInSession = (idOrNumber, sellerId, session) =>
  Order.findOne({ ...identityFilter(idOrNumber), ...sellerScope(sellerId) }).session(session);

/** COD idempotency: the same key from the same customer returns the same order. */
const findByIdempotencyKey = (userId, idempotencyKey) => Order.findOne({ user: userId, idempotencyKey });
/** After a duplicate-key error on create: whichever unique field collided. */
const findDuplicateOnCreate = (paid, userId, razorpayPaymentId, idempotencyKey) =>
  Order.findOne(paid ? { user: userId, razorpayPaymentId } : { user: userId, idempotencyKey });

const newOrder = (doc) => new Order(doc);

/* ── lists ────────────────────────────────────────────────────────────── */

/** Shared bounded pagination. Defaults keep existing clients working; `limit` is capped (audit P2). */
function pageParams(query = {}, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limit = Math.min(maxLimit, Math.max(1, Number(query.limit) || defaultLimit));
  const page = Math.max(1, Number(query.page) || 1);
  return { limit, page, skip: (page - 1) * limit };
}

async function listForSeller(sellerId, { skip, limit }) {
  const query = {
    ...sellerScope(sellerId),
    // Cancelled orders this seller cleared out of their own list. The
    // records stay whole for admin and for the customer — see hide.
    sellerShipments: { $not: { $elemMatch: { seller: sellerId, sellerHiddenAt: { $exists: true } } } },
    // …and orders an admin deleted (archived) for everyone.
    ...Order.NOT_ARCHIVED,
  };
  return Promise.all([Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit), Order.countDocuments(query)]);
}

async function listForCustomer(userId, { skip, limit }) {
  const query = { ...customerScope(userId), ...Order.NOT_ARCHIVED };
  return Promise.all([Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit), Order.countDocuments(query)]);
}

/** Open orders for the attention counts (one cheap projection). */
const openOrdersForSeller = (sellerId) =>
  Order.find({
    ...sellerScope(sellerId),
    status: { $nin: ['cancelled', 'delivered'] },
    ...Order.NOT_ARCHIVED,
  })
    .select('status fulfillmentHold sellerShipments returnRequests')
    .lean();

const ordersWithPendingReturnsFor = (sellerId) =>
  Order.find({
    returnRequests: { $elemMatch: { seller: sellerId, status: 'pending' } },
    ...Order.NOT_ARCHIVED,
  })
    .select('returnRequests')
    .lean();

/** Every order carrying this seller's shipments — the NDR list filters Shiprocket's feed by AWB. */
const ordersWithShipmentsFor = (sellerId) =>
  Order.find(sellerScope(sellerId)).select('orderNumber sellerShipments shippingAddress').lean();

/** Orders with at least one pushed shipment — the manifest picks the labelled, un-collected ones. */
const pushedOrdersFor = (sellerId) =>
  Order.find({ ...sellerScope(sellerId), 'sellerShipments.shipmentId': { $ne: '' } })
    .select('sellerShipments')
    .lean();

/* ── return requests ──────────────────────────────────────────────────── */

const ordersWithReturnRequestsFor = (sellerId) =>
  Order.find({
    'returnRequests.seller': sellerId,
    ...Order.NOT_ARCHIVED,
  })
    .select('orderNumber shippingAddress items returnRequests createdAt')
    .sort({ updatedAt: -1 })
    .lean();

const findReturnRequestOrderForSeller = (reqId, sellerId) =>
  Order.findOne({
    'returnRequests._id': reqId,
    'returnRequests.seller': sellerId,
  })
    .select('orderNumber shippingAddress items returnRequests sellerShipments createdAt deliveredAt')
    .lean();

const findOrderByReturnRequest = (reqId) => Order.findOne({ 'returnRequests._id': reqId });
const findOrderIdByReturnRequest = (reqId) => Order.findOne({ 'returnRequests._id': reqId }).select('_id');
const findOrderByReturnRequestWithCustomer = (reqId) =>
  Order.findOne({ 'returnRequests._id': reqId }).populate('user', 'name email phone').lean();

/* ── refunds ──────────────────────────────────────────────────────────── */

const REFUND_QUEUE_STATUSES = ['requested', 'processing', 'completed', 'failed'];

const refundQueue = (filterStatus) =>
  Order.find(
    filterStatus === 'all'
      ? { 'returnRequests.refundStatus': { $in: REFUND_QUEUE_STATUSES } }
      : { 'returnRequests.refundStatus': filterStatus },
  )
    .select(
      'orderNumber paymentMethod paymentStatus total razorpayPaymentId shippingAddress returnRequests sellerShipments user createdAt',
    )
    .populate('user', 'name email')
    .sort({ updatedAt: -1 })
    .lean();

const findIdByRazorpayPayment = (paymentId) => Order.findOne({ razorpayPaymentId: paymentId }).select('_id');

/**
 * Atomically move one refund request to `processing`, refusing when the
 * amount would push total refunds past the order's captured total (claims
 * for different partial refunds share one budget).
 */
const claimRefundProcessing = (order, reqId, amountPaise, { adminId, notes }) =>
  Order.findOneAndUpdate(
    {
      _id: order._id,
      $expr: {
        $lte: [
          {
            $add: [
              amountPaise,
              {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: '$returnRequests',
                        as: 'r',
                        cond: { $in: ['$$r.refundStatus', ['processing', 'completed']] },
                      },
                    },
                    as: 'r',
                    in: { $round: [{ $multiply: ['$$r.refundAmount', 100] }, 0] },
                  },
                },
              },
            ],
          },
          Math.round(order.total * 100),
        ],
      },
      returnRequests: { $elemMatch: { _id: reqId, refundStatus: { $in: ['requested', 'failed'] } } },
    },
    {
      $set: {
        'returnRequests.$.refundStatus': 'processing',
        'returnRequests.$.refundAttemptId': crypto.randomUUID(),
        'returnRequests.$.refundAttemptAt': new Date(),
        'returnRequests.$.refundReference': '',
        'returnRequests.$.refundProcessedBy': adminId,
        'returnRequests.$.refundNotes': String(notes || '').slice(0, 500),
      },
    },
    { returnDocument: 'after' },
  );

const completeManualRefund = (orderId, reqId, reference) =>
  Order.updateOne(
    { _id: orderId, 'returnRequests._id': reqId },
    {
      $set: {
        'returnRequests.$.refundReference': reference.slice(0, 100),
        'returnRequests.$.refundStatus': 'completed',
        'returnRequests.$.refundCompletedAt': new Date(),
        'returnRequests.$.status': 'completed',
      },
    },
  );

/** Write a provider refund result; a completed request is never regressed. */
const applyRefundResult = (orderId, reqId, changes, refundId) =>
  Order.updateOne(
    { _id: orderId, returnRequests: { $elemMatch: { _id: reqId, refundStatus: { $ne: 'completed' } } } },
    { $set: changes, $addToSet: { refundIds: refundId } },
  );

/**
 * Put an uncertain provider attempt back in the admin's queue. Only a
 * `processing` Razorpay request moves; the note records who released it and
 * why, so the retry is explained in the order's history.
 */
const releaseRefundForRetry = (orderId, reqId, note) =>
  Order.findOneAndUpdate(
    {
      _id: orderId,
      returnRequests: { $elemMatch: { _id: reqId, refundStatus: 'processing', refundMethod: 'razorpay' } },
    },
    {
      $set: {
        'returnRequests.$.refundStatus': 'requested',
        'returnRequests.$.refundAttemptId': '',
        'returnRequests.$.refundReference': '',
        'returnRequests.$.refundNotes': note.slice(0, 500),
      },
      $unset: { 'returnRequests.$.refundProcessedBy': 1 },
    },
    { returnDocument: 'after' },
  );

const markRefundUncertain = (orderId, reqId) =>
  Order.updateOne(
    { _id: orderId, returnRequests: { $elemMatch: { _id: reqId, refundStatus: 'processing' } } },
    { $set: { 'returnRequests.$.refundNotes': 'Provider result uncertain. Reconcile this refund before retrying.' } },
  );

/** Flip paymentStatus to refunded once completed refunds reach the order total (summed on the live document). */
const recomputeRefundedPayment = (orderId) =>
  Order.updateOne(
    {
      _id: orderId,
      $expr: {
        $gte: [
          {
            $sum: {
              $map: {
                input: {
                  $filter: { input: '$returnRequests', as: 'r', cond: { $eq: ['$$r.refundStatus', 'completed'] } },
                },
                as: 'r',
                in: '$$r.refundAmount',
              },
            },
          },
          '$total',
        ],
      },
    },
    { $set: { paymentStatus: 'refunded', refundedAt: new Date() } },
  );

/* ── cancellation ─────────────────────────────────────────────────────── */

/** Atomic claim: placed/confirmed → cancelled, so a double-click cannot run the money/stock work twice. */
const claimCancellation = (scope) =>
  Order.findOneAndUpdate(
    { ...scope, status: { $in: ['placed', 'confirmed'] } },
    { $set: { status: 'cancelled', cancelledAt: new Date() } },
    { returnDocument: 'after' },
  );

/* ── transactions and the fulfilment lock ─────────────────────────────── */

/**
 * Run `fn(session)` inside one MongoDB transaction; the session is always ended.
 * @template T
 * @param {(session: import('mongoose').ClientSession) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runInTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

const fulfillmentContext = new AsyncLocalStorage();
/**
 * Serialise every status-writing action on one order.
 *
 * Re-entrant by default: a handler that already holds the lock (tracked via
 * AsyncLocalStorage) can call helpers that also ask for it. Pass
 * `{ exclusive: true }` for actors that must NEVER piggyback on someone
 * else's lock — carrier ingestion uses this so a webhook or tracking sync
 * that lands while a seller action is mid-flight is queued and retried
 * instead of writing into the same in-progress document.
 */
async function withFulfillmentLock(orderId, action, { exclusive = false } = {}) {
  if (!exclusive && fulfillmentContext.getStore() === String(orderId)) return action();
  const token = crypto.randomUUID();
  const acquired = await Order.findOneAndUpdate(
    {
      _id: orderId,
      $or: [{ fulfillmentLockUntil: { $exists: false } }, { fulfillmentLockUntil: { $lt: new Date() } }],
    },
    { $set: { fulfillmentLockToken: token, fulfillmentLockUntil: new Date(Date.now() + 30 * 60 * 1000) } },
  );
  if (!acquired) throw AppError.conflict('Another fulfilment action is running. Try again shortly.');
  try {
    return await fulfillmentContext.run(String(orderId), action);
  } finally {
    await Order.updateOne(
      { _id: orderId, fulfillmentLockToken: token },
      { $unset: { fulfillmentLockToken: 1, fulfillmentLockUntil: 1 } },
    );
  }
}

module.exports = {
  identityFilter,
  sellerScope,
  customerScope,
  findForSeller,
  findForCustomer,
  findByIdentity,
  findIdByIdentity,
  findById,
  findByIdWithCustomer,
  findByIdInSession,
  findForSellerInSession,
  findByIdempotencyKey,
  findDuplicateOnCreate,
  newOrder,
  pageParams,
  listForSeller,
  listForCustomer,
  openOrdersForSeller,
  ordersWithPendingReturnsFor,
  ordersWithShipmentsFor,
  pushedOrdersFor,
  ordersWithReturnRequestsFor,
  findReturnRequestOrderForSeller,
  findOrderByReturnRequest,
  findOrderIdByReturnRequest,
  findOrderByReturnRequestWithCustomer,
  REFUND_QUEUE_STATUSES,
  refundQueue,
  findIdByRazorpayPayment,
  claimRefundProcessing,
  completeManualRefund,
  applyRefundResult,
  markRefundUncertain,
  releaseRefundForRetry,
  recomputeRefundedPayment,
  claimCancellation,
  runInTransaction,
  withFulfillmentLock,
};
