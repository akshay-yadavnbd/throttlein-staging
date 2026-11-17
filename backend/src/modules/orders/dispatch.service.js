/**
 * Getting a seller's slice onto the carrier: the Shiprocket push (one order
 * per seller), the seller's retry, pickup booking, labels, courier options
 * and pre-pickup cancellation. Functions mutate the slice they are given and
 * leave saving to the caller unless they say otherwise.
 */
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const { sliceCharges } = require('../../utils/sliceCharges');
const shiprocket = require('../../infrastructure/shipping/shiprocket');
const inventory = require('./inventory.repository');
const parties = require('./parties.repository');
const carrier = require('./carrier');
const { isForward, anyForwardSliceFor, forwardSliceFor } = require('./order-state');

/**
 * Book (or re-book) the courier pickup for a slice that already has a label.
 * Shared by the seller's "Ship order" / "Book pickup again" and the admin's
 * "Reschedule pickup", so both leave the slice in the same state. Never
 * throws on a carrier refusal — the failure is recorded on `entry.pickupError`.
 */
async function rebookPickup(entry, { reschedule = false } = {}) {
  try {
    const pickupDate = reschedule ? carrier.nextPickupDate() : undefined;
    await shiprocket.schedulePickup({ shipment_id: entry.shipmentId, pickup_date: pickupDate });
    entry.pickupBookedAt = new Date();
    entry.pickupError = '';
    entry.lastError = '';
    if (reschedule) {
      // Reflect the booking immediately; the carrier's own scan replaces this.
      entry.currentStatus = 'PICKUP RESCHEDULED';
      entry.statusEventAt = new Date();
      entry.pickupScheduledAt = pickupDate ? new Date(pickupDate + 'T00:00:00+05:30') : new Date();
    }
    return { ok: true, pickupDate };
  } catch (e) {
    if (carrier.ALREADY_BOOKED.test(String(e.message || ''))) {
      entry.pickupBookedAt = entry.pickupBookedAt || new Date();
      entry.pickupError = '';
      return { ok: true, already: true };
    }
    entry.pickupError = String(e.message || 'Pickup scheduling failed').slice(0, 500);
    return { ok: false, error: entry.pickupError };
  }
}

/**
 * Push seller slices of an order to Shiprocket — one Shiprocket order per
 * seller, against that seller's pickup location. Never throws: failures are
 * recorded on the per-seller entry so the seller can retry.
 *
 * `opts.onlySeller` (audit A13) restricts the push to ONE seller's slice so
 * retrying seller A can never duplicate already-shipped seller B. Any seller
 * who ALREADY has a forward entry with a shipment id is skipped. Fee
 * allocation always runs across ALL slices — only the push loop is restricted.
 */
