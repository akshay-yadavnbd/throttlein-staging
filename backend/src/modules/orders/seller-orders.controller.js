/**
 * Seller fulfilment endpoints (/api/seller/orders/*, /api/seller/manifests).
 * HTTP in, HTTP out: load, delegate, answer. Rules live in the services.
 */
const asyncHandler = require('express-async-handler');
const { AppError } = require('../../errors/AppError');
const { sendData } = require('../../utils/apiResponse');
const taxInvoice = require('./tax-invoice.service');
const orders = require('./orders.repository');
const dispatch = require('./dispatch.service');
const carrierOps = require('./ndr-manifest.service');
const fulfilment = require('./fulfilment.service');
const presenter = require('./orders.presenter');
const { firstSliceFor } = require('./order-state');
const { lockedBySeller } = require('./locking');

/** Order the caller has items on, or 404, plus their first slice (any kind). */
async function loadSellerOrder(req) {
  const order = await orders.findForSeller(req.params.id, req.user._id);
  if (!order) throw AppError.notFound('Order not found');
  return { order, entry: firstSliceFor(order, req.user._id) };
}

/** GET /api/seller/orders — every order with at least one of this seller's products. */
exports.listSellerOrders = asyncHandler(async (req, res) => {
  const paging = orders.pageParams(req.query);
  const [rows, total] = await orders.listForSeller(req.user._id, paging);
  const pagination = presenter.paginationMeta({ total, page: paging.page, limit: paging.limit });
  res.set('X-Total-Count', String(total));
  res.locals.pagination = pagination;
  sendData(res, { items: rows.map((o) => presenter.sellerOrderDto(o, req.user._id)) }, 200, {
    page: pagination.page,
    pageSize: pagination.limit,
    totalItems: pagination.total,
    totalPages: pagination.pages,
  });
});

/** GET /api/seller/orders/:id */
exports.getSellerOrder = asyncHandler(async (req, res) => {
  const { order } = await loadSellerOrder(req);
  sendData(res, { order: presenter.sellerOrderDto(order, req.user._id) });
});

/** GET /api/seller/orders/attention — counts for the badge / tabs / "Action needed" strip. */
exports.sellerAttentionCounts = asyncHandler(async (req, res) => {
  const { counts, total } = await fulfilment.attentionCounts(req.user._id);
  sendData(res, { ok: true, counts, total });
});

/** PATCH /api/seller/orders/:id/status  { status: 'confirmed' } — acts on the caller's slice. */
exports.updateSellerOrderStatus = lockedBySeller(async (req, res) => {
  if (req.body?.status !== 'confirmed') {
    throw AppError.badRequest(
      'Only order confirmation can be set manually. Shipping and delivery are updated by the carrier.',
    );
  }
  const { order } = await loadSellerOrder(req);
  await fulfilment.confirmSlice(order, req.user._id);
  sendData(res, { order: presenter.sellerOrderDto(order, req.user._id) });
});

/** POST /api/seller/orders/:id/ship  { courier_id?, reschedulePickup? } */
exports.sellerShipOrder = lockedBySeller(async (req, res) => {
  const { order } = await loadSellerOrder(req);
  sendData(
    res,
    await fulfilment.shipSlice(order, req.user._id, {
      courierId: req.body?.courier_id,
      reschedulePickup: req.body?.reschedulePickup === true,
    }),
  );
});

/** GET /api/seller/orders/:id/couriers — every courier that can carry this parcel. */
exports.sellerOrderCouriers = asyncHandler(async (req, res) => {
  const { order, entry } = await loadSellerOrder(req);
  if (!entry?.shipmentId) throw AppError.badRequest('Order not pushed to Shiprocket yet — click Retry push first.');
  const { data, ...rest } = await dispatch.courierOptionsFor(order, req.user._id);
  sendData(res, {
    ok: true,
    weightKg: rest.weightKg,
    pickup: rest.pickup,
    delivery: rest.delivery,
    couriers: presenter.courierOptions(data),
    preferredCourierId: rest.preferredCourierId,
  });
});

/** POST /api/seller/orders/:id/reschedule-pickup  { courier_id? } */
exports.sellerReschedulePickup = asyncHandler(async (req, res) => {
  const { order, entry } = await loadSellerOrder(req);
  sendData(res, await fulfilment.reschedulePickup(order, entry, req.body?.courier_id));
});

