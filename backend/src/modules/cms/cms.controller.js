/** CMS HTTP handlers. Each reads the validated request, calls one service function and answers. */
const asyncHandler = require('express-async-handler');
const upload = require('../../middleware/upload');
const trackMediaUpload = require('../../middleware/trackMediaUpload');
const { AppError } = require('../../errors/AppError');
const { normalizeSite } = require('../../config/sites');
const { sendData, sendCreated } = require('../../utils/apiResponse');
const pages = require('./pages.service');
const staticPages = require('./static-pages.service');
const home = require('./home.service');
const guides = require('./seller-guides.service');
const site = require('./site-content.service');

const siteOf = (req) => normalizeSite(req.site);
/** Every handler answers the `{ data }` envelope. The storefront and the admin read the public
 *  ones through the tolerant `dataOf` / `envelopeOrLegacy` (lib/api.ts) — they render server-side. */
const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));
const respondCreated = (fn) => asyncHandler(async (req, res) => sendCreated(res, await fn(req)));

/** One image under the `image` field → its stored URL / key. */
const imageUpload = () => [
  upload.single('image'),
  trackMediaUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('No file uploaded');
    sendData(res, { url: upload.fileToUrl(req.file) });
  }),
];

/* ── pages ──────────────────────────────────────────────────────────── */
exports.listPages = respond((req) =>
  pages.list(siteOf(req), req.query, { user: req.user, authorization: req.headers.authorization }),
);
exports.getStaticMetaByRoute = respond((req) => pages.staticMeta(siteOf(req), String(req.query.route || '').trim()));
exports.getPageBySlug = respond((req) => pages.bySlug(siteOf(req), req.params.slug));
exports.resolvePageByRoute = respond((req) => pages.resolveRoute(siteOf(req), req.query));
exports.getPageById = respond((req) => pages.byId(siteOf(req), req.params.id));
exports.createPage = respondCreated((req) => pages.create(siteOf(req), req.body));
exports.updatePage = respond((req) => pages.update(siteOf(req), req.params.id, req.body));
exports.removePage = respond((req) => pages.remove(siteOf(req), req.params.id));
exports.uploadOgImage = imageUpload();
exports.staticPageManifest = (req, res) => sendData(res, staticPages.manifest(siteOf(req)));

/* ── home: banners, promo blocks, SEO block, seller CTA ─────────────── */
exports.listBanners = respond((req) => home.listBanners(req.query));
exports.createBanner = respondCreated((req) => home.createBanner(req.body));
exports.updateBanner = respond((req) => home.updateBanner(req.params.id, req.body));
exports.removeBanner = respond((req) => home.removeBanner(req.params.id));
exports.uploadBannerImage = imageUpload();

exports.listPromoBlocks = respond((req) => home.listPromoBlocks(req.query));
exports.adminPromoBlocks = respond(() => home.adminPromoBlocks());
exports.getPromoBlock = respond((req) => home.getPromoBlock(req.params.id));
exports.createPromoBlock = respondCreated((req) => home.createPromoBlock(req.body));
exports.updatePromoBlock = respond((req) => home.updatePromoBlock(req.params.id, req.body));
exports.removePromoBlock = respond((req) => home.removePromoBlock(req.params.id));
exports.uploadPromoImage = imageUpload();

exports.getHomeSeo = respond((req) => home.getHomeSeo(req.query));
exports.updateHomeSeo = respond((req) => home.updateHomeSeo(req.body));
exports.getSellerCta = respond((req) => home.getSellerCta(req.query));
exports.updateSellerCta = respond((req) => home.updateSellerCta(req.body));
exports.uploadSellerCtaImage = imageUpload();

/* ── seller guides ──────────────────────────────────────────────────── */
exports.listGuides = respond((req) => guides.list(req.query));
exports.getGuideBySlug = respond((req) => guides.bySlug(req.params.slug));
exports.getGuideById = respond((req) => guides.byId(req.params.id));
exports.createGuide = respondCreated((req) => guides.create(req.body));
exports.updateGuide = respond((req) => guides.update(req.params.id, req.body));
exports.removeGuide = respond((req) => guides.remove(req.params.id));
exports.uploadGuideImage = imageUpload();
exports.getGuideSection = respond((req) => guides.getSection(req.query));
exports.updateGuideSection = respond((req) => guides.updateSection(req.body));

/* ── FAQ ────────────────────────────────────────────────────────────── */
exports.listFaqs = respond((req) => site.faqPublic(siteOf(req)));
exports.adminFaqs = respond((req) => site.faqAdminList(siteOf(req)));
exports.getFaq = respond((req) => site.faqGet(req.params.id));
exports.createFaq = respondCreated((req) => site.faqCreate(siteOf(req), req.body));
exports.updateFaq = respond((req) => site.faqUpdate(req.params.id, req.body));
exports.removeFaq = respond((req) => site.faqRemove(req.params.id));

/* ── testimonials ───────────────────────────────────────────────────── */
exports.listTestimonials = respond((req) => site.testimonialsPublic(siteOf(req), req.query));
exports.adminTestimonials = respond((req) => site.testimonialsAdmin(siteOf(req)));
exports.getTestimonial = respond((req) => site.testimonialGet(siteOf(req), req.params.id));
exports.createTestimonial = respondCreated((req) => site.testimonialCreate(siteOf(req), req.body));
exports.updateTestimonial = respond((req) => site.testimonialUpdate(siteOf(req), req.params.id, req.body));
exports.removeTestimonial = respond((req) => site.testimonialRemove(siteOf(req), req.params.id));
exports.uploadTestimonialImage = imageUpload();

/* ── redirects ──────────────────────────────────────────────────────── */
exports.listRedirects = respond((req) => site.redirectsPublic(siteOf(req)));
exports.recordRedirectHit = asyncHandler(async (req, res) => {
  await site.recordHit(siteOf(req), req.params.id);
  res.status(204).end();
});
exports.adminRedirects = respond((req) => site.redirectsAdmin(siteOf(req)));
exports.createRedirect = respondCreated((req) => site.redirectCreate(siteOf(req), req.body));
exports.updateRedirect = respond((req) => site.redirectUpdate(siteOf(req), req.params.id, req.body));
exports.removeRedirect = respond((req) => site.redirectRemove(siteOf(req), req.params.id));
