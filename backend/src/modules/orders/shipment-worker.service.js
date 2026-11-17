/**
 * The shipment worker (SHIPMENT_WORKER_ENABLED): every 5s it drains the
 * carrier-event inbox, pushes one waiting order to Shiprocket, and refreshes
 * one order's tracking. All three claim their work with a durable lease.
 */
const shipments = require('./shipments.repository');
const { withFulfillmentLock } = require('./orders.repository');
const { pushOrderToShiprocket } = require('./dispatch.service');
const { processShipmentEvent, refreshShipment, syncShipmentFromOrderDetails } = require('./shipment-sync.service');
const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');
const TERMINAL = new Set(['delivered', 'returned', 'cancelled', 'rto_delivered', 'lost']);

async function runShipmentCycle() {
  for (let i = 0; i < 25; i++) {
    if (!(await processShipmentEvent())) break;
  }
  // Claim scheduling with a durable lease by moving the next eligible time.
  const push = await shipments.claimNextPush(120000);
  if (push) {
    try {
      await withFulfillmentLock(push._id, async () => {
        const fresh = await shipments.orderById(push._id);
        if (!fresh || fresh.status === 'cancelled' || fresh.fulfillmentHold) return;
        await pushOrderToShiprocket(fresh);
        // Failed creates stay visible in the existing failed-pushes queue.
        fresh.shippingPushPending = false;
        await fresh.save({ timestamps: false });
      });
    } catch {
      logger.warn('[shipping-worker] dispatch deferred %s', String(push._id));
    }
  }

  // A missing webhook is repaired by a read-only carrier call. Two cases:
  //   a) slice has an AWB → track by AWB (scans, status, ETD);
  //   b) slice was pushed to Shiprocket but has NO AWB in our DB → read the
  //      Shiprocket order back. This is how an AWB assigned from the
  //      Shiprocket panel (rather than the seller portal) reaches the DB, so
  //      admin / seller / customer stop showing "New" for a booked parcel.
  // Recent terminal parcels stay included to capture RTO/corrections.
  const row = await shipments.claimNextTracking([...TERMINAL], 5 * 60000);
  if (row) {
    let failed = false;
    for (const entry of row.sellerShipments) {
      try {
        if (entry.awbCode) await refreshShipment(row._id, entry);
        else if (entry.shiprocketOrderId && ['queued', 'pushed'].includes(entry.status)) {
          await syncShipmentFromOrderDetails(row._id, entry);
        }
      } catch {
        failed = true;
      }
    }
    // Parcels that have all reached a terminal state are re-checked far less
    // often (6h instead of 5min) — we only keep watching them for a week to
    // catch a late RTO/correction, not to hammer the carrier for a parcel
    // that already arrived.
    const after = await shipments.shipmentStatuses(row._id);
    const active = (after?.sellerShipments || []).filter((e) => e.awbCode);
    const allTerminal = active.length > 0 && active.every((e) => TERMINAL.has(e.status));
    // Nothing booked yet anywhere on this order (seller hasn't shipped and the
    // panel shows NEW): re-check every 30 min rather than every 5 — the
    // moment an AWB appears, the slice moves onto the 5-min tracking cadence.
    const nothingBooked = active.length === 0;
    await shipments.setTracking(row._id, {
      trackingLastError: failed ? 'Carrier sync delayed; retry scheduled' : '',
      ...(!failed && allTerminal ? { trackingNextAt: new Date(Date.now() + 6 * 3600000) } : {}),
      ...(!failed && nothingBooked ? { trackingNextAt: new Date(Date.now() + 30 * 60000) } : {}),
    });
  }
}

function startShipmentWorker() {
  if (!env.SHIPMENT_WORKER_ENABLED) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runShipmentCycle();
    } catch {
      logger.error('[shipping-worker] cycle failed; durable jobs retained for retry');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
module.exports = { runShipmentCycle, startShipmentWorker };
