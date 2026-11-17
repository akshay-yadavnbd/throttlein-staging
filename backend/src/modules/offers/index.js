/**
 * Offers module — public surface. Seller discount offers (the dashboard's
 * Offers tab) and the live-offer pricing every product response and
 * checkout uses, so the storefront and the order charge the same price.
 *
 *   routes      offers.routes.js           /api/seller/offers
 *   controller  offers.controller.js       HTTP ⇄ service, no rules
 *   services    offers (seller CRUD), offer-resolver (live pricing)
 *   pure        offer-pricing (savings, best offer, decoration), offer-input (sanitising)
 *   data        offers.repository.js
 *   model       seller-offer.model.js
 */
const resolver = require('./offer-resolver.service');
const pricing = require('./offer-pricing');

module.exports = {
  routes: require('./offers.routes'),
  /** Product responses (products module). */
  resolveOfferForProduct: resolver.resolveOfferForProduct,
  resolveOffersForProducts: resolver.resolveOffersForProducts,
  /** Checkout prices order lines with the same offer the storefront showed (orders module). */
  loadLiveOffersForSellers: resolver.loadLiveOffersForSellers,
  bestOfferForProduct: pricing.bestOfferForProduct,
};
