/**
 * Sellers module — public surface. KYC, pickup sync and pickup confirmation.
 *
 *   routes      sellers.routes.js          seller / admin routers
 *   controllers seller-kyc / admin-kyc     HTTP ⇄ service, no rules
 *   services    kyc (submit), kyc-review (staff), pickup-sync (Shiprocket), pickup-self-verify (emailed code)
 *   pure        kyc-rules (field rules, wire hygiene), kyc-emails (templates)
 *   data        sellers.repository (User)
 *
 */
const sellerController = require('./seller-kyc.controller');
const adminController = require('./admin-kyc.controller');
const { syncSellerPickupToShiprocket } = require('./pickup-sync.service');
const { selfVerificationValid } = require('./pickup-self-verify.service');
const { accountActivatedHtml } = require('./kyc-emails');

module.exports = {
  ...sellerController,
  ...adminController,
  // Shared with the admin controller (activation email) and tests
  syncSellerPickupToShiprocket,
  selfVerificationValid,
  accountActivatedHtml,
  routes: require('./sellers.routes'),
};
