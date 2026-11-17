/**
 * Everything under /api, in one place. Mounted by src/app.js.
 *
 * ORDER MATTERS. `customerRoutes` carries a top-level `protect`, so every
 * public router must be mounted above it or its requests would 401 before
 * reaching their handler. Routers that need to see a path before a sibling
 * with a `/:id` param say so in a comment next to the mount.
 */
const express = require('express');
const { env } = require('../config/env');
const { privateDiskHandler } = require('../utils/privateFiles');

function createApiRouter({ mcp = null } = {}) {
  const router = express.Router();

  // Liveness probe (Dockerfile HEALTHCHECK, docker-compose, nginx).
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'seller-management-api',
      revision: env.DEPLOY_COMMIT || 'local',
      time: new Date().toISOString(),
    });
  });

  // Private disk-mode files (KYC documents) — authorised, expiring links.
  router.get('/private-files', privateDiskHandler);

  router.use('/auth', require('./authRoutes'));
  router.use('/products', require('./productRoutes'));
  // S3 file proxy — browsers see /api/files/<key>, never the raw S3 URL.
  router.use(require('./fileRoutes'));
  router.use('/sellers', require('./sellerRoutes'));
  // AI connector management (src/mcp/manage.js) — before adminRoutes so its own guards apply.
  router.use('/admin/mcp', require('./adminMcpRoutes')(mcp));
  router.use('/admin', require('./adminRoutes'));
  // Catalogue — src/modules/catalog/catalog.routes.js (categories, brands, reviews, brand/category requests).
  const catalog = require('../modules/catalog').routes;
  router.use('/categories', catalog.categories);
  router.use('/brands', catalog.brands);
  // CMS — src/modules/cms/cms.routes.js (one router per mount).
  const cms = require('../modules/cms').routes;
  router.use('/home-banners', cms.homeBanners);
  router.use('/promo-blocks', cms.promoBlocks);
  router.use('/testimonials', cms.testimonials);
  router.use('/home-seo', cms.homeSeo);
  router.use('/seller-cta', cms.sellerCta);
  router.use('/seller-guides', cms.sellerGuides);
  router.use('/seller-guide-section', cms.sellerGuideSection);
  router.use('/admin/media', require('../modules/media').routes);
  router.use('/seller/media', require('../modules/seller-media').routes);
  router.use('/seller/offers', require('../modules/offers').routes);
  router.use('/assistant/conversations', require('../modules/assistant').routes);
  router.use('/seller/offline-sales', require('../modules/offline-sales').routes);
  router.use('/contact', require('../modules/contact').routes);
  // Public (no login) — must stay ABOVE customerRoutes.
  // Cart-reminder unsubscribe pages — src/modules/customers (the signed link is the credential).
  router.use('/email', require('../modules/customers').routes.emailPreferences);
  router.use('/redirects', cms.redirects);
  router.use('/admin/static-pages', cms.staticPages);
  router.use('/faqs', cms.faqs);
  router.use('/pages', cms.pages);
  // Mock label / invoice / tracking pages — only respond when
  // SHIPROCKET_MOCK_MODE=true (the router itself guards this).
  router.use('/mock', require('./mockShiprocketRoutes'));
  // Inbound webhooks (public — Shiprocket / Razorpay call us). The handlers
  // verify their own tokens / signatures. Body handling for
  // /hooks/tin-shipment is set up in app.js before the global JSON parser.
  router.use('/hooks', require('./webhookRoutes'));
  // Blog — src/modules/blog: public (read-only) at /blog, admin CRUD at
  // /admin/blog, mounted apart from adminRoutes so the blog's site guard
  // never fights the general admin guard.
  const blog = require('../modules/blog').routes;
  router.use('/blog', blog.public);
  router.use('/admin/blog', blog.admin);
  // Everything below runs behind customerRoutes' top-level `protect`.
  router.use(require('./customerRoutes'));
  router.use('/seller', require('./sellerOrderRoutes'));
  router.use('/reviews', catalog.reviews);

  return router;
}

module.exports = { createApiRouter };
