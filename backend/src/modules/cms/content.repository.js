/**
 * Seller guides (+ their heading singleton), FAQ sections, testimonials
 * and redirects. Statements only. Guides carry no site (they belong to
 * the seller property alone); the other three are site-scoped.
 */
const SellerGuide = require('./seller-guide.model');
const SellerGuideSection = require('./seller-guide-section.model');
const FaqSection = require('./faq-section.model');
const Testimonial = require('./testimonial.model');
const Redirect = require('./redirect.model');

/* ── seller guides ──────────────────────────────────────────────────── */
const guides = (filter) => SellerGuide.find(filter).sort({ order: 1, createdAt: 1 });
const guideBySlug = (slug) => SellerGuide.findOne({ slug });
const guideById = (id) => SellerGuide.findById(id);
const guideSlugTaken = (slug, exceptId) => SellerGuide.findOne(exceptId ? { slug, _id: { $ne: exceptId } } : { slug });
const createGuide = (fields) => SellerGuide.create(fields);
async function guideSection() {
  let doc = await SellerGuideSection.findOne();
  if (!doc) doc = await SellerGuideSection.create({});
  return doc;
}

/* ── FAQ sections ───────────────────────────────────────────────────── */
const faqSections = (filter) => FaqSection.find(filter).sort({ order: 1, _id: 1 }).lean();
const faqSectionById = (id, { lean = false } = {}) => (lean ? FaqSection.findById(id).lean() : FaqSection.findById(id));
const lastFaqSection = (site) => FaqSection.findOne({ site }).sort({ order: -1 }).lean();
const createFaqSection = (fields) => FaqSection.create(fields);

/* ── testimonials ───────────────────────────────────────────────────── */
const testimonials = (filter) => Testimonial.find(filter).sort({ order: 1, createdAt: 1 });
const testimonialsAdmin = (site) => Testimonial.find({ site }).sort({ order: 1, _id: 1 });
const testimonialOnSite = (id, site) => Testimonial.findOne({ _id: id, site });
const lastTestimonial = (site) => Testimonial.findOne({ site }).sort({ order: -1 }).lean();
const createTestimonial = (fields) => Testimonial.create(fields);

/* ── redirects ──────────────────────────────────────────────────────── */
const activeRedirects = (site) =>
  Redirect.find({ site, isActive: true }).select('source destination statusCode').lean();
const redirectsAdmin = (site) => Redirect.find({ site }).sort({ updatedAt: -1 }).lean();
const redirectOnSite = (id, site) => Redirect.findOne({ _id: id, site });
const createRedirect = (fields) => Redirect.create(fields);
const countRedirectHit = (id, site) =>
  Redirect.findOneAndUpdate({ _id: id, site }, { $inc: { hitCount: 1 }, $set: { lastHitAt: new Date() } });

module.exports = {
  guides,
  guideBySlug,
  guideById,
  guideSlugTaken,
  createGuide,
  guideSection,
  faqSections,
  faqSectionById,
  lastFaqSection,
  createFaqSection,
  testimonials,
  testimonialsAdmin,
  testimonialOnSite,
  lastTestimonial,
  createTestimonial,
  activeRedirects,
  redirectsAdmin,
  redirectOnSite,
  createRedirect,
  countRedirectHit,
};
