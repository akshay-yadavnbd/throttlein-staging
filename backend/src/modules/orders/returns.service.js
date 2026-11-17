/**
 * Returns and exchanges: customer requests → seller decides → reverse
 * pickup → verification → refund raised or replacement shipped.
 */
const { AppError } = require('../../errors/AppError');
const parties = require('./parties.repository');
const carrier = require('./carrier');
const legs = require('./return-legs.service');
const notifications = require('./order-notifications');
const { forwardSliceFor, anyForwardSliceFor, firstSliceFor } = require('./order-state');

const { ownRequest } = require('./return-requests');

/* ── customer ─────────────────────────────────────────────────────────── */

/**
 * Customer submits a return / exchange request for one seller's slice.
 * Checked: delivered (per seller), inside the window snapshotted on the
 * line, no in-flight duplicate, line-based item selection capped by what
 * remains returnable. Returns the created request.
 */
async function createReturnRequest(order, userId, body) {
  const kind = String(body?.kind || '').toLowerCase();
  if (!['return', 'exchange'].includes(kind)) throw AppError.badRequest('kind must be "return" or "exchange"');

  let sellerId = body?.sellerId;
  if (!sellerId) {
    const distinct = [...new Set((order.items || []).map((it) => String(it.seller)))];
    if (distinct.length === 1) sellerId = distinct[0];
  }
  if (!sellerId) throw AppError.badRequest('sellerId is required for multi-seller orders.');
  const sellerItems = (order.items || []).filter((it) => String(it.seller) === String(sellerId));
  if (!sellerItems.length) throw AppError.badRequest("That seller doesn't have items in this order.");

  /* Delivery eligibility is PER SELLER (audit A19). */
  const mySlice = forwardSliceFor(order, sellerId);
  const sliceDeliveredAt =
    mySlice?.deliveredAt ||
    (mySlice?.status === 'delivered' ? order.deliveredAt || order.updatedAt : null) ||
    // Legacy orders with no per-slice data: order level, only when delivered.
    (order.status === 'delivered' ? order.deliveredAt || order.updatedAt : null);
  if (!sliceDeliveredAt) {
    throw AppError.badRequest(
      "This seller's items haven't been delivered yet — you can only return / exchange after delivery.",
    );
  }

  const seller = await parties.sellerLabel(sellerId);
  if (!seller) throw AppError.notFound('Seller not found');
  /* Policy from the ORDER LINE snapshot (audit A19) — the window the customer bought under. */
  const snapshot = sellerItems[0] || {};
  const allowedDays = kind === 'exchange' ? (snapshot.exchangePolicyDays ?? 7) : (snapshot.returnPolicyDays ?? 7);
  if (allowedDays === 0) {
    throw AppError.badRequest(
      `${seller.storeName || seller.name} doesn't accept ${kind === 'exchange' ? 'exchanges' : 'returns'}.`,
    );
  }
  const cutoff = new Date(new Date(sliceDeliveredAt).getTime() + allowedDays * 86400000);
  if (Date.now() > cutoff.getTime()) {
    throw AppError.badRequest(
      `${kind === 'exchange' ? 'Exchange' : 'Return'} window expired · ${allowedDays} day(s) after delivery`,
    );
  }

  // No duplicate IN-FLIGHT request for the same seller (completed / declined don't block).
  const dup = (order.returnRequests || []).find(
    (r) => String(r.seller) === String(sellerId) && ['pending', 'approved'].includes(r.status),
  );
  if (dup) throw AppError.badRequest('A request is already in progress for this seller on this order.');

  /* Item selection is LINE-BASED (audit A19). `orderItemId` preferred;
   * `product` (+ size/color) resolved to a single line. */
  const reqItems =
    Array.isArray(body?.items) && body.items.length
      ? body.items
      : sellerItems.map((it) => ({ orderItemId: it._id, quantity: it.quantity }));
  const remainingOf = (line) => Math.max(0, Number(line.quantity || 0) - Number(line.returnedQuantity || 0));

  const items = [];
  const usedLines = new Set();
  for (const raw of reqItems) {
    let line = null;
    if (raw?.orderItemId) line = sellerItems.find((li) => String(li._id) === String(raw.orderItemId));
    if (!line && raw?.product) {
      const candidates = sellerItems.filter((li) => String(li.product) === String(raw.product));
      const wantSize = raw.size != null ? String(raw.size).trim() : null;
      const wantColor = raw.color != null ? String(raw.color).trim() : null;
      const narrowed = candidates.filter(
        (li) =>
          (wantSize == null || String(li.size || '').trim() === wantSize) &&
          (wantColor == null || String(li.color || '').trim() === wantColor),
      );
      const pool = (narrowed.length ? narrowed : candidates).filter(
        (li) => !usedLines.has(String(li._id)) && remainingOf(li) > 0,
      );
      // An ambiguous product reference across DIFFERENT variants must be resolved by the client.
      const variants = new Set(pool.map((li) => `${li.size || ''}|${li.color || ''}`));
      if (variants.size > 1) {
        throw AppError.badRequest(
          `"${pool[0]?.name || 'This product'}" was ordered in several sizes/colours · pick the exact one`,
        );
      }
      line = pool[0] || null;
    }
    if (!line) continue;
    const key = String(line._id);
    if (usedLines.has(key)) continue;
    const remaining = remainingOf(line);
    if (remaining <= 0) continue;
    const qty = Math.max(1, Math.min(Number(raw?.quantity) || remaining, remaining));
    usedLines.add(key);
    items.push({
      orderItemId: line._id,
      product: line.product,
      name: line.name,
      size: line.size || '',
      color: line.color || '',
      price: line.price || 0,
      quantity: qty,
    });
  }
  if (!items.length) {
    throw AppError.badRequest('Pick at least one item to return — the selected items may already have been returned.');
  }

  // Only the shape the upload endpoint returned; cap to 6 to match multer.
  const rawAttachments = Array.isArray(body?.attachments) ? body.attachments : [];
  const attachments = rawAttachments
    .slice(0, 6)
    .map((a) => ({
      url: String(a?.url || ''),
      kind: a?.kind === 'video' ? 'video' : 'image',
      mimeType: String(a?.mimeType || '').slice(0, 100),
      sizeBytes: Number(a?.sizeBytes) || 0,
    }))
    .filter((a) => a.url);
  const { ownedPrivateKey } = require('../../utils/privateFiles');
  for (const attachment of attachments) {
    attachment.url = await ownedPrivateKey(attachment.url, userId, 'return-evidence');
  }

  // COD returns (not exchanges) carry the customer's refund destination for the manual transfer.
  const refundInfo =
    kind === 'return' && order.paymentMethod === 'cod'
      ? {
          customerRefundUpi: String(body?.refundUpi || '').slice(0, 100),
          customerRefundBankName: String(body?.refundBankName || '').slice(0, 100),
          customerRefundAccountNo: String(body?.refundAccountNo || '').slice(0, 30),
          customerRefundIfsc: String(body?.refundIfsc || '').slice(0, 20),
        }
      : {};

  order.returnRequests = order.returnRequests || [];
  order.returnRequests.push({
    seller: sellerId,
    kind,
    reason: String(body?.reason || '').slice(0, 1000),
    reasonCode: String(body?.reasonCode || '').slice(0, 50),
    desiredAction: String(body?.desiredAction || '').slice(0, 500),
    items,
    attachments,
    status: 'pending',
    requestedAt: new Date(),
    ...refundInfo,
  });
  await order.save({ timestamps: false });
  const created = order.returnRequests[order.returnRequests.length - 1];
  // After the save, not awaited: the customer's request must not hang on SMTP.
  notifications.notifyTeamReturnRequested(order, created);
  return created;
}

