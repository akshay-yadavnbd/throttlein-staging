/**
 * Carrier (Shiprocket) shipment events → order state. Webhooks land in a
 * durable inbox first; events are applied under the order's fulfilment lock
 * and retried with backoff until their shipment exists. A missing webhook is
 * repaired by reading the carrier back (tracking by AWB, or the Shiprocket
 * order when the AWB was booked from its panel).
 */
const crypto = require('crypto');
const shipments = require('./shipments.repository');
const { withFulfillmentLock } = require('./orders.repository');
const { deriveOrderAggregate } = require('./order-state');
const shiprocket = require('../../infrastructure/shipping/shiprocket');
const {
  applyShipmentEvent,
  sanitizeShipmentEvent,
  trackingToEvent,
  orderDetailsToEvent,
} = require('./shipment-status');
const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');

/**
 * Events that never find an order (Shiprocket's "Test Webhook" sample, a
 * parcel from another channel on the same account, a typo'd reference) must
 * not retry forever. With the 5s·2^n backoff capped at 1h, ~200 attempts is
 * roughly eight days of retries — long enough to outlive any create-then-
 * webhook race, short enough that the inbox does not grow unbounded.
 */
const MAX_ATTEMPTS = Number(env.SHIPMENT_EVENT_MAX_ATTEMPTS) || 200;
const DEAD_RETENTION_MS = 30 * 86400000;
const DONE_RETENTION_MS = 90 * 86400000;

async function enqueueShipmentEvent(body) {
  const payload = sanitizeShipmentEvent(body);
  const eventKey = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  try {
    return await shipments.upsertEvent(eventKey, payload);
  } catch (error) {
    if (error.code !== 11000) throw error;
    return shipments.findEvent(eventKey);
  }
}

async function findTarget(body) {
  for (const [field, value] of [
    ['channelOrderId', body.order_id || body.order_number],
    ['shiprocketOrderId', body.sr_order_id],
    ['shipmentId', body.shipment_id || body.sr_shipment_id],
    ['awbCode', body.awb || body.awb_code],
  ]) {
    if (!value) continue;
    const order = await shipments.orderByShipment(field, value);
    const entry = order?.sellerShipments.find((s) => String(s[field] || '') === String(value));
    if (entry) return { orderId: order._id, entryId: entry._id };
  }
  return null;
}

async function ingestShipmentEvent(body, receivedAt, target) {
  const match = target || (await findTarget(body));
  if (!match) return { matched: false };
  // Every status writer uses this lock. `exclusive` — the carrier is a separate actor and must never
  // write inside a seller/admin action that is still in flight; on contention
  // the 409 propagates and the durable inbox retries the event.
  return withFulfillmentLock(
    match.orderId,
    async () => {
      const order = await shipments.orderById(match.orderId);
      const entry = order?.sellerShipments.id(match.entryId);
      if (!entry) return { matched: false };
      const result = applyShipmentEvent(entry, body, receivedAt);
      deriveOrderAggregate(order);
      await order.save({ timestamps: false });
      return { matched: true, ...result };
    },
    { exclusive: true },
  );
}

async function processShipmentEvent(id) {
  const now = new Date();
  const token = crypto.randomUUID();
  const event = await shipments.claimEvent(id, now, token, 120000);
  if (!event) return null;
  const owned = { _id: event._id, leaseToken: token };
  try {
    const result = await ingestShipmentEvent(event.payload, event.createdAt);
    if (!result.matched) throw new Error('Shipment not matched yet');
    await shipments.settleEvent(owned, {
      $set: {
        state: 'completed',
        completedAt: new Date(),
        lastError: '',
        expiresAt: new Date(Date.now() + DONE_RETENTION_MS),
      },
      $unset: { leaseToken: 1, leaseUntil: 1 },
    });
    return result;
  } catch (error) {
    const busy = error.status === 409;
    // Lock contention is not a failed attempt — the order exists, we just
    // lost a race — so it does not count toward the dead-letter cap.
    if (!busy && event.attempts >= MAX_ATTEMPTS) {
      await shipments.settleEvent(owned, {
        $set: {
          state: 'dead',
          lastError: 'Gave up: no matching shipment after ' + event.attempts + ' attempts',
          expiresAt: new Date(Date.now() + DEAD_RETENTION_MS),
        },
        $unset: { leaseToken: 1, leaseUntil: 1 },
      });
      logger.error(
        '[shipment-inbox] dead-lettered event %s %s %s',
        String(event._id),
        'order_id=' + (event.payload?.order_id || '-'),
        'awb=' + (event.payload?.awb || '-'),
      );
      return { matched: false, dead: true };
    }
    const update = {
      $set: {
        state: 'pending',
        lastError: busy ? 'Fulfilment busy' : 'Tracking update pending',
        nextAttemptAt: new Date(
          Date.now() + (busy ? 5000 : Math.min(3600000, 5000 * 2 ** Math.min(event.attempts, 10))),
        ),
      },
      $unset: { leaseToken: 1, leaseUntil: 1 },
    };
    if (busy) update.$inc = { attempts: -1 };
    await shipments.settleEvent(owned, update);
    return { matched: false, queued: true };
  }
}

async function refreshShipment(orderId, entry) {
  const data = await shiprocket.trackByAwb(entry.awbCode);
  const result = await ingestShipmentEvent(trackingToEvent(data, entry), new Date(), { orderId, entryId: entry._id });
  return { data, result };
}

/**
 * For a slice we created on Shiprocket that has no AWB in our DB: read the
 * order back from Shiprocket. If the AWB was assigned / pickup booked from
 * the Shiprocket panel (not through the seller portal), this is the only
 * way we learn the AWB, courier and current label — after which normal
 * webhook + tracking-by-AWB take over.
 */
async function syncShipmentFromOrderDetails(orderId, entry) {
  if (!entry.shiprocketOrderId) throw new Error('No Shiprocket order id to look up');
  const data = await shiprocket.getOrder(entry.shiprocketOrderId);
  const result = await ingestShipmentEvent(orderDetailsToEvent(data, entry), new Date(), {
    orderId,
    entryId: entry._id,
  });
  return { data, result };
}

module.exports = {
  enqueueShipmentEvent,
  processShipmentEvent,
  ingestShipmentEvent,
  refreshShipment,
  syncShipmentFromOrderDetails,
  MAX_ATTEMPTS,
};
