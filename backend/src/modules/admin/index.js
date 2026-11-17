/**
 * Admin module — public surface. What staff do from the admin panel that
 * no other domain owns: dashboard, seller and customer management, product
 * moderation, the order feed and archive, the master access key and
 * impersonation, staff accounts, platform tools.
 *
 *   routes      admin.routes.js            one router, mounted by routes/adminRoutes.js
 *   controller  admin.controller.js        HTTP ⇄ service, no rules
 *   services    dashboard, sellers, seller-removal, customers, security, order-feed, moderation, staff, platform-tools
 *   pure        audit-context, admin-emails
 *   data        users / products / order-feed / cleanup / security repositories
 *
 */
const controller = require('./admin.controller');

module.exports = {
  ...controller,
  routes: require('./admin.routes'),
};
