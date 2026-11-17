/**
 * Catalogue module — public surface. Categories (the cached storefront tree
 * and admin edits), brands, seller requests for new brands / categories,
 * and purchase-verified product reviews.
 *
 *   routes      catalog.routes.js          categories, brands, reviews, sellerRequests, adminRequests
 *   controller  catalog.controller.js      HTTP ⇄ service, no rules
 *   services    categories, brands, brand-requests, reviews
 *   pure        category-tree (build + hasProducts annotation)
 *   data        categories / brands / brand-requests / reviews repositories
 *   models      category, brand, category-brand-request, review (*.model.js)
 */
const controller = require('./catalog.controller');

module.exports = {
  routes: require('./catalog.routes'),
  /** GET /api/products/:slug/reviews — mounted by the products module beside the product routes. */
  productReviews: controller.productReviews,
};
