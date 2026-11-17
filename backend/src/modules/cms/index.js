/**
 * CMS module — public surface. Pages, homepage furniture (banners, promo
 * blocks, SEO block, seller CTA), seller guides, FAQ, testimonials and
 * redirects, per site where the content is site-scoped.
 *
 *   routes      cms.routes.js              one router per /api mount (see routes/api.js)
 *   controller  cms.controller.js          HTTP ⇄ service, no rules
 *   services    pages, static-pages, home, seller-guides, site-content (FAQ, testimonials, redirects)
 *   pure        page-input (types, templates, sellerCategory merge, route mapping)
 *   data        pages / home / content / users repositories
 */
const controller = require('./cms.controller');
const { pageToRoute, extractYouTubeId } = require('./page-input');

module.exports = {
  ...controller,
  pageToRoute,
  extractYouTubeId,
  routes: require('./cms.routes'),
};
