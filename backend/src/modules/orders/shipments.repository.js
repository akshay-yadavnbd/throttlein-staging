/**
 * Shipment tracking queries: the durable carrier-event inbox and the
 * worker's claims on orders. Claims move a "next attempt" time forward as a
 * lease, so two workers never take the same order or event.
 */
const Order = require('./order.model');
const ShipmentEvent = require('./shipment-event.model');

/* ── carrier event inbox ──────────────────────────────────────────────── */

/** Insert-once by content hash; a duplicate delivery returns the existing event. */
const upsertEvent = (eventKey, payload) =>
  ShipmentEvent.findOneAndUpdate(
    { eventKey },
    {
      $setOnInsert: { eventKey, payload, state: 'pending', nextAttemptAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' },
  );
const findEvent = (eventKey) => ShipmentEvent.findOne({ eventKey });

/** Lease the next due event (or a specific one): pending, or processing whose lease expired. */
const claimEvent = (id, now, token, leaseMs) =>
  ShipmentEvent.findOneAndUpdate(
    {
      ...(id ? { _id: id } : {}),
      nextAttemptAt: { $lte: now },
      $or: [{ state: 'pending' }, { state: 'processing', leaseUntil: { $lte: now } }],
    },
    {
      $set: { state: 'processing', leaseToken: token, leaseUntil: new Date(Date.now() + leaseMs) },
      $inc: { attempts: 1 },
    },
    { returnDocument: 'after', sort: { nextAttemptAt: 1 } },
  );

/** Only the lease holder (`{ _id, leaseToken }`) may write the outcome. */
const settleEvent = (owned, update) => ShipmentEvent.updateOne(owned, update);

/* ── orders ───────────────────────────────────────────────────────────── */

/** The order whose shipment slice carries `field = value` (channel order id, Shiprocket ids or AWB). */
const orderByShipment = (field, value) => Order.findOne({ [`sellerShipments.${field}`]: String(value) });
const orderById = (id) => Order.findById(id);

/** Lease the next order waiting for its Shiprocket push (not cancelled, not on hold). */
const claimNextPush = (leaseMs) =>
  Order.findOneAndUpdate(
    {
      shippingPushPending: true,
      status: { $ne: 'cancelled' },
      fulfillmentHold: { $in: ['', null] },
      shippingPushNextAt: { $lte: new Date() },
    },
    { $set: { shippingPushNextAt: new Date(Date.now() + leaseMs) } },
    { sort: { shippingPushNextAt: 1 } },
  );

/**
 * Lease the next order due a tracking check: a slice with an AWB that is not
 * terminal (or turned terminal in the last week, or never synced), or a slice
 * pushed to Shiprocket without an AWB in our database.
 */
const claimNextTracking = (terminal, leaseMs) =>
  Order.findOneAndUpdate(
    {
      $or: [{ trackingNextAt: { $lte: new Date() } }, { trackingNextAt: { $exists: false } }],
      status: { $ne: 'cancelled' },
      sellerShipments: {
        $elemMatch: {
          $or: [
            {
              awbCode: { $gt: '' },
              $or: [
                { status: { $nin: terminal } },
                { statusEventAt: { $gte: new Date(Date.now() - 7 * 86400000) } },
                { trackingSyncedAt: { $exists: false } },
              ],
            },
            { awbCode: { $in: ['', null] }, shiprocketOrderId: { $gt: '' }, status: { $in: ['queued', 'pushed'] } },
          ],
        },
      },
    },
    { $set: { trackingNextAt: new Date(Date.now() + leaseMs) } },
    { returnDocument: 'after', sort: { trackingNextAt: 1 } },
  );

const shipmentStatuses = (orderId) => Order.findById(orderId).select('sellerShipments.awbCode sellerShipments.status');
const setTracking = (orderId, set) => Order.updateOne({ _id: orderId }, { $set: set });

module.exports = {
  upsertEvent,
  findEvent,
  claimEvent,
  settleEvent,
  orderByShipment,
  orderById,
  claimNextPush,
  claimNextTracking,
  shipmentStatuses,
  setTracking,
};
