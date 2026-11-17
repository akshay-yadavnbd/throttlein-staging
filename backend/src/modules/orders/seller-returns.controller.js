/**
 * Seller side of returns and exchanges (/api/seller/return-requests,
 * /api/seller/orders/:id/return*, …/ship-replacement).
 */
const asyncHandler = require('express-async-handler');
const { AppError } = require('../../errors/AppError');
const { sendData } = require('../../utils/apiResponse');
const orders = require('./orders.repository');
const returns = require('./returns.service');
const presenter = require('./orders.presenter');
const { lockedBySeller } = require('./locking');

async function loadSellerOrder(req) {
  const order = await orders.findForSeller(req.params.id, req.user._id);
  if (!order) throw AppError.notFound('Order not found');
  return order;
}

/** POST /api/seller/orders/:id/return  { items? } — seller-initiated reverse pickup. */
exports.sellerCreateReturn = lockedBySeller(async (req, res) => {
  const order = await loadSellerOrder(req);
  const result = await returns.sellerCreateReturn(order, req.user._id, req.body);
  if (result.already)
    return sendData(res, { ok: true, message: 'Return already initiated.', returnEntryId: result.entryId });
  sendData(res, { ok: true, message: 'Return pickup scheduled.', shiprocketOrderId: result.shiprocketOrderId });
});

/** GET /api/seller/return-requests — inbox of customer requests, newest first. */
exports.sellerListReturnRequests = asyncHandler(async (req, res) => {
  const rows = [];
  for (const o of await orders.ordersWithReturnRequestsFor(req.user._id)) {
    for (const r of o.returnRequests || []) {
      if (String(r.seller) === String(req.user._id)) rows.push(presenter.sellerReturnRequestRow(o, r));
    }
  }
  rows.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  sendData(res, { ok: true, requests: rows });
});

/** GET /api/seller/return-requests/:reqId */
exports.sellerGetReturnRequest = asyncHandler(async (req, res) => {
  const order = await orders.findReturnRequestOrderForSeller(req.params.reqId, req.user._id);
  const r = (order?.returnRequests || []).find(
    (x) => String(x._id) === String(req.params.reqId) && String(x.seller) === String(req.user._id),
  );
  if (!order || !r) throw AppError.notFound('Request not found');
  sendData(res, { ok: true, request: presenter.sellerReturnRequestDetail(order, r) });
});

/** POST /api/seller/orders/:id/return-request/:reqId/approve */
exports.sellerApproveReturnRequest = lockedBySeller(async (req, res) => {
  const order = await loadSellerOrder(req);
  const request = await returns.approveReturnRequest(order, req.user._id, req.params.reqId);
  sendData(res, { ok: true, message: 'Return approved and reverse pickup scheduled.', request });
});

/** POST /api/seller/orders/:id/return-request/:reqId/decline  { reason } */
exports.sellerDeclineReturnRequest = lockedBySeller(async (req, res) => {
  const order = await loadSellerOrder(req);
  const request = await returns.declineReturnRequest(order, req.user._id, req.params.reqId, req.body?.reason);
  sendData(res, { ok: true, message: 'Request declined.', request });
});

/** POST /api/seller/orders/:id/return-request/:reqId/verify  { ok?, notes? } */
exports.sellerVerifyReturn = lockedBySeller(async (req, res) => {
  sendData(res, await returns.verifyReturn(req.params.id, req.user._id, req.params.reqId, req.body));
});

/** POST /api/seller/orders/:id/return-request/:reqId/raise-refund */
exports.sellerRaiseRefund = lockedBySeller(async (req, res) => {
  const order = await loadSellerOrder(req);
  const refundAmount = await returns.raiseRefund(
    order,
    req.user._id,
    req.params.reqId,
    req.user?.storeName || req.user?.name,
  );
  sendData(res, { ok: true, message: 'Refund request raised. Admin will process the refund.', refundAmount });
});

/** POST /api/seller/orders/:id/return-request/:reqId/ship-replacement  { courier_id? } */
exports.sellerShipReplacement = lockedBySeller(async (req, res) => {
  const order = await loadSellerOrder(req);
  const { awbCode, awbCourier } = await returns.shipReplacement(order, req.user._id, req.params.reqId, req.body);
  sendData(res, {
    ok: true,
    message: awbCode
      ? `Replacement shipped via ${awbCourier}, AWB ${awbCode}.`
      : 'Replacement shipment created. Generate AWB to dispatch.',
    awbCode,
    awbCourier,
  });
});
