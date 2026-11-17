/**
 * Re-derive order-level status from each order's per-seller shipments.
 *
 * WHY
 * The old flow flipped an order to `shipped` as soon as an AWB was
 * generated, treating "label printed, courier booked" as "parcel on its
 * way". It isn't: the carrier still reports PICKUP SCHEDULED and the
 * parcel is physically with the seller. Orders written under that
 * behaviour carry a `shipped` status (and a `shippedAt`) they haven't
 * earned.
 *
 * The live code now derives the aggregate from the slices
 * (`deriveOrderAggregate`), so new orders are correct and any courier
 * scan re-derives an old one. This script fixes the stored value without
 * waiting for a scan.
 *
 * WHAT IT CHANGES
 * Only `status`, and `shippedAt` when the new status is no longer
 * shipped/delivered. Cancelled orders are skipped outright — that state
 * is terminal and must never be recomputed away. Nothing else on the
 * order is touched.
 *
 * USAGE
 *   node src/utils/recomputeOrderStatus.js            # dry run (default)
 *   node src/utils/recomputeOrderStatus.js --apply    # write changes
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Order = require('../src/modules/orders/order.model');
const { deriveOrderAggregate } = require('../src/modules/orders');
const { env } = require('../src/config/env');

const APPLY = process.argv.includes('--apply');

async function run() {
  const mongoUri = env.MONGO_URI || env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Missing MONGO_URI in .env');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  console.log(APPLY ? 'MODE: apply (writing changes)\n' : 'MODE: dry run — pass --apply to write\n');

  const orders = await Order.find({ status: { $ne: 'cancelled' } });
  let changed = 0;

  for (const order of orders) {
    const before = order.status;
    const beforeShippedAt = order.shippedAt;
    deriveOrderAggregate(order);
    if (order.status === before) continue;

    // A status that is no longer shipped/delivered shouldn't keep a
    // dispatch timestamp it never earned.
    if (!['shipped', 'delivered'].includes(order.status) && order.shippedAt) {
      order.shippedAt = undefined;
    }
    const slices =
      (order.sellerShipments || [])
        .filter((s) => (s.kind || 'forward') === 'forward' && !s.returnOf)
        .map((s) => s.status)
        .join(', ') || 'none';
    console.log(
      `  ${order.orderNumber}: ${before} → ${order.status}   [slices: ${slices}]` +
        (beforeShippedAt && !order.shippedAt ? '  (cleared shippedAt)' : ''),
    );
    if (APPLY) await order.save({ timestamps: false });
    changed += 1;
  }

  console.log(`\n${APPLY ? 'Updated' : 'Would update'} ${changed} of ${orders.length} order(s).`);
  if (!APPLY && changed > 0) console.log('Re-run with --apply to write these changes.');
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Recompute failed:', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
