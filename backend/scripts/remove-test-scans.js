#!/usr/bin/env node
/**
 * Remove synthetic "test" courier scans from real orders, and collapse
 * duplicate status-snapshot lines.
 *
 * UX audit S13: a webhook test on 24 Sep 2026 posted a fake scan
 * (activity "Manual test scan", status "X-TEST", location "Test") to the
 * LIVE order TIN-2026-000018, and it shows on the seller's, admin's and
 * customer's tracking timelines. This removes such scans and, where the
 * fake scan had become the slice's latest event, rewinds `statusEventAt`
 * to the latest real scan so the next genuine webhook is not rejected
 * as stale.
 *
 * It also clears a stale "AWB failed: …" left on a slice that has since
 * received its label (the webhook now does this on the next event; this
 * catches slices that never got one), and collapses runs of identical
 * SYNTHESIZED lines — status equal to activity, no location — e.g. five
 * "NEW" lines written by the 30-minute order-snapshot poll before it learnt
 * to skip unchanged statuses. Real courier scans are never collapsed: five
 * "Out for Pickup" scans on different days are five attempts, and the
 * timeline should say so.
 *
 * Usage (from backend/):
 *   node scripts/remove-test-scans.js            # dry run — prints what it WOULD change
 *   node scripts/remove-test-scans.js --apply    # actually writes
 *   node scripts/remove-test-scans.js --apply TIN-2026-000018   # one order only
 *
 * Never test against production orders again: use SHIPROCKET_MOCK_MODE or
 * a dedicated test seller account.
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Order = require('../src/modules/orders/order.model');

const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.slice(2).find((a) => /^TIN-/i.test(a));

/** A scan is synthetic when any of these hold — all are strings no courier emits. */
function isTestScan(sc) {
  const a = String(sc.activity || '');
  const s = String(sc.status || '');
  const l = String(sc.location || '');
  return (
    /manual test scan|MOCK fired|MOCK:/i.test(a) ||
    /^X-TEST$/i.test(s) ||
    /^(Test|Dev console|Mock courier hub)$/i.test(l)
  );
}

(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
  await mongoose.connect(process.env.MONGO_URI);
  const filter = ONLY
    ? { orderNumber: ONLY.toUpperCase() }
    : {
        $or: [{ 'sellerShipments.scans.0': { $exists: true } }, { 'sellerShipments.lastError': /^AWB failed:/i }],
      };
  const orders = await Order.find(filter).select('orderNumber sellerShipments');
  let touched = 0,
    removed = 0;

  for (const order of orders) {
    let changed = false;
    for (const entry of order.sellerShipments || []) {
      if (entry.awbCode && /^AWB failed:/i.test(String(entry.lastError || ''))) {
        console.log(
          `${order.orderNumber} · slice ${entry._id} · clearing stale error "${entry.lastError.slice(0, 60)}…" (label ${entry.awbCode} exists)`,
        );
        if (APPLY) entry.lastError = '';
        changed = true;
      }
      const before = entry.scans?.length || 0;
      if (!before) continue;
      const fake = entry.scans.filter(isTestScan);
      // Consecutive duplicates (by status/activity/location) — keep the first.
      const dupes = [];
      let prevKey = null;
      const dedupedReal = [];
      for (const sc of [...entry.scans].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))) {
        if (isTestScan(sc)) continue;
        const synthesized = !sc.location && String(sc.status || '') === String(sc.activity || '');
        const key = `${sc.status || ''}|${sc.activity || ''}|${sc.location || ''}`;
        if (synthesized && key === prevKey) dupes.push(sc);
        else dedupedReal.push(sc);
        prevKey = key;
      }
      if (!fake.length && !dupes.length) continue;
      const keep = dedupedReal;
      console.log(
        `${order.orderNumber} · slice ${entry._id} · removing ${fake.length + dupes.length} of ${before} scans (${fake.length} test, ${dupes.length} duplicate):`,
      );
      for (const sc of [...fake, ...dupes])
        console.log(`    - ${sc.date?.toISOString?.() || sc.date} | ${sc.status} | ${sc.activity} | ${sc.location}`);

      const fakeTimes = [...fake, ...dupes].map((sc) => new Date(sc.date || 0).getTime());
      const lastReal = keep.length ? new Date(Math.max(...keep.map((sc) => new Date(sc.date || 0).getTime()))) : null;
      const evAt = entry.statusEventAt ? new Date(entry.statusEventAt).getTime() : NaN;
      if (Number.isFinite(evAt) && fakeTimes.includes(evAt)) {
        console.log(
          `    statusEventAt ${new Date(evAt).toISOString()} came from the fake scan → ${lastReal ? lastReal.toISOString() : 'unset'}`,
        );
        if (APPLY) entry.statusEventAt = lastReal || undefined;
      }
      if (APPLY) entry.scans = keep;
      removed += fake.length + dupes.length;
      changed = true;
    }
    if (changed) {
      touched += 1;
      if (APPLY) await order.save({ timestamps: false });
    }
  }

  console.log(
    `\n${APPLY ? 'Removed' : 'Would remove'} ${removed} scan(s) across ${touched} order(s).${APPLY ? '' : ' Re-run with --apply to write.'}`,
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
