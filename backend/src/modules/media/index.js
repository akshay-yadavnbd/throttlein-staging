/**
 * Media module — public surface. The admin media library: the picker's list,
 * folders, uploads and deletes that clean storage and every reference.
 * Uploads elsewhere in the admin are recorded into it by
 * middleware/trackMediaUpload (which writes media.model directly).
 *
 *   routes      media.routes.js            /api/admin/media
 *   controller  media.controller.js        HTTP ⇄ service, no rules
 *   service     media.service.js
 *   data        media.repository.js
 *   model       media.model.js
 */
module.exports = {
  routes: require('./media.routes'),
};