async function pushOrderToShiprocket(order, opts = {}) {
  if (order.status === 'cancelled' || order.fulfillmentHold) return;
  const onlySeller = opts.onlySeller ? String(opts.onlySeller) : null;
  const bySeller = new Map(); // sellerId -> { items, subtotal }
  for (const it of order.items) {
    if (!it.seller) continue;
    const k = String(it.seller);
    if (!bySeller.has(k)) bySeller.set(k, { items: [], subtotal: 0 });
    const entry = bySeller.get(k);
    entry.items.push(it);
    entry.subtotal += it.subtotal;
  }

  const sellers = await parties.sellersForDispatch([...bySeller.keys()]);
  const sellerById = new Map(sellers.map((v) => [String(v._id), v]));
  const profiles = await inventory.parcelProfiles(order.items.map((i) => i.product).filter(Boolean));

  order.sellerShipments = order.sellerShipments || [];

  const sa = order.shippingAddress;
  const { first: firstName, last: lastName } = carrier.splitName(sa?.fullName);

  /* Fee allocation (audit A11): each slice's share of the customer's shipping /
   * COD fees, so carrier collectibles sum to the order's payable total. */
  const charges = sliceCharges(order);
  const shippingAlloc = new Map([...charges].map(([k, c]) => [k, c.shipping]));
  const codFeeAlloc = new Map([...charges].map(([k, c]) => [k, c.codFee]));

  for (const [sellerId, slice] of bySeller) {
    if (onlySeller && sellerId !== onlySeller) continue;
    let existingSlice = forwardSliceFor(order, sellerId);
    if (existingSlice?.shipmentId || existingSlice?.status === 'cancelled') continue;
    // The external create may have succeeded before a timeout/crash. Retain
    // its reference for webhook recovery and surface it for reconciliation.
    if (existingSlice?.pushAttemptedAt) {
      existingSlice.status = 'failed';
      existingSlice.lastError =
        'Carrier creation outcome is uncertain. Reconcile the saved channel order reference before retrying.';
      continue;
    }
    if (!existingSlice) {
      order.sellerShipments.push({ seller: sellerId, status: 'queued' });
      existingSlice = order.sellerShipments[order.sellerShipments.length - 1];
    }
    const v = sellerById.get(sellerId);
    if (!v) {
      Object.assign(existingSlice, { status: 'failed', lastError: 'Seller not found' });
      continue;
    }
    const pickupNickname = v.kyc?.shiprocket?.pickupLocation || v.slug;
    if (!pickupNickname) {
      Object.assign(existingSlice, { status: 'failed', lastError: 'Seller pickup not synced to Shiprocket yet' });
      continue;
    }

    // Weight (kg, min 0.5) and the LARGEST dimension on each axis, so a
    // helmet in a stack of gloves isn't priced as a glove.
    const weightG = slice.items.reduce(
      (s, it) => s + inventory.profileFor(profiles, it.product).weightGrams * it.quantity,
      0,
    );
    const sliceDims = slice.items.reduce(
      (acc, it) => {
        const d = inventory.profileFor(profiles, it.product);
        return {
          length: Math.max(acc.length, d.length),
          breadth: Math.max(acc.breadth, d.breadth),
          height: Math.max(acc.height, d.height),
        };
      },
      { ...inventory.DEFAULT_DIMS },
    );

    const srOrderId = carrier.buildShiprocketOrderId(order.orderNumber);
    const address = carrier.clampShiprocketAddress(sa.line1, sa.line2);
    const payload = {
      order_id: srOrderId,
      order_date: carrier.carrierDate(order.createdAt),
      pickup_location: pickupNickname,
      billing_customer_name: firstName,
      billing_last_name: lastName,
      billing_address: address.a1,
      billing_address_2: address.a2,
      billing_city: sa.city || '',
      billing_pincode: String(sa.pincode || ''),
      billing_state: sa.state || '',
      billing_country: sa.country || 'India',
      billing_email: '', // filled below when we can resolve the customer
      billing_phone: carrier.digitsPhone(sa.phone),
      shipping_is_billing: true,
      order_items: carrier.carrierItems(slice.items),
      payment_method: order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
      shipping_charges: shippingAlloc.get(sellerId) || 0,
      giftwrap_charges: 0,
      transaction_charges: codFeeAlloc.get(sellerId) || 0,
      total_discount: 0,
      sub_total: slice.subtotal,
      length: sliceDims.length,
      breadth: sliceDims.breadth,
      height: sliceDims.height,
      weight: Math.max(0.5, weightG / 1000),
    };
    if (order.user) {
      const u = await parties.userEmail(order.user);
      payload.billing_email = u?.email || 'orders@throttlein.in';
    }

    // Write our reference BEFORE the carrier call so a crash mid-create is
    // reconcilable; preserve the slice identity and any prior confirmation.
    const pending = existingSlice;
    Object.assign(pending, { channelOrderId: srOrderId, status: 'queued', pushAttemptedAt: new Date() });
    await order.save({ timestamps: false });
    try {
      const resp = await shiprocket.createOrder(payload);
      if (!resp.order_id || !resp.shipment_id) throw new Error('Carrier did not return shipment identifiers');
      Object.assign(pending, {
        shiprocketOrderId: String(resp.order_id),
        shipmentId: String(resp.shipment_id),
        status: 'pushed',
        pushedAt: new Date(),
        lastError: '',
      });
    } catch (e) {
      pending.status = 'failed';
      pending.lastError =
        'Carrier creation was not confirmed. Reconcile channel order ' + srOrderId + ' before retrying.';
      logger.error(
        { err: e, orderId: String(order._id), channelOrderId: srOrderId },
        'shipping push: carrier creation not confirmed',
      );
    }
    await order.save({ timestamps: false });
  }
}

