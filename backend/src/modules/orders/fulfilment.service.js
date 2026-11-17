/**
 * The seller's side of an order: what needs their hand, confirming,
 * dispatching, cancelling and hiding their own slice. Carrier calls are in
 * dispatch.service / awb.service; this file owns the state rules around them.
 */
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const orders = require('./orders.repository');
const dispatch = require('./dispatch.service');
const awb = require('./awb.service');
const cancellation = require('./cancellation.service');
const notifications = require('./order-notifications');
const {
  deriveOrderAggregate,
  forwardSliceFor,
  anyForwardSliceFor,
  isForward,
  UNDISPATCHABLE,
} = require('./order-state');

const PICKUP_FAILED = /PICKUP (EXCEPTION|ERROR|FAILED|CANCELLED)|NOT PICKED/;

/**
 * Counts of things that need THIS seller's hand right now. Drives the
 * sidebar badge, the Orders-page tabs and the dashboard's "Action needed"
 * strip. Statuses mirror lib/orderStatusDisplay so a badge never disagrees
 * with the list.
 */
async function attentionCounts(sellerId) {
  const me = String(sellerId);
  const open = await orders.openOrdersForSeller(sellerId);
  const c = { toShip: 0, pickupFailed: 0, deliveryIssues: 0, returnsPending: 0 };
  for (const o of open) {
    if (o.fulfillmentHold) continue;
    for (const s of o.sellerShipments || []) {
      if (String(s.seller) !== me || !isForward(s) || s.returnOf) continue;
      const label = String(s.currentStatus || '').toUpperCase();
      if (!s.awbCode && ['queued', 'pushed'].includes(s.status)) c.toShip += 1;
      else if (s.awbCode && ['awb', 'pushed'].includes(s.status) && (PICKUP_FAILED.test(label) || s.pickupError))
        c.pickupFailed += 1;
      else if (s.status === 'undelivered') c.deliveryIssues += 1;
    }
  }
  // Pending return/exchange requests sit on delivered orders too.
  const withReturns = await orders.ordersWithPendingReturnsFor(sellerId);
  for (const o of withReturns) {
    c.returnsPending += (o.returnRequests || []).filter(
      (r) => String(r.seller) === me && r.status === 'pending',
    ).length;
  }
  return { counts: c, total: c.toShip + c.pickupFailed + c.deliveryIssues + c.returnsPending };
}

function assertLive(order) {
  if (order.status === 'cancelled' || order.fulfillmentHold) throw AppError.badRequest('This order is cancelled.');
}

/**
 * Seller confirms their slice (the only status a seller may set by hand;
 * shipping and delivery come from the carrier). The customer is emailed
 * only when the AGGREGATE moved — seller B confirming after seller A must
 * not re-send "your order is confirmed".
 */
async function confirmSlice(order, sellerId) {
  assertLive(order);
  let entry = forwardSliceFor(order, sellerId);
  if (!entry) {
    order.sellerShipments = order.sellerShipments || [];
    order.sellerShipments.push({ seller: sellerId, kind: 'forward', status: 'queued' });
    entry = order.sellerShipments[order.sellerShipments.length - 1];
  }
  if (entry.status === 'cancelled') throw AppError.badRequest('Your shipment on this order is cancelled.');
  if (entry.status === 'delivered') throw AppError.badRequest('Your shipment is already delivered.');
  entry.confirmedAt = entry.confirmedAt || new Date();

  const prevStatus = order.status;
  deriveOrderAggregate(order);
  await order.save();
  if (order.status !== prevStatus) {
    notifications
      .sendCustomerStatusEmail(order._id, order.status)
      .catch((e) => logger.error({ err: e }, 'sendCustomerStatusEmail error'));
    notifications.notifyTeamOfOrder(order._id, order.status).catch(() => {
      /* already logged */
    });
  }
  return order;
}

/**
 * "Generate label & schedule pickup". Idempotent: an existing AWB returns
 * the cached result and retries ONLY the pickup booking (audit A14), or
 * re-books it on request after a pickup exception.
 *
 * Courier priority: the seller's explicit pick → the courier the CUSTOMER
 * paid for at checkout → Shiprocket's choice.
 */
