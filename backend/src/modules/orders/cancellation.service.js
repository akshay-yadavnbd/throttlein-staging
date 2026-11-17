/**
 * Cancelling an order (customer or admin) and what it means for inventory
 * and money. The two entry points share one completion so they can never
 * drift on what "cancelled" means.
 *
 * Audit A16 — the flow:
 *   1. Claim the cancellation ATOMICALLY (placed/confirmed → cancelled).
 *   2. Ask the carrier to cancel and AWAIT the answer per slice.
 *   3. Restore exact SKUs once — only when nothing is still in the
 *      carrier's hands — guarded by `stockRestoredAt`.
 *   4. Raise a refund obligation for a prepaid order.
 */
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const shiprocket = require('../../infrastructure/shipping/shiprocket');
const orders = require('./orders.repository');
const inventory = require('./inventory.repository');
const notifications = require('./order-notifications');
const { isForward } = require('./order-state');

/** Add the refund obligation for a prepaid order (whole order, or one seller's slice). */
function ensureCancellationRefund(order, sellerId = null) {
  if (order.paymentMethod === 'cod' || !['paid', 'refunded'].includes(order.paymentStatus)) return;
  order.returnRequests = order.returnRequests || [];
  if (
    order.returnRequests.some(
      (r) =>
        r.kind === 'cancellation' &&
        (sellerId
          ? r.cancellationScope === 'seller' && String(r.seller) === String(sellerId)
          : r.cancellationScope !== 'seller'),
    )
  )
    return;
  const committed = order.returnRequests
    .filter((r) => r.refundStatus !== 'not-requested')
    .reduce((sum, r) => sum + Math.round((r.refundAmount || 0) * 100), 0);
  const remaining = Math.max(0, Math.round(order.total * 100) - committed);
  const cancelledItems = (order.items || []).filter((it) => !sellerId || String(it.seller) === String(sellerId));
  const subtotal = cancelledItems.reduce((sum, it) => sum + (it.subtotal || 0), 0);
  const amount = sellerId
    ? Math.min(remaining, Math.round((order.total * 100 * subtotal) / (order.itemsTotal || 1)))
    : remaining;
  if (!amount) return;
  order.returnRequests.push({
    seller: sellerId || order.items[0].seller,
    kind: 'cancellation',
    cancellationScope: sellerId ? 'seller' : 'order',
    reason: 'Order cancelled before dispatch',
    reasonCode: 'order-cancelled',
    status: 'approved',
    items: cancelledItems.map((it) => ({ product: it.product, name: it.name, size: it.size, quantity: it.quantity })),
    refundStatus: 'requested',
    refundMethod: 'razorpay',
    refundAmount: amount / 100,
    refundRequestedAt: new Date(),
  });
}

/** Inventory and its once-only marker commit together, including mixed cancellations. Returns the fresh order. */
async function restoreCancelledStock(orderId, sellerId = null) {
  await orders.runInTransaction(async (session) => {
    const fresh = await orders.findByIdInSession(orderId, session);
    if (!fresh || fresh.stockRestoredAt) return;
    const restoredSellers = new Set(
      (fresh.sellerShipments || []).filter((s) => isForward(s) && s.stockRestoredAt).map((s) => String(s.seller)),
    );
    const reservations =
      fresh.inventoryReserved === false
        ? []
        : fresh.stockReservations?.length
          ? fresh.stockReservations
          : (fresh.items || []).map((it) => ({
              product: it.product,
              seller: it.seller,
              quantity: it.quantity,
              size: String(it.size || '').trim(),
              color: String(it.color || '').trim(),
              variantApplied: Boolean(it.size || it.color),
            }));
    const toRestore = reservations.filter(
      (it) => (!sellerId || String(it.seller) === String(sellerId)) && !restoredSellers.has(String(it.seller)),
    );
    await inventory.releaseStock(toRestore, session);
    ensureCancellationRefund(fresh, sellerId);
    const stamp = new Date();
    for (const shipment of fresh.sellerShipments || []) {
      if (isForward(shipment) && (!sellerId || String(shipment.seller) === String(sellerId)))
        shipment.stockRestoredAt = shipment.stockRestoredAt || stamp;
    }
    if (!sellerId) fresh.stockRestoredAt = stamp;
    await fresh.save({ session, timestamps: false });
  });
  return orders.findById(orderId);
}

/**
 * Everything after the atomic claim — carrier cancel per slice, stock
 * restore, refund obligation, notifications. @returns {Promise<{ carrierFailures: number }>}
 */
