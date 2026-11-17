/**
 * Assigning the AWB (the courier's tracking number) to a slice and booking
 * its pickup — the seller's "Ship" button — and switching courier before
 * pickup. Both mutate the slice; the first leaves saving to the caller, the
 * second saves under the order's fulfilment lock.
 */
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const shiprocket = require('../../infrastructure/shipping/shiprocket');
const { payoutMath: payouts } = require('../payouts');
const orders = require('./orders.repository');
const parties = require('./parties.repository');
const carrier = require('./carrier');
const { rebookPickup } = require('./dispatch.service');

/** Walk every plausible location for Shiprocket's buried failure reason. */
function awbFailureReason(awbResp, awbData) {
  const reasons = [];
  const push = (v) => {
    if (!v) return;
    if (typeof v === 'string') reasons.push(v);
    else if (Array.isArray(v)) reasons.push(...v.filter(Boolean).map(String));
    else if (typeof v === 'object') for (const k of Object.keys(v)) push(v[k]);
  };
  push(awbResp?.message);
  push(awbResp?.errors);
  push(awbResp?.response?.message);
  push(awbResp?.response?.data?.message);
  push(awbResp?.response?.data?.awb_assign_error);
  push(awbResp?.response?.errors);
  push(awbData?.message);
  push(awbData?.errors);
  push(awbData?.error);
  push(awbData?.awb_assign_error);
  const unique = [...new Set(reasons.map((r) => String(r).trim()).filter(Boolean))];
  return (
    unique.join(' · ') ||
    `Shiprocket returned no AWB and no reason. Raw response: ${JSON.stringify(awbResp).slice(0, 300)}`
  );
}

/** The response body for the seller's screen after a ship / cached-ship. */
function shipOutcome(entry, { cached }) {
  return {
    ok: true,
    ...(cached ? { cached: true } : {}),
    awbCode: entry.awbCode,
    awbCourier: entry.awbCourier,
    status: entry.status,
    // Audit A14: the client must tell "label ready, courier booked" from
    // "label ready, booking FAILED".
    pickupBooked: Boolean(entry.pickupBookedAt),
    pickupError: entry.pickupError || '',
  };
}

/**
 * Assign an AWB to the seller's slice and book the pickup. Mutates `entry`
 * (saving the order only on the failure paths it reports) and returns the
 * response body. Pre-conditions, guarded by the caller: order live, forward
 * entry present, shipment id known, no AWB yet.
 */
async function assignAwbAndBookPickup(order, entry, { sellerId, courierId }) {
  let chosenCourierId = courierId;
  let awbResp;
  try {
    awbResp = await shiprocket.generateAwb({ shipment_id: entry.shipmentId, courier_id: chosenCourierId });
    logger.info(
      { shipmentId: entry.shipmentId, courierId: chosenCourierId || 'auto', response: awbResp },
      'shiprocket: AWB response',
    );
  } catch (e) {
    entry.lastError = `AWB failed: ${e.message}`.slice(0, 500);
    await order.save({ timestamps: false });
    throw AppError.badRequest(entry.lastError);
  }

  const awbData = carrier.awbPayload(awbResp);
  let awbCode = String(awbData?.awb_code || awbData?.awb || '');
  let awbCourier = String(awbData?.courier_name || awbData?.courier || '');

  /* The AWB was already assigned from the Shiprocket panel and our DB never
   * heard about it: "AWB is already assigned with awb - 1091402613664 and
   * status - PICKUP GENERATED". Not a failure — adopt it, fill the courier
   * from the order detail, and carry on to pickup scheduling. */
  if (!awbCode) {
    const already = JSON.stringify(awbResp || '').match(/already assigned with awb\s*-?\s*([A-Z0-9]+)/i);
    if (already) {
      awbCode = already[1];
      try {
        const detail = await shiprocket.getOrder(entry.shiprocketOrderId);
        const d = detail?.data || detail;
        const sh = Array.isArray(d?.shipments) ? d.shipments[0] : d?.shipments;
        awbCourier = String(sh?.courier || sh?.courier_name || '');
        if (!chosenCourierId && sh?.courier_id) chosenCourierId = Number(sh.courier_id) || undefined;
      } catch {
        /* courier name arrives with the first tracking event instead */
      }
      logger.info({ awbCode, shipmentId: entry.shipmentId }, 'shiprocket: adopted panel-assigned AWB');
    }
  }

  if (!awbCode) {
    entry.lastError = `AWB failed: ${awbFailureReason(awbResp, awbData)}`.slice(0, 500);
    await order.save({ timestamps: false });
    throw AppError.badRequest(entry.lastError);
  }

  entry.awbCode = awbCode;
  entry.awbCourier = awbCourier;
  entry.awbCourierId = Number(awbData?.courier_company_id || awbData?.courier_id || chosenCourierId) || undefined;

  // What this parcel costs us — feeds the seller's payout. The AWB payload
  // normally carries the charges; when it doesn't (panel-assigned AWB, mock
  // mode), price the chosen courier from serviceability. Never blocks shipping.
  entry.courierCharge = payouts.courierChargeFromAwb(awbData) || undefined;
  if (!entry.courierCharge && entry.awbCourierId) {
    try {
      const seller = await parties.sellerPickupPincode(sellerId);
      const pickupPin = seller?.kyc?.pickupAddress?.pincode;
      const deliveryPin = order?.shippingAddress?.pincode;
      if (pickupPin && deliveryPin) {
        const svc = await shiprocket.serviceability({
          pickup_pincode: pickupPin,
          delivery_pincode: deliveryPin,
          weight: await carrier.sliceWeightKg(order, sellerId),
          cod: order.paymentMethod === 'cod' ? 1 : 0,
        });
        const row = (svc?.data?.available_courier_companies || []).find(
          (c) => Number(c.courier_company_id) === Number(entry.awbCourierId),
        );
        entry.courierCharge = payouts.courierChargeFromRate(row) || undefined;
      }
    } catch (e) {
      logger.warn({ err: e, orderNumber: order.orderNumber }, 'payouts: courier charge lookup failed');
    }
  }

  // Pickup is tracked separately from the AWB (audit A14): a failure is a
  // PARTIAL result, and the same action retries pickup-only next time.
  try {
    await shiprocket.schedulePickup({ shipment_id: entry.shipmentId });
    entry.pickupBookedAt = new Date();
    entry.pickupError = '';
  } catch (e) {
    if (carrier.ALREADY_BOOKED.test(String(e.message || ''))) {
      entry.pickupBookedAt = entry.pickupBookedAt || new Date();
      entry.pickupError = '';
    } else {
      entry.pickupError = String(e.message || 'Pickup scheduling failed').slice(0, 500);
      entry.lastError = `Pickup schedule failed: ${e.message}`.slice(0, 500);
    }
  }

  entry.status = 'awb';
  entry.lastError = entry.pickupError ? entry.lastError : '';
  // Generating a label implies the seller acknowledged the slice.
  entry.confirmedAt = entry.confirmedAt || new Date();
  return shipOutcome(entry, { cached: false });
}

