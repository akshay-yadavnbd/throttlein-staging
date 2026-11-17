#!/usr/bin/env node
/**
 * One-off repair for two side-effects of an API probe run on 25 Sep 2026
 * during the UX-audit smoke pass (Claude, admin account info@noseberry.com).
 *
 *   TIN-2026-000016  POST /admin/orders/:id/cancel was called on an order
 *                    that was ALREADY cancelled (7 Jul). The handler's
 *                    "resume an interrupted cancellation" path re-ran the
 *                    completion: it appended a note, restored stock for the
 *                    two items a second time (the July cancellation had
 *                    already restored aggregate stock under the old flow),
 *                    and re-sent the "cancelled" customer + team emails.
 *                    → remove the note; take 1 back off each product's
 *                      stock; keep stockRestoredAt so it can't run again.
 *
 *   TIN-2026-000019  POST /admin/orders/:id/reschedule-pickup was called
 *                    without a sellerId. Shiprocket refused ("Invalid
 *                    Status for pickup generation") and the refusal was
 *                    written to the slice's pickupError, which the seller
 *                    now sees as a problem banner.
 *                    → clear pickupError (it was empty before).
 *
 * The handler bugs themselves are fixed in orderController.js (cancel now
 * refuses an order whose cancellation already completed; reschedule now
 * requires sellerId). This script only undoes the data.
 *
 * Usage (from backend/):
 *   node scripts/undo-probe-2026-09-25.js           # dry run
 *   node scripts/undo-probe-2026-09-25.js --apply   # write
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Order = require('../src/modules/orders/order.model');
const Product = require('../src/modules/products/product.model');

const APPLY = process.argv.includes('--apply');
const NOTE = '[cancellation] Cancelled by info@noseberry.com: probe';

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
  await mongoose.connect(process.env.MONGO_URI);

  // ── TIN-2026-000016 ────────────────────────────────────────────────
  const o16 = await Order.findOne({ orderNumber: 'TIN-2026-000016' });
  if (!o16) console.log('TIN-2026-000016: not found');
  else {
    const hasNote = (o16.notes || '').includes(NOTE);
    console.log(
      `TIN-2026-000016: status=${o16.status} probeNote=${hasNote} stockRestoredAt=${o16.stockRestoredAt?.toISOString() || '-'}`,
    );
    for (const it of o16.items || []) {
      const p = await Product.findById(it.product).select('name stock');
      console.log(
        `  ${p ? p.name.slice(0, 50) : it.product}: stock ${p?.stock} → ${p ? p.stock - it.quantity : '?'} (qty ${it.quantity})`,
      );
    }
    if (APPLY && hasNote) {
      o16.notes = (o16.notes || '')
        .split('\n')
        .filter((l) => l.trim() !== NOTE)
        .join('\n');
      await o16.save({ timestamps: false });
      for (const it of o16.items || []) {
        if (it.size || it.color) continue; // both items are plain SKUs; variant rows were never touched
        await Product.updateOne({ _id: it.product }, { $inc: { stock: -it.quantity } });
      }
      console.log('  → note removed, stock corrected');
    } else if (APPLY) {
      console.log('  → probe note already gone; nothing changed (stock NOT touched — run once only)');
    }
  }

  // ── TIN-2026-000019 ────────────────────────────────────────────────
  const o19 = await Order.findOne({ orderNumber: 'TIN-2026-000019' });
  if (!o19) console.log('TIN-2026-000019: not found');
  else {
    const slices = (o19.sellerShipments || []).filter((s) =>
      /Invalid Status for pickup generation/.test(s.pickupError || ''),
    );
    console.log(`TIN-2026-000019: ${slices.length} slice(s) carrying the probe's pickupError`);
    if (APPLY && slices.length) {
      for (const s of slices) s.pickupError = '';
      await o19.save({ timestamps: false });
      console.log('  → pickupError cleared');
    }
  }

  if (!APPLY) console.log('\nDry run — re-run with --apply to write. Run --apply ONCE.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
