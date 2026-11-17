/** Resolving a returned parcel: seller verification (restock + auto refund), raising the refund, and shipping a replacement. */
const { AppError } = require('../../errors/AppError');
const orders = require('./orders.repository');
const inventory = require('./inventory.repository');
const parties = require('./parties.repository');
const legs = require('./return-legs.service');
const notifications = require('./order-notifications');
const { ownRequest, matchLine } = require('./return-requests');

/**
 * Seller inspects the returned parcel. `ok:true` restocks (once, in the same
 * transaction as the marker) and auto-raises the refund for returns;
 * `ok:false` records a failed verification. Returns the response body.
 */
async function verifyReturn(idOrNumber, sellerId, reqId, body) {
  return orders.runInTransaction(async (session) => {
    const order = await orders.findForSellerInSession(idOrNumber, sellerId, session);
    if (!order) throw AppError.notFound('Order not found');
    const r = ownRequest(order, reqId, sellerId);
    if (r.status !== 'approved')
      throw AppError.badRequest('Return must be approved (and parcel received) before verification.');
    const retEntry = (order.sellerShipments || []).find((s) => String(s._id) === String(r.returnShipmentEntryId));
    if (!retEntry) throw AppError.badRequest('Return shipment not found on this order.');
    if (!['delivered', 'returned'].includes(retEntry.status)) {
      throw AppError.badRequest(
        "Parcel hasn't been received yet. Verify only after Shiprocket marks the return delivered.",
      );
    }
    const okFlag = body?.ok !== false; // default true unless explicitly false
    retEntry.verifiedAt = new Date();
    retEntry.verifiedOk = okFlag;
    retEntry.verificationNotes = String(body?.notes || '').slice(0, 500);
    if (okFlag) retEntry.status = 'returned';

    // The once-only marker and the exact inventory movement commit together.
    if (okFlag && r.kind === 'return' && !retEntry.restockedAt) {
      const restored = [];
      for (const ri of r.items || []) {
        const orig =
          order.items.find((oi) => ri.orderItemId && String(oi._id) === String(ri.orderItemId)) ||
          order.items.find(
            (oi) =>
              String(oi.product) === String(ri.product) &&
              (oi.size || '') === (ri.size || '') &&
              (oi.color || '') === (ri.color || ''),
          );
        const quantity = Number(ri.quantity);
        if (
          !orig ||
          !Number.isSafeInteger(quantity) ||
          quantity <= 0 ||
          quantity > orig.quantity - (orig.returnedQuantity || 0)
        ) {
          throw AppError.conflict('Returned quantity exceeds the purchased quantity.');
        }
        orig.returnedQuantity = (orig.returnedQuantity || 0) + quantity;
        const reservation = order.stockReservations?.find(
          (line) =>
            String(line.product) === String(orig.product) &&
            (line.size || '') === (orig.size || '') &&
            (line.color || '') === (orig.color || ''),
        );
        restored.push({
          product: orig.product,
          quantity,
          size: orig.size || '',
          color: orig.color || '',
          variantApplied: reservation ? reservation.variantApplied : Boolean(orig.size || orig.color),
        });
      }
      await inventory.releaseStock(restored, session);
      retEntry.restockedAt = new Date();
    }

    // Returns that verify OK raise the refund automatically (exchanges and
    // failed verifications don't). Priced from the LINE's own snapshot (audit A19).
    let refundAutoRaised = false;
    let refundAmount = 0;
    if (okFlag && r.kind === 'return' && (!r.refundStatus || r.refundStatus === 'not-requested')) {
      refundAmount = (r.items || []).reduce((s, ri) => {
        const orig = matchLine(order, ri);
        const unit = Number(ri.price) || Number(orig?.price) || 0;
        return s + unit * (ri.quantity || 0);
      }, 0);
      r.refundStatus = 'requested';
      r.refundAmount = refundAmount;
      r.refundMethod = order.paymentMethod === 'online' ? 'razorpay' : 'manual';
      r.refundRequestedAt = new Date();
      refundAutoRaised = true;
    }

    await order.save({ session, timestamps: false });
    return {
      ok: true,
      verifiedOk: okFlag,
      refundAutoRaised,
      refundAmount,
      message: !okFlag
        ? 'Marked as failed verification.'
        : refundAutoRaised
          ? `Verified — refund of ₹${refundAmount} raised with admin.`
          : 'Marked verified.',
    };
  });
}

