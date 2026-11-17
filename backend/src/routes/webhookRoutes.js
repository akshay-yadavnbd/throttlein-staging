/**
 * Shiprocket POST /api/hooks/tin-shipment. Configure x-api-key in Shiprocket.
 * Auth/body limits run before parsing in src/app.js; auth is also enforced here
 * so mounting this router elsewhere cannot accidentally expose status writes.
 */
const express = require('express');
const asyncHandler = require('express-async-handler');
const { authenticateShipmentWebhook } = require('../middleware/shipmentWebhookSecurity');
const { enqueueShipmentEvent, processShipmentEvent } = require('../modules/orders');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');
const { AppError } = require('../errors/AppError');
const router = express.Router();
router.post('/razorpay', require('../modules/orders').razorpayWebhook);
router.get('/tin-shipment', (req, res) => res.json({ ok: true }));

async function handleShipmentWebhook(req, res) {
  // Auth runs again here so mounting this router elsewhere cannot expose status writes.
  let refusal = null;
  authenticateShipmentWebhook(req, res, (err) => {
    refusal = err || null;
  });
  if (refusal) throw refusal;
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw AppError.badRequest('Webhook payload must be a JSON object.', { reason: 'invalid-payload' });
  }
  if (!(
    body.awb ||
    body.awb_code ||
    body.order_id ||
    body.order_number ||
    body.sr_order_id ||
    body.shipment_id ||
    body.sr_shipment_id
  )) {
    throw AppError.badRequest('Webhook payload names no shipment.', { reason: 'shipment-identifier-required' });
  }
  const event = await enqueueShipmentEvent(body);
  // Debugging retains useful counts without logging customer/provider payloads.
  if (env.WEBHOOK_DEBUG) {
    logger.info('[shiprocket-webhook] accepted %s', { eventId: String(event._id), scans: event.payload.scans.length });
  }
  if (event.state === 'completed') return res.json({ ok: true, duplicate: true });
  // Best effort immediate application. The worker retries durable pending events,
  // including events that arrived before an external-create response was saved.
  try {
    const result = await processShipmentEvent(event._id);
    return res.json({ ok: true, ...(result || { queued: true }) });
  } catch {
    return res.json({ ok: true, queued: true });
  }
}
router.post('/tin-shipment', asyncHandler(handleShipmentWebhook));
module.exports = router;
module.exports.handleShipmentWebhook = handleShipmentWebhook;
module.exports._internals = require('../modules/orders').shipmentStatus;
