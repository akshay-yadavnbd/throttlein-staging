/**
 * Payouts module — public surface. What each seller earns per delivered
 * parcel, rolled into IST weeks, and the admin's record of paying them.
 *
 *   routes      payouts.routes.js          seller (/api/seller/payouts), admin (/api/admin/settlements…)
 *   controller  payouts.controller.js      HTTP ⇄ service, no rules
 *   service     payouts.service.js         weeks, settlement, courier-charge corrections
 *   pure        payout-math.js             per-line earnings, totals, IST week bounds
 *   data        payouts.repository.js
 *   model       settlement.model.js
 */
module.exports = {
  routes: require('./payouts.routes'),
  /** The money maths: the orders module shows a parcel's earnings and captures courier charges with it. */
  payoutMath: require('./payout-math'),
};
