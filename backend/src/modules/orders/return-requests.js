/** Return-request lookups shared by the returns services: the seller's own request, and the order line a returned item refers to. */
const { AppError } = require('../../errors/AppError');

/** Find the request on an order and check it belongs to this seller. */
function ownRequest(order, reqId, sellerId) {
  const r = (order.returnRequests || []).id(reqId);
  if (!r || String(r.seller) !== String(sellerId)) throw AppError.notFound('Request not found');
  return r;
}

const matchLine = (order, ri) =>
  (order.items || []).find((oi) => ri.orderItemId && String(oi._id) === String(ri.orderItemId)) ||
  (order.items || []).find(
    (oi) =>
      String(oi.product) === String(ri.product) &&
      String(oi.size || '').trim() === String(ri.size || '').trim() &&
      String(oi.color || '').trim() === String(ri.color || '').trim(),
  );

module.exports = { ownRequest, matchLine };