/**
 * Seller self-serve retry of a failed push. Wipes THIS seller's forward
 * entry only and pushes it again. Returns the resulting entry.
 */
async function retryPushForSeller(order, sellerId) {
  if (order.status === 'cancelled' || order.fulfillmentHold) {
    throw AppError.badRequest('This order is cancelled — nothing to push.');
  }
  const mine = anyForwardSliceFor(order, sellerId);
  if (mine?.status === 'cancelled' || mine?.stockRestoredAt) {
    throw AppError.conflict('This seller shipment was cancelled and cannot be recreated.');
  }
  if (mine?.pushAttemptedAt && !mine.shipmentId) {
    throw AppError.conflict('Shipment is awaiting reconciliation · contact support instead of retrying');
  }
  if (mine && mine.shipmentId && !['failed', 'cancelled'].includes(mine.status)) {
    throw AppError.badRequest(
      'Your shipment already exists on Shiprocket. Cancel it first if you need to re-create it.',
    );
  }
  // Drop only this seller's forward entry; keep other sellers' slices and return legs.
  order.sellerShipments = (order.sellerShipments || []).filter(
    (vs) => !(String(vs.seller) === String(sellerId) && isForward(vs)),
  );
  await pushOrderToShiprocket(order, { onlySeller: sellerId });
  await order.save({ timestamps: false });
  return anyForwardSliceFor(order, sellerId);
}

/** Shiprocket-hosted label PDF URL, cached on the slice after the first call. Saves the order. */
async function labelUrlFor(order, entry) {
  if (!entry?.shipmentId || !entry.awbCode) {
    throw AppError.badRequest('AWB not generated yet — click Ship & schedule pickup first.');
  }
  if (entry.labelUrl) return { url: entry.labelUrl, cached: true };
  const data = await shiprocket.generateLabel({ shipment_id: entry.shipmentId });
  const url = data?.label_url || data?.url || data?.data?.label_url;
  if (!url) throw AppError.internal('Shiprocket did not return a label URL. Try again in a moment.');
  entry.labelUrl = url;
  await order.save({ timestamps: false });
  return { url, cached: false };
}

/** Every courier that can carry this seller's parcel, with rates and ETAs (raw carrier data + context). */
async function courierOptionsFor(order, sellerId) {
  const seller = await parties.sellerPickupProfile(sellerId);
  const pickupPin = seller?.kyc?.pickupAddress?.pincode;
  const deliveryPin = order?.shippingAddress?.pincode;
  if (!pickupPin || !deliveryPin) throw AppError.badRequest('Missing pickup or delivery pincode.');
  const weightKg = await carrier.sliceWeightKg(order, sellerId);
  const data = await shiprocket.serviceability({
    pickup_pincode: pickupPin,
    delivery_pincode: deliveryPin,
    weight: weightKg,
    cod: order.paymentMethod === 'cod' ? 1 : 0,
  });
  return {
    data,
    weightKg,
    pickup: pickupPin,
    delivery: deliveryPin,
    preferredCourierId: seller?.kyc?.shiprocket?.preferredCourierId || null,
  };
}

/** Cancel a labelled shipment that the courier has not collected yet. Mutates the slice. */
async function cancelSliceAtCarrier(entry) {
  if (!entry?.awbCode) throw AppError.badRequest('No shipment to cancel — AWB has not been generated.');
  if (['shipped', 'delivered'].includes(entry.status)) {
    throw AppError.badRequest('Shipment already moved. Contact support if delivery needs to be reversed.');
  }
  try {
    await shiprocket.cancelShipmentByAwb(entry.awbCode);
  } catch (e) {
    throw AppError.badRequest(`Couldn't cancel: ${e.message}`);
  }
  entry.status = 'cancelled';
  entry.lastError = '';
}

module.exports = {
  rebookPickup,
  pushOrderToShiprocket,
  retryPushForSeller,
  labelUrlFor,
  courierOptionsFor,
  cancelSliceAtCarrier,
};
