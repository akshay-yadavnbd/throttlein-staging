/**
 * Non-Delivery Reports and the handover manifest — the two carrier views a
 * seller works from after labels exist.
 */
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const shiprocket = require('../../infrastructure/shipping/shiprocket');
const orders = require('./orders.repository');
const { isForward, AWAITING_HANDOVER } = require('./order-state');

/** Seller's answer to a Non-Delivery Report. Mutates the slice; caller saves. */
async function respondToNdr(entry, { action, comments, addressOverride }) {
  if (!entry?.awbCode) throw AppError.badRequest('No AWB on this shipment.');
  const ovr = addressOverride || {};
  try {
    await shiprocket.ndrAction({
      awb: entry.awbCode,
      action,
      comments: String(comments || '').slice(0, 500),
      ...(ovr.address
        ? {
            name: ovr.name,
            phone: ovr.phone,
            address: ovr.address,
            address_2: ovr.address_2,
            city: ovr.city,
            state: ovr.state,
            pincode: ovr.pincode,
            country: ovr.country || 'India',
          }
        : {}),
    });
  } catch (e) {
    throw AppError.badRequest(`NDR action failed: ${e.message}`);
  }
  entry.ndrLastAction = action;
  entry.ndrLastActionAt = new Date();
  if (action === 'return') entry.status = 'rto_initiated';
}

/** Shiprocket's account-wide NDR list, filtered to this seller's AWBs. */
async function ndrListFor(sellerId, page) {
  const data = await shiprocket.listNdr({ page: page || 1, per_page: 50 });
  const all = data?.data || data?.results || [];
  const myOrders = await orders.ordersWithShipmentsFor(sellerId);
  const awbToOrder = new Map();
  for (const o of myOrders) {
    for (const s of o.sellerShipments || []) {
      if (String(s.seller) === String(sellerId) && s.awbCode) {
        awbToOrder.set(s.awbCode, { orderNumber: o.orderNumber, shippingAddress: o.shippingAddress });
      }
    }
  }
  return all
    .filter((row) => awbToOrder.has(row.awb || row.awb_code))
    .map((row) => {
      const awb = row.awb || row.awb_code;
      const meta = awbToOrder.get(awb) || {};
      return {
        awb,
        orderNumber: meta.orderNumber,
        courier: row.courier_name,
        reason: row.ndr_reason || row.reason || '',
        attempts: row.attempt || row.attempts || 0,
        lastAttemptAt: row.last_action_date || row.created_at || null,
        customer: meta.shippingAddress?.fullName || '',
      };
    });
}

/**
 * Manifest PDF for the parcels this seller still has to hand over: labelled
 * and not yet collected, whenever they were labelled. Three-tier discovery
 * so a benign carrier answer never surfaces as a red error:
 *   1. generate; 2. print (already generated / 200 without URL); 3. friendly `{ ok:false }`.
 */
async function manifestFor(sellerId) {
  const myOrders = await orders.pushedOrdersFor(sellerId);
  const shipmentIds = [];
  const shiprocketOrderIds = [];
  for (const o of myOrders) {
    for (const s of o.sellerShipments || []) {
      if (String(s.seller) !== String(sellerId) || !isForward(s) || !s.awbCode || !AWAITING_HANDOVER.has(s.status))
        continue;
      shipmentIds.push(s.shipmentId);
      if (s.shiprocketOrderId) shiprocketOrderIds.push(s.shiprocketOrderId);
    }
  }
  if (!shipmentIds.length) return { ok: false, reason: 'nothing-to-hand-over' };

  let url = '';
  let originalMessage = '';
  let usedFallback = false;
  const tryPrintFallback = async (labelForLog) => {
    if (shiprocketOrderIds.length === 0) return;
    try {
      const data = await shiprocket.printManifest({ order_ids: shiprocketOrderIds });
      url = data?.manifest_url || data?.data?.manifest_url || '';
      usedFallback = true;
    } catch (e) {
      logger.error({ err: e, attempt: labelForLog }, 'shiprocket: printManifest fallback failed');
    }
  };

  try {
    const data = await shiprocket.generateManifest({ shipment_id: shipmentIds });
    url = data?.manifest_url || data?.data?.manifest_url || '';
    if (!url) {
      logger.warn(
        { shipmentIds },
        'shiprocket: generateManifest returned 200 but no manifest_url; trying printManifest',
      );
      await tryPrintFallback('empty-url');
    }
  } catch (err) {
    originalMessage = String(err?.message || '');
    if (/already generated/i.test(originalMessage)) await tryPrintFallback('already-generated');
  }

  if (!url) {
    return {
      ok: false,
      reason: /already generated/i.test(originalMessage)
        ? 'already-generated'
        : usedFallback
          ? 'no-manifest-url'
          : 'shiprocket-error',
      message:
        originalMessage ||
        "Shiprocket didn't return a manifest URL. Try again in a minute — if it keeps failing, check the Shiprocket dashboard for today's manifest.",
    };
  }
  return { ok: true, url, count: shipmentIds.length };
}

module.exports = { respondToNdr, ndrListFor, manifestFor };