async function completeCancellation(order) {
  let carrierFailures = 0;
  for (const s of order.sellerShipments || []) {
    if (!isForward(s) || s.status === 'cancelled') continue;
    if (
      ['delivered', 'returned', 'shipped', 'out_for_delivery', 'rto_initiated', 'rto_in_transit'].includes(s.status)
    ) {
      carrierFailures += 1;
      s.lastError = 'Parcel already moved. Contact support to complete cancellation.';
      continue;
    }
    try {
      if (s.awbCode) await shiprocket.cancelShipmentByAwb([String(s.awbCode)]);
      else if (s.shiprocketOrderId) await shiprocket.cancelOrder([String(s.shiprocketOrderId)]);
      s.status = 'cancelled';
      s.lastError = '';
    } catch (e) {
      carrierFailures += 1;
      s.lastError = `Cancellation not confirmed by carrier: ${e.message}`.slice(0, 500);
      logger.error(
        { err: e, orderNumber: order.orderNumber, seller: String(s.seller) },
        'shiprocket: cancel failed for slice',
      );
    }
  }

  if (carrierFailures === 0) {
    await order.save();
    const restored = await restoreCancelledStock(order._id);
    order.stockRestoredAt = restored.stockRestoredAt;
    order.sellerShipments = restored.sellerShipments;
    order.returnRequests = restored.returnRequests;
    order.__v = restored.__v;
  } else {
    order.notes = [order.notes, '[cancellation] Carrier cancellation pending; inventory has not been restored.']
      .filter(Boolean)
      .join('\n');
  }

  if (carrierFailures === 0) ensureCancellationRefund(order);

  await order.save();

  notifications
    .sendCustomerStatusEmail(order._id, 'cancelled')
    .catch((e) => logger.error({ err: e }, 'sendCustomerStatusEmail error'));
  notifications.notifyTeamOfOrder(order._id, 'cancelled').catch(() => {
    /* already logged */
  });
  return { carrierFailures };
}

/** The customer cancels their own order. `{ order, carrierFailures }`. */
async function cancelByCustomer(idOrNumber, userId) {
  const scope = { ...orders.identityFilter(idOrNumber), ...orders.customerScope(userId) };
  let claimed = await orders.claimCancellation(scope);
  if (!claimed) {
    const existing = await orders.findForCustomer(idOrNumber, userId);
    if (!existing) throw AppError.notFound('Order not found');
    if (existing.status !== 'cancelled') throw AppError.badRequest('This order can no longer be cancelled');
    // Resume an interrupted cancellation. Inventory/refund markers make
    // successful retries harmless, including a lost response to the client.
    claimed = existing;
  }
  const { carrierFailures } = await completeCancellation(claimed);
  return { order: claimed, carrierFailures };
}

/** Admin cancellation: same claim and completion, actor and reason in the notes. */
async function cancelByAdmin(idOrNumber, { reason, actor }) {
  const filter = orders.identityFilter(idOrNumber);
  const note = `[cancellation] Cancelled by ${actor}${reason ? `: ${reason}` : ''}`;
  let claimed = await orders.claimCancellation(filter);
  let resuming = false;
  if (!claimed) {
    const existing = await orders.findByIdentity(idOrNumber);
    if (!existing) throw AppError.notFound('Order not found');
    if (existing.status !== 'cancelled') {
      throw AppError.badRequest('This order has already shipped and can no longer be cancelled. Use a return instead.');
    }
    // Already cancelled. Only re-enter completion when the earlier
    // cancellation visibly did NOT finish. A completed cancellation is
    // final: re-running it re-sent the "cancelled" emails and appended a
    // second note (found on 25 Sep 2026).
    const pending = (existing.sellerShipments || []).some(
      (s) => isForward(s) && s.status !== 'cancelled' && /Cancellation not confirmed/i.test(s.lastError || ''),
    );
    if (existing.stockRestoredAt && !pending) throw AppError.badRequest('This order is already cancelled.');
    claimed = existing;
    resuming = true;
  }
  claimed.notes = [claimed.notes, resuming ? `${note} (completing an earlier cancellation)` : note]
    .filter(Boolean)
    .join('\n');
  const { carrierFailures } = await completeCancellation(claimed);
  return { order: claimed, carrierFailures };
}

module.exports = {
  ensureCancellationRefund,
  restoreCancelledStock,
  completeCancellation,
  cancelByCustomer,
  cancelByAdmin,
};
