/**
 * Serialise dispatch / cancellation / return actions on one order BEFORE the
 * handler makes carrier or payment calls. A read-time status check alone
 * cannot stop two concurrent actions on the same parcel.
 *
 * Each wrapper resolves the order id from the route (scoped to the caller)
 * and runs the handler under the order's fulfilment lock.
 */
const asyncHandler = require('express-async-handler');
const { AppError } = require('../../errors/AppError');
const orders = require('./orders.repository');

function lockedByOrder(handler, scopeOf) {
  return asyncHandler(async (req, res, next) => {
    const order = await orders.findIdByIdentity(req.params.id, scopeOf(req));
    if (!order) throw AppError.notFound('Order not found');
    return orders.withFulfillmentLock(order._id, () => handler(req, res, next));
  });
}

/** The caller is a seller with items on the order. */
const lockedBySeller = (handler) => lockedByOrder(handler, (req) => orders.sellerScope(req.user._id));
/** The caller is the customer who placed the order. */
const lockedByCustomer = (handler) => lockedByOrder(handler, (req) => orders.customerScope(req.user._id));

/** Admin refund actions: the order is found through the return request. */
function lockedByReturnRequest(handler) {
  return asyncHandler(async (req, res, next) => {
    const order = await orders.findOrderIdByReturnRequest(req.params.reqId);
    if (!order) throw AppError.notFound('Refund request not found');
    return orders.withFulfillmentLock(order._id, () => handler(req, res, next));
  });
}

module.exports = { lockedBySeller, lockedByCustomer, lockedByReturnRequest };
