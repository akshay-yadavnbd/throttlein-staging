/**
 * Admin verbs on orders: the refund queue, cancellation and pickup
 * re-booking. Admin holds the payment account, so refunds are issued here.
 * Every answer is the `{ data }` envelope (admin/app/refunds and the order
 * detail page read it through lib/api.ts `unwrap`).
 */
const asyncHandler = require('express-async-handler');
const { sendData } = require('../../utils/apiResponse');
const { AppError } = require('../../errors/AppError');
const orders = require('./orders.repository');
const parties = require('./parties.repository');
const refunds = require('./refunds.service');
const cancellation = require('./cancellation.service');
const dispatch = require('./dispatch.service');
const presenter = require('./orders.presenter');
const { forwardSliceFor } = require('./order-state');
const { lockedByReturnRequest } = require('./locking');

/** GET /api/admin/refund-requests?status=requested|processing|completed|failed|all */
exports.adminListRefundRequests = asyncHandler(async (req, res) => {
  const filterStatus = String(req.query.status || 'requested');
  const rows = await orders.refundQueue(filterStatus);
  const sellerIds = [
    ...new Set(rows.flatMap((o) => (o.returnRequests || []).map((r) => String(r.seller || ''))).filter(Boolean)),
  ];
  const sellers = await parties.sellerCards(sellerIds);
  const sellerById = Object.fromEntries(
    sellers.map((v) => [String(v._id), { name: v.storeName || v.name, slug: v.slug }]),
  );

  const requests = [];
  for (const o of rows) {
    for (const r of o.returnRequests || []) {
      if (filterStatus !== 'all' && r.refundStatus !== filterStatus) continue;
      if (filterStatus === 'all' && !orders.REFUND_QUEUE_STATUSES.includes(r.refundStatus)) continue;
      requests.push(presenter.refundQueueRow(o, r, sellerById));
    }
  }
  requests.sort((a, b) => new Date(b.refundRequestedAt || 0).getTime() - new Date(a.refundRequestedAt || 0).getTime());
  sendData(res, { requests });
});

/** GET /api/admin/refund-requests/:reqId */
exports.adminGetRefundRequest = asyncHandler(async (req, res) => {
  const order = await orders.findOrderByReturnRequestWithCustomer(req.params.reqId);
  const r = (order?.returnRequests || []).find((x) => String(x._id) === String(req.params.reqId));
  if (!order || !r) throw AppError.notFound('Refund request not found');
  const seller = await parties.sellerContactFull(r.seller);
  sendData(res, { request: presenter.refundRequestDetail(order, r, seller) });
});

/** The refund services answer `{ status, body }`; 202 means "provider still unconfirmed". */
const refundOutcome = (res, { status, body }) => sendData(res, body, status);

/** POST /api/admin/refund-requests/:reqId/process  { reference?, notes? } */
exports.adminProcessRefund = lockedByReturnRequest(async (req, res) => {
  refundOutcome(res, await refunds.processRefund(req.params.reqId, req.user._id, req.body));
});

/** POST /api/admin/refund-requests/:reqId/reconcile */
exports.adminReconcileRefund = lockedByReturnRequest(async (req, res) => {
  refundOutcome(res, await refunds.reconcileRefund(req.params.reqId));
});

/** POST /api/admin/refund-requests/:reqId/release — put an unconfirmed attempt back in the queue. */
exports.adminReleaseRefund = lockedByReturnRequest(async (req, res) => {
  refundOutcome(res, await refunds.releaseRefund(req.params.reqId, req.user?.email || req.user?.name || 'admin'));
});

/** POST /api/admin/orders/:idOrNumber/cancel  { reason } */
exports.adminCancelOrder = asyncHandler(async (req, res) => {
  const { order, carrierFailures } = await cancellation.cancelByAdmin(req.params.idOrNumber, {
    reason: String(req.body?.reason || '')
      .trim()
      .slice(0, 300),
    actor: req.user?.email || req.user?.name || 'admin',
  });
  sendData(res, { order, carrierCancellationPending: carrierFailures > 0 });
});

/** POST /api/admin/orders/:idOrNumber/reschedule-pickup  { sellerId } — books a REAL pickup, so the seller is always explicit. */
exports.adminReschedulePickup = asyncHandler(async (req, res) => {
  const sellerId = String(req.body?.sellerId || '');
  if (!sellerId) throw AppError.badRequest('sellerId is required');
  const order = await orders.findByIdentity(req.params.idOrNumber);
  if (!order) throw AppError.notFound('Order not found');
  const entry = forwardSliceFor(order, sellerId);
  if (!entry || !entry.awbCode || !entry.shipmentId)
    throw AppError.badRequest('This seller has no courier booking to reschedule yet.');
  if (entry.status !== 'awb')
    throw AppError.badRequest('The parcel has already been collected — there is no pickup to reschedule.');
  const result = await orders.withFulfillmentLock(order._id, async () => {
    const r = await dispatch.rebookPickup(entry, { reschedule: true });
    await order.save({ timestamps: false });
    return r;
  });
  if (!result.ok) throw AppError.upstream(`Courier refused the pickup: ${result.error}`);
  sendData(res, { pickupDate: result.pickupDate || null, already: !!result.already });
});