/** GET /api/seller/orders/:id/label → { url } of the Shiprocket-hosted label PDF. */
exports.sellerOrderLabel = asyncHandler(async (req, res) => {
  const { order, entry } = await loadSellerOrder(req);
  const { url, cached } = await dispatch.labelUrlFor(order, entry);
  sendData(res, cached ? { ok: true, url, cached: true } : { ok: true, url });
});

/** GET /api/seller/orders/:id/invoice — the GST tax invoice PDF once the parcel has an AWB. */
exports.sellerOrderInvoice = asyncHandler(async (req, res) => {
  const { order } = await loadSellerOrder(req);
  const entry = taxInvoice.forwardEntry(order, req.user._id);
  if (!entry || entry.status === 'cancelled' || !entry.awbCode) {
    throw AppError.badRequest('The invoice is available once the parcel has an AWB — ship the order first.');
  }
  taxInvoice.sendPdf(res, await taxInvoice.invoicePdf(order, entry));
});

/** GET /api/seller/orders/:id/track — the parcel's tracking timeline. */
exports.sellerOrderTrack = asyncHandler(async (req, res) => {
  const { order, entry } = await loadSellerOrder(req);
  if (!entry?.awbCode) return sendData(res, { ok: false, reason: 'no-awb' });
  try {
    const { data } = await require('./shipment-sync.service').refreshShipment(order._id, entry);
    sendData(res, presenter.trackingDto(data, entry));
  } catch (e) {
    sendData(res, { ok: false, reason: 'shiprocket-error', error: e.message });
  }
});

/** POST /api/seller/orders/:id/cancel-shipment — cancel by AWB before pickup. */
exports.sellerCancelShipment = lockedBySeller(async (req, res) => {
  const { order, entry } = await loadSellerOrder(req);
  await fulfilment.cancelLabelledSlice(order, entry, req.user._id);
  sendData(res, { ok: true, message: 'Shipment cancelled.' });
});

/** POST /api/seller/orders/:id/cancel-order — cancel a parcel that has no label and was not confirmed. */
exports.sellerCancelOrder = lockedBySeller(async (req, res) => {
  const { order, entry } = await loadSellerOrder(req);
  const { already } = await fulfilment.cancelUnlabelledSlice(order, entry, req.user._id);
  sendData(res, { ok: true, message: already ? 'Already cancelled.' : 'Order cancelled.' });
});

/** POST /api/seller/orders/:id/hide  { hidden?: boolean } */
exports.sellerHideOrder = asyncHandler(async (req, res) => {
  const { order, entry } = await loadSellerOrder(req);
  const hidden = req.body?.hidden !== false;
  await fulfilment.hideSlice(order, entry, hidden);
  sendData(res, { ok: true, hidden });
});

/** POST /api/seller/orders/:id/ndr-action  { action, comments?, addressOverride? } */
exports.sellerNdrAction = asyncHandler(async (req, res) => {
  const { order, entry } = await loadSellerOrder(req);
  const action = String(req.body?.action || '').trim();
  if (!['re-attempt', 'return', 'fake-attempt'].includes(action)) {
    throw AppError.badRequest('action must be one of: re-attempt, return, fake-attempt');
  }
  await carrierOps.respondToNdr(entry, {
    action,
    comments: req.body?.comments,
    addressOverride: req.body?.addressOverride,
  });
  await order.save({ timestamps: false });
  sendData(res, { ok: true, message: `NDR action "${action}" submitted.` });
});

/** GET /api/seller/orders/ndr — this seller's Non-Delivery Reports. */
exports.sellerListNdr = asyncHandler(async (req, res) => {
  const ndr = await carrierOps.ndrListFor(req.user._id, Number(req.query.page) || 1);
  sendData(res, { ok: true, ndr, total: ndr.length });
});

/** POST /api/seller/orders/:id/retry-push — re-create this seller's slice on Shiprocket. */
exports.sellerRetryPush = lockedBySeller(async (req, res) => {
  const { order } = await loadSellerOrder(req);
  const entry = await dispatch.retryPushForSeller(order, req.user._id);
  sendData(res, {
    ok: entry?.status !== 'failed',
    status: entry?.status || 'unknown',
    shipmentId: entry?.shipmentId || '',
    shiprocketOrderId: entry?.shiprocketOrderId || '',
    error: entry?.lastError || '',
  });
});

/** GET /api/seller/manifests/today — handover sheet for labelled, un-collected parcels. */
exports.sellerManifestToday = asyncHandler(async (req, res) => {
  sendData(res, await carrierOps.manifestFor(req.user._id));
});