/** Seller raises the refund for a verified return; it lands in the admin queue. Returns the amount. */
async function raiseRefund(order, sellerId, reqId, raisedBy) {
  const r = ownRequest(order, reqId, sellerId);
  if (r.kind !== 'return')
    throw AppError.badRequest('Refunds only apply to returns. Exchanges resolve via replacement shipment.');
  if (r.refundStatus && r.refundStatus !== 'not-requested')
    throw AppError.badRequest(`Refund already ${r.refundStatus}.`);
  const retEntry = (order.sellerShipments || []).find((s) => String(s._id) === String(r.returnShipmentEntryId));
  if (!retEntry?.verifiedAt) throw AppError.badRequest('Verify the returned parcel before raising a refund.');
  if (retEntry.verifiedOk === false)
    throw AppError.badRequest("You marked this return as failing verification — admin can't refund.");

  // Sum of returned items' subtotals, priced from the order's own snapshot.
  const refundAmount = (r.items || []).reduce((s, ri) => {
    const orig =
      (order.items || []).find((oi) => ri.orderItemId && String(oi._id) === String(ri.orderItemId)) ||
      (order.items || []).find(
        (oi) =>
          String(oi.product) === String(ri.product) &&
          (oi.size || '') === (ri.size || '') &&
          (oi.color || '') === (ri.color || ''),
      );
    return s + (orig ? (orig.price || 0) * (ri.quantity || 0) : 0);
  }, 0);

  r.refundStatus = 'requested';
  r.refundAmount = refundAmount;
  r.refundMethod = order.paymentMethod === 'online' ? 'razorpay' : 'manual';
  r.refundRequestedAt = new Date();
  await order.save({ timestamps: false });
  notifications.notifyTeamRefundRaised(order, r, refundAmount, raisedBy);
  return refundAmount;
}

/**
 * Exchange: ship the replacement. Only on an approved request whose return
 * parcel was received and accepted (audit A20); the replacement units are
 * reserved before dispatch with the same conditional decrement as checkout.
 * Returns `{ awbCode, awbCourier }`.
 */
async function shipReplacement(order, sellerId, reqId, body) {
  const r = ownRequest(order, reqId, sellerId);
  if (r.kind !== 'exchange') throw AppError.badRequest('ship-replacement is only valid on exchange requests.');
  if (r.replacementShipmentEntryId)
    throw AppError.badRequest('Replacement shipment already created for this exchange.');
  if (r.status !== 'approved')
    throw AppError.badRequest(`This exchange is "${r.status}" — approve it before shipping a replacement.`);
  const retEntry = (order.sellerShipments || []).find((s) => String(s._id) === String(r.returnShipmentEntryId));
  if (!retEntry?.verifiedAt || retEntry.verifiedOk !== true) {
    throw AppError.badRequest(
      "Verify the returned parcel first — a replacement can only ship after you've received and accepted the original item.",
    );
  }

  const replacementLines = (r.items || []).map((it) => {
    const orig =
      (order.items || []).find((oi) => it.orderItemId && String(oi._id) === String(it.orderItemId)) ||
      (order.items || []).find((oi) => String(oi.product) === String(it.product));
    return {
      product: it.product,
      name: it.name || orig?.name || 'Replacement item',
      // A size/colour swap is the whole point of most exchanges.
      size: String(it.replacementSize ?? it.size ?? orig?.size ?? '').trim(),
      color: String(it.replacementColor ?? it.color ?? orig?.color ?? '').trim(),
      quantity: Number(it.quantity) || 1,
    };
  });
  const seller = await parties.sellerById(sellerId);
  if (!seller?.kyc?.shiprocket?.pickupLocation)
    throw AppError.badRequest('Your Shiprocket pickup is not synced — re-sync from KYC before shipping.');
  if (!r.replacementStockReservedAt) {
    const committed = await orders.runInTransaction(async (session) => {
      const fresh = await orders.findByIdInSession(order._id, session);
      const request = fresh.returnRequests.id(r._id);
      if (!request.replacementStockReservedAt) {
        const reserved = await inventory.reserveStock(replacementLines, session);
        if (!reserved.ok) throw AppError.conflict('The replacement item is out of stock.');
        request.replacementStockReservedAt = new Date();
        await fresh.save({ session, timestamps: false });
      }
      return fresh;
    });
    r.replacementStockReservedAt = committed.returnRequests.id(r._id).replacementStockReservedAt;
    order.__v = committed.__v;
  }

  const items = (r.items || []).map((it) => {
    const orig = (order.items || []).find((oi) => String(oi.product) === String(it.product));
    return {
      name: String(it.name || orig?.name || 'Replacement item').slice(0, 100),
      sku: it.product ? String(it.product) : `SKU-${Math.random().toString(36).slice(2, 8)}`,
      units: it.quantity || 1,
      selling_price: orig?.price || 0,
      discount: 0,
      tax: 0,
      hsn: 0,
    };
  });
  const { entry, awbCode, awbCourier } = await legs.createReplacementShipment({
    order,
    seller,
    request: r,
    items,
    courierId: Number(body?.courier_id) || undefined,
  });
  r.replacementShipmentEntryId = entry._id;
  await order.save({ timestamps: false });
  return { awbCode, awbCourier };
}

module.exports = { verifyReturn, raiseRefund, shipReplacement };
