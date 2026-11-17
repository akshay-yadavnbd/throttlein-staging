#!/usr/bin/env node
/**
 * Fill `order.gatewayFee` for online orders paid before fees were captured.
 * Reads each payment from Razorpay (read-only; `fee` and `tax` are on the
 * payment entity once captured). Nothing else on the order changes.
 *
 * Usage (from backend/):
 *   node scripts/backfill-gateway-fees.js            # dry run
 *   node scripts/backfill-gateway-fees.js --apply
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Order = require('../src/modules/orders/order.model');
const razorpay = require('../src/infrastructure/payments/razorpay');

const APPLY = process.argv.includes('--apply');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
  await mongoose.connect(process.env.MONGO_URI);
  const orders = await Order.find({
    paymentMethod: 'online',
    paymentStatus: { $in: ['paid', 'refunded'] },
    razorpayPaymentId: { $exists: true, $ne: '' },
    'gatewayFee.total': { $exists: false },
  })
    .select('orderNumber razorpayPaymentId')
    .sort({ createdAt: 1 });
  console.log(`${orders.length} online order(s) without a gateway fee`);
  let done = 0,
    skipped = 0;
  for (const o of orders) {
    let payment;
    try {
      payment = await razorpay.getPayment(o.razorpayPaymentId);
    } catch (e) {
      // The Razorpay SDK rejects with { statusCode, error: { code, description } }, not an Error.
      const why =
        e?.error?.description || e?.error?.code || e?.message || (typeof e === 'string' ? e : JSON.stringify(e));
      console.log(`  ${o.orderNumber} (${o.razorpayPaymentId}): Razorpay lookup failed — ${why}`);
      skipped += 1;
      continue;
    }
    const fee = razorpay.describeFee(payment);
    if (!fee)
      console.log(`  ${o.orderNumber}: status=${payment?.status} fee=${payment?.fee} captured=${payment?.captured}`);
    if (!fee) {
      console.log(`  ${o.orderNumber}: payment has no fee yet (not captured?)`);
      skipped += 1;
      continue;
    }
    console.log(`  ${o.orderNumber}: fee ₹${fee.fee} (incl. GST ₹${fee.tax})`);
    if (APPLY) {
      await Order.updateOne({ _id: o._id }, { $set: { gatewayFee: fee } });
      done += 1;
    }
  }
  console.log(APPLY ? `\nUpdated ${done}, skipped ${skipped}.` : `\nDry run — re-run with --apply to write.`);
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
