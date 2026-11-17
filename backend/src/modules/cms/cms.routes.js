/**
 * CMS routers, one per mount in routes/api.js:
 *
 *   pages             /api/pages                site-scoped; admin writes need the site's pages key
 *   staticPages       /api/admin/static-pages   manifest of the storefront's hard-coded routes
 *   homeBanners       /api/home-banners         } homepage furniture, `pages` permission
 *   promoBlocks       /api/promo-blocks         }
 *   homeSeo           /api/home-seo             }
 *   sellerCta         /api/seller-cta           }
 *   sellerGuides      /api/seller-guides        seller landing page; `pages` OR `seller-pages`
 *   sellerGuideSection /api/seller-guide-section
 *   faqs              /api/faqs                 site-scoped, `pages` permission
 *   testimonials      /api/testimonials         site-scoped `testimonials` key
 *   redirects         /api/redirects            site-scoped `pages` key
 */
const express = require('express');
const { protect, requirePermission, requireSitePermission } = require('../../middleware/auth');
const resolveSite = require('../../middleware/resolveSite');
const upload = require('../../middleware/upload');
const { validate } = require('../../middleware/validate');
const s = require('./cms.schema');
const c = require('./cms.controller');

const byId = validate({ params: s.objectIdParams });
const edit = validate({ params: s.objectIdParams, body: s.objectBody });
const body = validate({ body: s.objectBody });
const pagesStaff = requirePermission('pages');

/* ── pages ──────────────────────────────────────────────────────────── */
const pages = express.Router();
pages.use(resolveSite);
const pagesSite = [protect, requireSitePermission('pages')];
pages.get('/', validate({ query: s.pagesQuery }), c.listPages);
// Static paths before /:slug so 'id', 'resolve' and 'static-meta' are never read as slugs.
pages.get('/id/:id', ...pagesSite, byId, c.getPageById);
pages.get('/resolve', validate({ query: s.routeQuery }), c.resolvePageByRoute);
pages.get('/static-meta', validate({ query: s.staticMetaQuery }), c.getStaticMetaByRoute);
pages.get('/:slug', validate({ params: s.slugParams }), c.getPageBySlug);
pages.post('/upload-og', ...pagesSite, body, ...c.uploadOgImage);
pages.post('/', ...pagesSite, body, c.createPage);
pages.put('/:id', ...pagesSite, edit, c.updatePage);
pages.delete('/:id', ...pagesSite, byId, c.removePage);

/* Either site's pages key: the manifest is a filesystem walk of main-site
 * routes, and a seller-only editor gets an empty list, not a 403. */
const staticPages = express.Router();
staticPages.get('/', protect, resolveSite, requirePermission('pages', 'seller-pages'), c.staticPageManifest);

/* ── homepage furniture ─────────────────────────────────────────────── */
const homeBanners = express.Router();
homeBanners.get('/', validate({ query: s.activeQuery }), c.listBanners);
homeBanners.post('/upload', protect, pagesStaff, body, ...c.uploadBannerImage);
homeBanners.post('/', protect, pagesStaff, body, c.createBanner);
homeBanners.put('/:id', protect, pagesStaff, edit, c.updateBanner);
homeBanners.delete('/:id', protect, pagesStaff, byId, c.removeBanner);

const promoBlocks = express.Router();
promoBlocks.get('/', validate({ query: s.activeQuery }), c.listPromoBlocks);
promoBlocks.post('/upload', protect, pagesStaff, body, ...c.uploadPromoImage);
promoBlocks.get('/admin', protect, pagesStaff, c.adminPromoBlocks);
promoBlocks.get('/admin/:id', protect, pagesStaff, byId, c.getPromoBlock);
promoBlocks.post('/admin', protect, pagesStaff, body, c.createPromoBlock);
promoBlocks.put('/admin/:id', protect, pagesStaff, edit, c.updatePromoBlock);
promoBlocks.delete('/admin/:id', protect, pagesStaff, byId, c.removePromoBlock);

