/**
 * Contact module — public surface. The storefront's contact form.
 *
 *   routes      contact.routes.js          /api/contact
 *   controller  contact.controller.js      HTTP ⇄ service
 *   service     contact.service.js         validation and the two emails
 */
module.exports = {
  routes: require('./contact.routes'),
};
