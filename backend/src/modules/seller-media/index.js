/**
 * Seller media module — public surface. The seller's own media library:
 * uploads, folders, in-use-safe deletes and shareable presigned links.
 *
 *   routes      seller-media.routes.js     /api/seller/media
 *   controller  seller-media.controller.js HTTP ⇄ service, no rules
 *   service     seller-media.service.js
 *   data        seller-media.repository.js
 *   model       seller-media.model.js
 */
module.exports = {
  routes: require('./seller-media.routes'),
};