const homeSeo = express.Router();
homeSeo.get('/', validate({ query: s.activeQuery }), c.getHomeSeo);
homeSeo.put('/', protect, pagesStaff, body, c.updateHomeSeo);

const sellerCta = express.Router();
sellerCta.get('/', validate({ query: s.activeQuery }), c.getSellerCta);
sellerCta.put('/', protect, pagesStaff, body, c.updateSellerCta);
sellerCta.post('/upload', protect, pagesStaff, body, ...c.uploadSellerCtaImage);

/* ── seller guides (no site field: they belong to the seller property) ── */
const guidesStaff = [protect, requirePermission('pages', 'seller-pages')];
const sellerGuides = express.Router();
sellerGuides.post('/upload', ...guidesStaff, body, ...c.uploadGuideImage);
sellerGuides.get('/id/:id', ...guidesStaff, byId, c.getGuideById);
sellerGuides.get('/', validate({ query: s.activeQuery }), c.listGuides);
sellerGuides.get('/:slug', validate({ params: s.slugParams }), c.getGuideBySlug);
sellerGuides.post('/', ...guidesStaff, body, c.createGuide);
sellerGuides.put('/:id', ...guidesStaff, edit, c.updateGuide);
sellerGuides.delete('/:id', ...guidesStaff, byId, c.removeGuide);

const sellerGuideSection = express.Router();
sellerGuideSection.get('/', validate({ query: s.activeQuery }), c.getGuideSection);
sellerGuideSection.put('/', ...guidesStaff, body, c.updateGuideSection);

/* ── FAQ ────────────────────────────────────────────────────────────── */
const faqs = express.Router();
faqs.use(resolveSite);
faqs.get('/', c.listFaqs);
faqs.get('/admin', protect, pagesStaff, c.adminFaqs);
faqs.get('/admin/:id', protect, pagesStaff, byId, c.getFaq);
faqs.post('/admin', protect, pagesStaff, body, c.createFaq);
faqs.put('/admin/:id', protect, pagesStaff, edit, c.updateFaq);
faqs.delete('/admin/:id', protect, pagesStaff, byId, c.removeFaq);

/* ── testimonials ───────────────────────────────────────────────────── */
const testimonials = express.Router();
const testimonialsSite = [protect, resolveSite, requireSitePermission('testimonials')];
testimonials.get('/', resolveSite, validate({ query: s.activeQuery }), c.listTestimonials);
// Avatars land in their own `testimonials/` prefix.
testimonials.post(
  '/upload',
  ...testimonialsSite,
  body,
  upload.setUploadPrefix(() => 'testimonials'),
  ...c.uploadTestimonialImage,
);
testimonials.get('/admin', ...testimonialsSite, c.adminTestimonials);
testimonials.get('/admin/:id', ...testimonialsSite, byId, c.getTestimonial);
testimonials.post('/admin', ...testimonialsSite, body, c.createTestimonial);
testimonials.put('/admin/:id', ...testimonialsSite, edit, c.updateTestimonial);
testimonials.delete('/admin/:id', ...testimonialsSite, byId, c.removeTestimonial);

/* ── redirects ──────────────────────────────────────────────────────── */
const redirects = express.Router();
redirects.use(resolveSite);
redirects.get('/', c.listRedirects);
// Fire-and-forget hit counter from the storefront proxy; always 204.
redirects.post('/:id/hit', edit, c.recordRedirectHit);
redirects.get('/admin', ...pagesSite, c.adminRedirects);
redirects.post('/', ...pagesSite, body, c.createRedirect);
redirects.put('/:id', ...pagesSite, edit, c.updateRedirect);
redirects.delete('/:id', ...pagesSite, byId, c.removeRedirect);

module.exports = {
  pages,
  staticPages,
  homeBanners,
  promoBlocks,
  homeSeo,
  sellerCta,
  sellerGuides,
  sellerGuideSection,
  faqs,
  testimonials,
  redirects,
};
