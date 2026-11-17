#!/usr/bin/env node
/**
 * Put a wrongly-cancelled order back in flight, matching what Shiprocket
 * actually holds.
 *
 * Why this exists: a failed pickup left the seller with only one button —
 * "Cancel shipment". On a PAID order that cancels the AWB, restores stock
 * AND raises a refund with admin. If the seller then rebooks the parcel in
 * the Shiprocket panel, our record and reality diverge: we say cancelled and
 * owe a refund, the courier says a new AWB is out for pickup. `cancelled` is
 * a terminal state in services/shipmentStatus.js, so no webhook can ever
 * reconcile that on its own — it takes this.
 *
 * What it does, all of it reversing one seller-side cancellation:
 *   1. reads the live Shiprocket order and adopts its CURRENT awb /
 *      shipment id / courier (never a hardcoded number),
 *   2. sets the slice back to `awb` (label exists, not yet collected),
 *   3. re-deducts the stock that the cancellation put back,
 *   4. withdraws the cancellation's refund request,
 *   5. recomputes the order-level status.
 *
 * Refuses when the refund is already processing or paid — money that has
 * moved is not something a script should quietly undo.
 *
 * Usage (from backend/, real Shiprocket keys in .env):
 *   node scripts/resume-cancelled-order.js TIN-2026-000019
 *   node scripts/resume-cancelled-order.js TIN-2026-000019 --apply
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Order = require('../src/modules/orders/order.model');
const Product = require('../src/modules/products/product.model');
const shiprocket = require('../src/infrastructure/shipping/shiprocket');
const orderCtrl = require('../src/modules/orders');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ORDER_NO = (args.find((a) => /^TIN-/i.test(a)) || '').toUpperCase();

const line = (s = '') => console.log(s);

/** Current shipment facts from Shiprocket's order detail. */
function liveShipment(detail) {
  const d = detail?.data || detail || {};
  const sh = Array.isArray(d.shipments) ? d.shipments[0] : d.shipments;
  return {
    awb: String(sh?.awb || d.awb_data?.awb || '').trim(),
    shipmentId: sh?.id ? String(sh.id) : '',
    courier: String(sh?.courier || sh?.courier_name || '').trim(),
    courierId: Number(sh?.courier_id) || undefined,
    status: String(sh?.status || d.status || '').trim(),
    pickupScheduledDate: sh?.pickup_scheduled_date || '',
  };
}

/**
 * Does our carrier narrative still describe this parcel?
 *
 * True when the AWB has been replaced (the scans belong to a number that no
 * longer exists) or when our status simply contradicts Shiprocket's — which
 * is what a stale "PICKUP EXCEPTION" over a freshly scheduled pickup is.
 */
function staleNarrative(slice, live) {
  if (slice.awbCode !== live.awb) return true;
  const ours = String(slice.currentStatus || '')
    .trim()
    .toUpperCase();
  const theirs = String(live.status || '')
    .trim()
    .toUpperCase();
  return Boolean(theirs) && ours !== theirs;
}