/** Customer cancels a pending request before the seller decides. */
async function cancelReturnRequest(order, reqId) {
  const r = (order.returnRequests || []).id(reqId);
  if (!r) throw AppError.notFound('Request not found');
  if (r.status !== 'pending') throw AppError.badRequest('Only pending requests can be cancelled.');
  r.status = 'cancelled';
  r.decisionAt = new Date();
  await order.save({ timestamps: false });
  return r;
}

/* ── seller ───────────────────────────────────────────────────────────── */

/**
 * Seller-initiated return of a delivered slice (no customer request):
 * reverse pickup for all or the named items. Returns `{ already, entryId, shiprocketOrderId }`.
 */
async function sellerCreateReturn(order, sellerId, body) {
  const forward = firstSliceFor(order, sellerId);
  if (!forward) throw AppError.badRequest('No forward shipment to return.');
  // Either signal that the customer has the parcel: slice delivered (webhook)
  // or order delivered (manual override / mock mode).
  if (!(forward.status === 'delivered' || order.status === 'delivered'))
    throw AppError.badRequest('Can only return delivered shipments.');
  const existingReturn = (order.sellerShipments || []).find(
    (vs) => vs.kind === 'return' && String(vs.returnOf) === String(forward._id),
  );
  if (existingReturn) return { already: true, entryId: existingReturn._id };

  const seller = await parties.sellerById(sellerId);
  if (!seller?.kyc?.shiprocket?.pickupLocation)
    throw AppError.badRequest('Your Shiprocket pickup is not synced — go to KYC and re-sync.');
  const sliceItems = (order.items || []).filter((it) => String(it.seller) === String(sellerId));
  const reqItems = body?.items;
  const lines =
    Array.isArray(reqItems) && reqItems.length
      ? sliceItems.filter((it) => reqItems.some((r) => String(r.product) === String(it.product)))
      : sliceItems;
  const items = carrier.carrierItems(lines, { qc: true });
  const { resp } = await legs.createReturnShipment({
    order,
    seller,
    forward,
    items,
    failureText: "Couldn't create return",
  });
  await order.save({ timestamps: false });
  return { already: false, shiprocketOrderId: resp.order_id };
}

