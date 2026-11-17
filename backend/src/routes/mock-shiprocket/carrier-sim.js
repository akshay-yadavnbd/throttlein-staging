/** Carrier simulation for local testing: fire a Shiprocket-shaped webhook, or mark a parcel delivered. */
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');
const { MOCK_BASE_URL } = require('./config');
const { findOrderByAwbOrShipment, sellerSlug, orderByFilter } = require('./lookups');

async function fireWebhook(req, res) {
  const awb = req.params.awb;
  // Look up the order to get the order_id we sent to Shiprocket.
  const found = await findOrderByAwbOrShipment(awb);
  if (!found) throw AppError.notFound('No order with that AWB.');

  const statusId = Number(req.body?.status_id || 7); // default to DELIVERED
  const status = String(req.body?.status || 'Delivered');
  const payload = {
    awb,
    order_id: found.shipment?.shiprocketOrderId
      ? `${found.order.orderNumber}-${(await sellerSlug(found.shipment.seller))?.slug || 'seller'}`
      : '',
    current_status: status,
    current_status_id: statusId,
    shipment_status_id: statusId,
    is_return: (found.shipment.kind || 'forward') === 'return',
    etd: new Date(Date.now() + 86400000).toISOString(),
    scans: req.body?.scans || [
      {
        date: new Date().toISOString(), // explicit UTC — zone-less dates are read as IST
        status,
        activity: `MOCK fired: ${status}`,
        location: 'Dev console',
      },
    ],
  };

  // Self-fetch to the webhook route. Use the configured backend base.
  const url = `${MOCK_BASE_URL}/api/hooks/tin-shipment`;
  const headers = { 'Content-Type': 'application/json' };
  if (env.SHIPROCKET_WEBHOOK_TOKEN) {
    headers['x-api-key'] = env.SHIPROCKET_WEBHOOK_TOKEN;
  }
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    /** @type {any} */
    const data = await r.json().catch(() => ({}));
    res.json({ ok: true, fired: payload, webhookResponse: data });
  } catch (e) {
    throw AppError.upstream(`Mock webhook self-fetch failed: ${e.message}`);
  }
}

/**
 * POST /api/mock/shipment/:orderId/:entryId/simulate-delivery
 *
 * Dev helper that flips a specific sellerShipments entry to "delivered" and
 * appends a synthetic delivery scan. Useful for walking returns/exchanges
 * through the verify → refund step without waiting for an actual Shiprocket
 * webhook (which never fires in mock mode anyway).
 *
 * Behaviour mirrors what the real webhook handler would do, scoped to one
 * shipment. The seller's order detail page then unlocks "Mark verified".
 */

async function simulateDelivery(req, res) {
  // Accept either an ObjectId or our human orderNumber. Guard the _id
  // branch — passing a non-hex string straight into $or causes Mongoose to
  // throw CastError ("Cast to ObjectId failed for value …") even though
  // the alternative branch would have matched.
  const raw = String(req.params.orderId);
  const isObjectId = /^[a-f0-9]{24}$/i.test(raw);
  const filter = isObjectId
    ? { $or: [{ _id: raw }, { orderNumber: raw.toUpperCase() }] }
    : { orderNumber: raw.toUpperCase() };
  const order = await orderByFilter(filter);
  if (!order) throw AppError.notFound('Order not found.');
  const entry = order.sellerShipments.id(req.params.entryId);
  if (!entry) throw AppError.notFound('Shipment entry not found.');

  // `daysAgo` (query or body) backdates the delivery so a tester can put a
  // parcel into LAST week and exercise the settlement flow today.
  const daysAgo = Math.max(0, Math.min(365, Number(req.query.daysAgo ?? req.body?.daysAgo) || 0));
  const now = new Date(Date.now() - daysAgo * 86400000);
  entry.status = entry.kind === 'return' ? 'delivered' : 'delivered';
  entry.currentStatus = 'Delivered';
  entry.currentStatusId = 7;
  // The payout pages group parcels by the slice's own deliveredAt (the
  // real webhook sets it in services/shipmentStatus) — mirror that here.
  entry.deliveredAt = entry.deliveredAt || now;
  entry.statusEventAt = now;
  entry.scans = entry.scans || /** @type {any} */ ([]);
  entry.scans.push({
    date: now,
    status: 'Delivered',
    statusId: 7,
    activity:
      entry.kind === 'return' ? 'MOCK: Return parcel delivered to seller pickup' : 'MOCK: Parcel delivered to customer',
    location: 'Mock courier hub',
  });
  // For the forward leg, also flip the order-level status so the customer
  // sees "delivered" without a manual mark.
  if (entry.kind === 'forward' && !entry.returnOf && order.status === 'shipped') {
    order.status = 'delivered';
    order.deliveredAt = order.deliveredAt || now;
  }
  await order.save({ timestamps: false });
  res.json({ ok: true, entryStatus: entry.status });
}

module.exports = { fireWebhook, simulateDelivery };
