/**
 * The extra carrier legs of a return or exchange: the reverse pickup
 * (customer → seller) and the forward replacement. Both append a
 * sellerShipments entry and leave saving to the caller.
 */
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const shiprocket = require('../../infrastructure/shipping/shiprocket');
const carrier = require('./carrier');

/**
 * Create the reverse-pickup order on Shiprocket and append a kind:"return"
 * entry linked to the forward slice. `items` are carrierItems with qc.
 */
async function createReturnShipment({ order, seller, forward, items, failureText }) {
  if (!items.length) throw AppError.badRequest('Nothing to return.');
  const sa = order.shippingAddress || {};
  const sellerAddr = seller?.kyc?.pickupAddress || {};
  const sub = items.reduce((s, it) => s + it.selling_price * it.units, 0);
  const srOrderId = carrier.buildShiprocketOrderId(order.orderNumber, 'RTN');
  const envelope = await carrier.parcelEnvelope(items);
  const name = carrier.splitName(sa.fullName);

  let resp;
  try {
    resp = await shiprocket.createReturnOrder({
      order_id: srOrderId,
      order_date: carrier.carrierDate(),
      // Customer is the pickup source for a return
      pickup_customer_name: name.first,
      pickup_last_name: name.last,
      pickup_address: sa.line1 || '',
      pickup_address_2: sa.line2 || '',
      pickup_city: sa.city,
      pickup_state: sa.state,
      pickup_country: sa.country || 'India',
      pickup_pincode: String(sa.pincode || ''),
      pickup_phone: carrier.digitsPhone(sa.phone),
      // Seller is the delivery destination for a return
      shipping_customer_name: seller.storeName || seller.name,
      shipping_address: sellerAddr.line1 || '',
      shipping_address_2: sellerAddr.line2 || '',
      shipping_city: sellerAddr.city,
      shipping_state: sellerAddr.state,
      shipping_country: sellerAddr.country || 'India',
      shipping_pincode: String(sellerAddr.pincode || ''),
      shipping_phone: carrier.digitsPhone(sellerAddr.contactPhone || seller.phone),
      shipping_email: sellerAddr.contactEmail || seller.email,
      order_items: items,
      payment_method: 'Prepaid',
      sub_total: sub,
      length: envelope.length,
      breadth: envelope.breadth,
      height: envelope.height,
      weight: envelope.weight,
    });
  } catch (e) {
    throw AppError.badRequest(`${failureText}: ${e.message}`);
  }

  order.sellerShipments.push({
    seller: seller._id,
    kind: 'return',
    returnOf: forward?._id,
    // Audit A15: exact external reference + AWB so courier callbacks for the
    // reverse leg can actually match this entry.
    channelOrderId: srOrderId,
    shiprocketOrderId: String(resp.order_id || ''),
    shipmentId: String(resp.shipment_id || ''),
    awbCode: String(resp.awb_code || resp.awb || ''),
    status: 'return_pickup',
    pushedAt: new Date(),
    lastError: '',
  });
  return { resp, entry: order.sellerShipments[order.sellerShipments.length - 1] };
}

/**
 * Forward replacement leg for an exchange, with an immediate AWB attempt.
 * Appends a kind:"forward" entry carrying returnOf.
 */
async function createReplacementShipment({ order, seller, request, items, courierId }) {
  const pickupNickname = seller?.kyc?.shiprocket?.pickupLocation;
  if (!pickupNickname)
    throw AppError.badRequest('Your Shiprocket pickup is not synced — re-sync from KYC before shipping.');
  const sa = order.shippingAddress || {};
  const sub = items.reduce((s, it) => s + it.selling_price * it.units, 0);
  const srOrderId = carrier.buildShiprocketOrderId(order.orderNumber, 'RPL');
  const envelope = await carrier.parcelEnvelope(items);
  const name = carrier.splitName(sa.fullName);
  const address = carrier.clampShiprocketAddress(sa.line1, sa.line2);

  let resp;
  try {
    resp = await shiprocket.createOrder({
      order_id: srOrderId,
      order_date: carrier.carrierDate(),
      pickup_location: pickupNickname,
      billing_customer_name: name.first,
      billing_last_name: name.last,
      billing_address: address.a1,
      billing_address_2: address.a2,
      billing_city: sa.city,
      billing_state: sa.state,
      billing_country: sa.country || 'India',
      billing_pincode: String(sa.pincode || ''),
      billing_phone: carrier.digitsPhone(sa.phone),
      billing_email: sa.email || seller.email,
      shipping_is_billing: true,
      order_items: items,
      payment_method: 'Prepaid', // replacement is never charged again
      sub_total: sub,
      length: envelope.length,
      breadth: envelope.breadth,
      height: envelope.height,
      weight: envelope.weight,
    });
  } catch (e) {
    throw AppError.badRequest(`Couldn't create replacement shipment: ${e.message}`);
  }

  let awbCode = '',
    awbCourier = '',
    awbCourierId;
  try {
    const awbData = carrier.awbPayload(
      await shiprocket.generateAwb({ shipment_id: resp.shipment_id, courier_id: courierId }),
    );
    awbCode = String(awbData?.awb_code || awbData?.awb || '');
    awbCourier = String(awbData?.courier_name || '');
    awbCourierId = Number(awbData?.courier_company_id) || undefined;
    if (awbCode) await shiprocket.schedulePickup({ shipment_id: resp.shipment_id }).catch(() => {});
  } catch (e) {
    // AWB not assigned now — seller can hit ship endpoint again later.
    logger.warn({ err: e }, 'replacement AWB assign failed');
  }

  order.sellerShipments.push({
    seller: seller._id,
    kind: 'forward', // replacement is a forward leg to the customer
    returnOf: request.returnShipmentEntryId, // back-reference to the original return
    channelOrderId: srOrderId,
    shiprocketOrderId: String(resp.order_id || ''),
    shipmentId: String(resp.shipment_id || ''),
    awbCode,
    awbCourier,
    awbCourierId,
    status: awbCode ? 'awb' : 'pushed',
    pushedAt: new Date(),
  });
  return { entry: order.sellerShipments[order.sellerShipments.length - 1], awbCode, awbCourier };
}

module.exports = { createReturnShipment, createReplacementShipment };
