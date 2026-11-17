/**
 * Offline sales module — public surface. The seller's point-of-sale log:
 * shop-counter sales that take units out of online stock, with a GST or
 * non-GST invoice each.
 *
 *   routes      offline-sales.routes.js     /api/seller/offline-sales
 *   controller  offline-sales.controller.js HTTP ⇄ service, no rules
 *   service     offline-sales.service.js    record / edit / undo / invoice / history
 *   pure        offline-sale-tax (GST split), offline-sale-input (buyer, date range), stock (variant arithmetic)
 *   data        offline-sales.repository.js
 *   model       offline-sale.model.js
 */
module.exports = {
  routes: require('./offline-sales.routes'),
};