async function main() {
  if (!ORDER_NO) throw new Error('Pass an order number, e.g. TIN-2026-000019');
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
  if (String(process.env.SHIPROCKET_MOCK_MODE).toLowerCase() === 'true') {
    throw new Error('SHIPROCKET_MOCK_MODE is on — this must read the real Shiprocket account.');
  }
  await mongoose.connect(process.env.MONGO_URI);

  const order = await Order.findOne({ orderNumber: ORDER_NO });
  if (!order) throw new Error(`${ORDER_NO} not found`);

  /* Prefer a cancelled parcel, but accept any forward one: a half-finished
   * run (slice resumed, order still cancelled) has to be completable. */
  const forward = (order.sellerShipments || []).filter((s) => (s.kind || 'forward') === 'forward' && !s.returnOf);
  const slice = forward.find((s) => s.status === 'cancelled') || (forward.length === 1 ? forward[0] : null);
  if (!slice)
    throw new Error(
      forward.length
        ? 'Several forward parcels here and none cancelled — resolve this one by hand.'
        : 'No forward parcel on this order.',
    );

  const sellerId = String(slice.seller);
  const refund = (order.returnRequests || []).find((r) => r.kind === 'cancellation' && String(r.seller) === sellerId);

  // ── Guard: never unwind money that has already moved ────────────────
  if (refund && ['processing', 'completed'].includes(refund.refundStatus)) {
    throw new Error(
      `The refund for this order is already ${refund.refundStatus}. ` +
        'Resuming would mean the customer keeps both the goods and the money — settle that with admin first.',
    );
  }

  if (!slice.shiprocketOrderId) throw new Error('The parcel has no Shiprocket order id to read.');
  const live = liveShipment(await shiprocket.getOrder(slice.shiprocketOrderId));
  if (!live.awb) throw new Error('Shiprocket has no AWB on this order — rebook the pickup there first.');

  line(`${ORDER_NO} — seller ${sellerId}`);
  line('');
  line('  field            ours (now)                 Shiprocket (live)');
  line(`  awb              ${(slice.awbCode || '—').padEnd(26)} ${live.awb}`);
  line(`  shipment id      ${(slice.shipmentId || '—').padEnd(26)} ${live.shipmentId || '—'}`);
  line(`  courier          ${(slice.awbCourier || '—').padEnd(26)} ${live.courier || '—'}`);
  line(`  status           ${'cancelled'.padEnd(26)} ${live.status || '—'}`);
  line('');
  line('  will change:');
  line(`    slice status       ${slice.status} → awb`);
  if (live.awb !== slice.awbCode) line(`    awb                ${slice.awbCode} → ${live.awb}`);
  if (live.shipmentId && live.shipmentId !== String(slice.shipmentId))
    line(`    shipment id        ${slice.shipmentId} → ${live.shipmentId}`);
  if (slice.pickupError) line(`    pickupError        cleared ("${String(slice.pickupError).slice(0, 60)}…")`);
  line(`    pickupBookedAt     ${slice.pickupBookedAt ? 'kept' : 'set (Shiprocket says pickup is scheduled)'}`);
  if (staleNarrative(slice, live)) {
    /* The scans and "current status" on file describe the AWB being
     * replaced — the last of them is the very pickup failure that caused
     * all this. Carried over, they keep the parcel reading "Pickup failed"
     * under a tracking number that is actually scheduled. On a resume
     * Shiprocket is the authority on where the parcel is, so anything of
     * ours that disagrees with it is history, not news. */
    line(
      `    carrier history    cleared (${(slice.scans || []).length} scans + "${slice.currentStatus || '—'}" → "${live.status || 'none'}")`,
    );
  }

  const mine = (order.items || []).filter((it) => String(it.seller) === sellerId);
  if (slice.stockRestoredAt) {
    line(`    stock              re-deducted: ${mine.map((i) => `${i.name} ×${i.quantity}`).join(', ')}`);
  } else {
    line('    stock              untouched (cancellation never restored it)');
  }
  if (refund) line(`    refund request     withdrawn (₹${refund.refundAmount}, currently "${refund.refundStatus}")`);
  line(
    `    order status       ${order.status} → recomputed${order.status === 'cancelled' ? ' (cancelled flag cleared first)' : ''}`,
  );
  line('');

  if (!APPLY) {
    line('Dry run — re-run with --apply to write.');
    await mongoose.disconnect();
    return;
  }

  // ── Apply, in the order that keeps the record consistent if it fails ──
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const fresh = await Order.findById(order._id).session(session);
      const s = (fresh.sellerShipments || []).find((x) => String(x._id) === String(slice._id));
      if (!s) throw new Error('The parcel changed underneath us — re-run the dry run.');

      // Stock first: if this throws, the order is still cancelled and honest.
      if (s.stockRestoredAt) {
        for (const it of mine) {
          const inc = { stock: -it.quantity };
          const options = { session };
          if (it.size || it.color) {
            inc['variants.$[v].stock'] = -it.quantity;
            options.arrayFilters = [{ 'v.size': it.size || '', 'v.color': it.color || '' }];
          }
          await Product.updateOne({ _id: it.product }, { $inc: inc }, options);
        }
        s.stockRestoredAt = undefined;
      }

      // Drop our stale narrative and adopt Shiprocket's.
      if (staleNarrative(s, live)) {
        s.scans = [];
        s.currentStatus = live.status || '';
        s.currentStatusId = undefined;
        s.statusEventAt = new Date();
        s.trackingSyncedAt = undefined;
      }
      s.status = 'awb';
      s.awbCode = live.awb;
      if (live.shipmentId) s.shipmentId = live.shipmentId;
      if (live.courier) s.awbCourier = live.courier;
      if (live.courierId) s.awbCourierId = live.courierId;
      s.pickupError = '';
      s.lastError = '';
      if (!s.pickupBookedAt) s.pickupBookedAt = new Date();

      if (refund) {
        fresh.returnRequests = (fresh.returnRequests || []).filter(
          (r) => !(r.kind === 'cancellation' && String(r.seller) === sellerId),
        );
      }
      // Order-level marker, else a later genuine cancellation is a no-op.
      if (fresh.stockRestoredAt) fresh.stockRestoredAt = undefined;

      /* deriveOrderAggregate refuses to touch a cancelled order — "terminal,
       * never resurrect" — which is right for every normal code path and
       * exactly what this script exists to override. Clear the terminal
       * state first so the derivation can read the slices honestly. */
      if (fresh.status === 'cancelled') {
        fresh.status = 'placed';
        fresh.cancelledAt = undefined;
      }
      orderCtrl.deriveOrderAggregate(fresh);
      await fresh.save({ session, timestamps: false });
    });
  } finally {
    await session.endSession();
  }

  const after = await Order.findById(order._id).lean();
  const s2 = (after.sellerShipments || []).find((x) => String(x._id) === String(slice._id));
  line(
    `Done. slice=${s2.status} awb=${s2.awbCode} order=${after.status} refundRequests=${(after.returnRequests || []).length}`,
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