async function shipSlice(order, sellerId, { courierId, reschedulePickup }) {
  // Audit A16: cancellation and dispatch could race.
  if (order.status === 'cancelled' || order.fulfillmentHold) {
    throw AppError.badRequest(order.fulfillmentHold || 'This order was cancelled — do not dispatch it.');
  }
  const entry = anyForwardSliceFor(order, sellerId);
  if (!entry) throw AppError.badRequest("Shipment isn't ready yet — click Retry push to re-create it on Shiprocket.");
  if (UNDISPATCHABLE.has(entry.status)) throw AppError.conflict('This shipment can no longer be dispatched.');

  let chosenCourierId = Number(courierId) || undefined;
  const paidFor = (order.delivery || []).find((d) => String(d.seller) === String(sellerId));
  if (!chosenCourierId && paidFor?.courierId) chosenCourierId = Number(paidFor.courierId) || undefined;

  // Only "already shipped" when there really is an AWB: a status of awb /
  // shipped with an empty code means the last attempt half-succeeded.
  if (entry.awbCode && ['awb', 'shipped', 'delivered'].includes(entry.status)) {
    const wantsReschedule = reschedulePickup === true && entry.status === 'awb';
    if ((!entry.pickupBookedAt && entry.status === 'awb') || wantsReschedule) {
      await dispatch.rebookPickup(entry, { reschedule: wantsReschedule });
      await order.save({ timestamps: false });
    }
    return awb.shipOutcome(entry, { cached: true });
  }
  if (!entry.shipmentId)
    throw AppError.badRequest('Shiprocket shipment id missing on this order. Ask admin to retry the push.');

  const outcome = await awb.assignAwbAndBookPickup(order, entry, { sellerId, courierId: chosenCourierId });
  // A label implies the seller acknowledged the slice; the customer-facing status is derived (audit A12).
  deriveOrderAggregate(order);
  await order.save({ timestamps: false });
  return outcome;
}

/** Pre-pickup re-booking, optionally with a different courier. Returns the response body. */
async function reschedulePickup(order, entry, courierId) {
  if (!entry?.awbCode || !entry?.shipmentId)
    throw AppError.badRequest('No courier booking yet — use Ship to generate a label first.');
  /* Pre-pickup only: `awb`/`pushed` both mean "label exists, not collected". */
  if (!['awb', 'pushed'].includes(entry.status)) {
    throw AppError.badRequest(
      entry.status === 'cancelled'
        ? 'This shipment was cancelled. Use Retry push to book it again.'
        : 'The courier already has this parcel — there is no pickup to reschedule.',
    );
  }
  const result = await awb.switchCourierAndRebook(order, entry, Number(courierId) || 0);
  if (!result.ok) throw AppError.upstream(result.error);
  return {
    ok: true,
    switched: !!result.switched,
    awbCode: result.awb,
    awbCourier: result.courier,
    pickupDate: result.pickupDate || null,
    already: !!result.already,
  };
}

/**
 * Cancel a parcel that has no label yet and that the seller has not
 * confirmed. Puts the units back and, on a prepaid order, raises the refund
 * with admin — the same path a cancelled shipment takes.
 */
async function cancelUnlabelledSlice(order, entry, sellerId) {
  if (!entry) throw AppError.notFound('You have no parcel on this order.');
  if (entry.status === 'cancelled') return { already: true };
  if (entry.awbCode) throw AppError.badRequest('A courier label already exists — use Cancel shipment instead.');
  if (entry.confirmedAt)
    throw AppError.badRequest('You already confirmed this order. Contact support to cancel it now.');
  if (order.status === 'cancelled') throw AppError.badRequest('This order is already cancelled.');
  entry.status = 'cancelled';
  entry.lastError = '';
  deriveOrderAggregate(order);
  await order.save({ timestamps: false });
  await cancellation.restoreCancelledStock(order._id, sellerId);
  return { already: false };
}

/** Cancel a labelled shipment at the carrier (before pickup) and restore the units. */
async function cancelLabelledSlice(order, entry, sellerId) {
  if (entry?.status === 'cancelled') {
    if (isForward(entry)) await cancellation.restoreCancelledStock(order._id, sellerId);
    return;
  }
  await dispatch.cancelSliceAtCarrier(entry);
  deriveOrderAggregate(order);
  await order.save({ timestamps: false });
  if (isForward(entry)) await cancellation.restoreCancelledStock(order._id, sellerId);
}

/** Clear a finished cancellation out of the seller's own list; the order document is otherwise untouched. */
async function hideSlice(order, entry, hidden) {
  if (!entry) throw AppError.notFound('You have no parcel on this order.');
  if (hidden && entry.status !== 'cancelled')
    throw AppError.badRequest('Only a cancelled order can be removed from your list.');
  entry.sellerHiddenAt = hidden ? new Date() : undefined;
  await order.save({ timestamps: false });
}

module.exports = {
  attentionCounts,
  confirmSlice,
  shipSlice,
  reschedulePickup,
  cancelUnlabelledSlice,
  cancelLabelledSlice,
  hideSlice,
};
