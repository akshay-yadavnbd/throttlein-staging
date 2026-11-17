#!/usr/bin/env node
/**
 * Fill `sellerShipments[].courierCharge` for parcels shipped before charges
 * were captured at ship time. Reads each Shiprocket order
 * (GET /orders/show/:id — read-only) and takes the freight + COD charge
 * from its shipment record. Nothing else on the order changes, and a
 * parcel that already has a charge is left alone.
 *
 * Usage (from backend/, with REAL Shiprocket keys in .env):
 *   node scripts/backfill-courier-charges.js            # dry run, prints what it found
 *   node scripts/backfill-courier-charges.js --apply
 *   node scripts/backfill-courier-charges.js --apply TIN-2026-000018   # one order
 *   node scripts/backfill-courier-charges.js --raw      # also print Shiprocket's charge object
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Order = require('../src/modules/orders/order.model');
const shiprocket = require('../src/infrastructure/shipping/shiprocket');
const { payoutMath: payouts } = require('../src/modules/payouts');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RAW = args.includes('--raw');
const ONLY = args.find((a) => /^TIN-/i.test(a));

/** Shiprocket nests charges under awb_data.charges on the order-detail response. */
function chargeFrom(detail) {
  const d = detail?.data || detail || {};
  const sh = Array.isArray(d.shipments) ? d.shipments[0] : d.shipments;
  const awb = d.awb_data || sh?.awb_data || {};
  const c = awb.charges || sh?.charges || d.charges || {};
  const got = payouts.courierChargeFromAwb({ charges: c });
  const raw = { shipment: sh, awb_data: Object.keys(awb).length ? awb : undefined, topKeys: Object.keys(d) };
  if (!got) return { charge: null, raw };
  return { charge: { ...got, source: 'shiprocket-order', note: 'Backfilled from Shiprocket order detail' }, raw };
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
  if (String(process.env.SHIPROCKET_MOCK_MODE).toLowerCase() === 'true')
    throw new Error('SHIPROCKET_MOCK_MODE is on — this needs the real Shiprocket account.');
  await mongoose.connect(process.env.MONGO_URI);
  const filter = {
    sellerShipments: { $elemMatch: { awbCode: { $ne: '' }, 'courierCharge.total': { $exists: false } } },
  };
  if (ONLY) filter.orderNumber = ONLY.toUpperCase();
  const orders = await Order.find(filter).select('orderNumber sellerShipments').sort({ createdAt: 1 });
  console.log(`${orders.length} order(s) with a shipped parcel and no courier charge`);
  let done = 0,
    skipped = 0;
  for (const o of orders) {
    let changed = false;
    for (const s of o.sellerShipments || []) {
      if (!s.awbCode || (s.courierCharge && Number.isFinite(s.courierCharge.total))) continue;
      if (!s.shiprocketOrderId) {
        console.log(`  ${o.orderNumber}: no Shiprocket order id on the parcel`);
        skipped += 1;
        continue;
      }
      let detail;
      try {
        detail = await shiprocket.getOrder(s.shiprocketOrderId);
      } catch (e) {
        console.log(`  ${o.orderNumber} (${s.awbCode}): Shiprocket lookup failed — ${e.message}`);
        skipped += 1;
        continue;
      }
      const { charge, raw } = chargeFrom(detail);
      if (RAW) console.log(`  ${o.orderNumber} raw:\n${JSON.stringify(raw, null, 2)}`);
      if (!charge) {
        console.log(
          `  ${o.orderNumber} (${s.awbCode}): Shiprocket returned no freight charge yet (billed after pickup) — run --raw to see the object`,
        );
        skipped += 1;
        continue;
      }
      console.log(
        `  ${o.orderNumber} (${s.awbCode}, ${s.awbCourier || 'courier'}): freight ₹${charge.freight} + COD ₹${charge.cod} = ₹${charge.total}`,
      );
      if (APPLY) {
        s.courierCharge = charge;
        changed = true;
      }
    }
    if (changed) {
      await o.save({ timestamps: false });
      done += 1;
    }
  }
  console.log(APPLY ? `\nUpdated ${done} order(s), skipped ${skipped}.` : `\nDry run — re-run with --apply to write.`);
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