/**
 * Pre-pickup courier switch + re-booking (the seller's "Book pickup again").
 * An AWB is bound to its courier, so switching cancels the old one first.
 * Ordered so a failure is always recoverable: if the new assignment fails
 * the slice is left with no label and says so. Runs under the order's
 * fulfilment lock and saves the order.
 */
async function switchCourierAndRebook(order, entry, wanted) {
  const switching = wanted > 0 && wanted !== Number(entry.awbCourierId);
  return orders.withFulfillmentLock(order._id, async () => {
    if (switching) {
      const previous = { awb: entry.awbCode, courier: entry.awbCourier, courierId: entry.awbCourierId };
      try {
        await shiprocket.cancelShipmentByAwb(entry.awbCode);
      } catch (e) {
        return {
          ok: false,
          error: `Couldn't release the current ${previous.courier || 'courier'} booking: ${e.message}`,
        };
      }
      entry.awbCode = '';
      entry.awbCourier = '';
      entry.awbCourierId = undefined;
      entry.status = 'pushed';

      let awbResp;
      try {
        awbResp = await shiprocket.generateAwb({ shipment_id: entry.shipmentId, courier_id: wanted });
      } catch (e) {
        entry.lastError = `AWB failed: ${e.message}`.slice(0, 500);
        return {
          ok: false,
          error: `The ${previous.courier || 'old'} booking was released but the new courier refused: ${e.message}. Pick a courier again.`,
        };
      }
      const awbData = carrier.awbPayload(awbResp);
      const code = String(awbData?.awb_code || awbData?.awb || '');
      if (!code) {
        entry.lastError = 'AWB failed: courier did not return a tracking number';
        return { ok: false, error: 'The new courier did not return a tracking number. Pick a courier again.' };
      }
      entry.awbCode = code;
      entry.awbCourier = String(awbData?.courier_name || '');
      entry.awbCourierId = Number(awbData?.courier_company_id) || wanted;
      entry.status = 'awb';
      entry.lastError = '';
      // The new courier's own bill replaces the old one for settlements.
      entry.courierCharge = payouts.courierChargeFromAwb(awbData) || entry.courierCharge;
    }

    const booked = await rebookPickup(entry, { reschedule: true });
    await order.save({ timestamps: false });
    return { ...booked, switched: switching, awb: entry.awbCode, courier: entry.awbCourier };
  });
}

module.exports = { assignAwbAndBookPickup, shipOutcome, switchCourierAndRebook };