/** Seller approves a customer request: reverse pickup scoped to the request's items. Returns the request. */
async function approveReturnRequest(order, sellerId, reqId) {
  const r = ownRequest(order, reqId, sellerId);
  if (r.status !== 'pending') throw AppError.badRequest(`Request already ${r.status}.`);
  const forward = anyForwardSliceFor(order, sellerId);
  const seller = await parties.sellerById(sellerId);
  if (!seller?.kyc?.shiprocket?.pickupLocation) {
    throw AppError.badRequest('Your Shiprocket pickup is not synced — visit KYC and re-sync before approving.');
  }
  const items = carrier.carrierItems(r.items || [], {
    qc: true,
    priceOf: (it) => order.items.find((oi) => String(oi.product) === String(it.product))?.price || 0,
  });
  const { entry } = await legs.createReturnShipment({
    order,
    seller,
    forward,
    items,
    failureText: "Couldn't create return on Shiprocket",
  });
  r.status = 'approved';
  r.decisionAt = new Date();
  r.returnShipmentEntryId = entry._id;
  await order.save({ timestamps: false });
  return r;
}

/** Seller declines; the reason goes back to the customer. */
async function declineReturnRequest(order, sellerId, reqId, reason) {
  const r = ownRequest(order, reqId, sellerId);
  if (r.status !== 'pending') throw AppError.badRequest(`Request already ${r.status}.`);
  const text = String(reason || '').trim();
  if (text.length < 5) throw AppError.badRequest('Please give the customer a reason (at least 5 characters).');
  r.status = 'declined';
  r.decisionReason = text.slice(0, 500);
  r.decisionAt = new Date();
  await order.save({ timestamps: false });
  return r;
}

const { verifyReturn, raiseRefund, shipReplacement } = require('./return-resolution.service');
module.exports = {
  createReturnRequest,
  cancelReturnRequest,
  sellerCreateReturn,
  approveReturnRequest,
  declineReturnRequest,
  verifyReturn,
  raiseRefund,
  shipReplacement,
};
