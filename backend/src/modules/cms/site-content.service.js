/**
 * Site-scoped content: FAQ sections, testimonials and redirects. The site
 * comes from the request context (resolveSite), never from the body, so
 * an admin who forgot to switch the sidebar can't publish seller content
 * onto the storefront.
 */
const { revalidatePath } = require('../../infrastructure/storefront/revalidate');
const { AppError } = require('../../errors/AppError');
const content = require('./content.repository');

/* ── FAQ ────────────────────────────────────────────────────────────── */

function faqFields(body = {}) {
  const out = {};
  if (typeof body.title === 'string') out.title = body.title.trim();
  if (body.order !== undefined) out.order = Number(body.order) || 0;
  if (body.isActive !== undefined) out.isActive = Boolean(body.isActive);
  if (Array.isArray(body.faqs)) {
    out.faqs = body.faqs
      .map((f, i) => ({
        question: typeof f?.question === 'string' ? f.question.trim() : '',
        answer: typeof f?.answer === 'string' ? f.answer : '',
        order: Number(f?.order ?? i) || 0,
      }))
      .filter((f) => f.question && f.answer);
  }
  return out;
}

/** Active sections with their items in order, stripped to what renders. */
async function faqPublic(site) {
  const sections = await content.faqSections({ isActive: true, site });
  return {
    items: sections.map((s) => ({
      _id: s._id,
      title: s.title,
      faqs: (s.faqs || [])
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((f) => ({ _id: f._id, question: f.question, answer: f.answer })),
    })),
  };
}
const faqAdminList = async (site) => ({ items: await content.faqSections({ site }) });

/**
 * @param {string} id
 * @param {{ lean?: boolean }} [opts]
 * @returns {Promise<any>} a lean object or a document, per `opts.lean`
 */
async function loadFaq(id, { lean } = {}) {
  const item = await content.faqSectionById(id, { lean });
  if (!item) throw AppError.notFound('FAQ section not found');
  return item;
}
const faqGet = async (id) => ({ item: await loadFaq(id, { lean: true }) });

async function faqCreate(site, body) {
  const fields = faqFields(body);
  if (!fields.title) throw AppError.badRequest('Section title is required');
  fields.site = site;
  if (fields.order === undefined) fields.order = ((await content.lastFaqSection(site))?.order || 0) + 1;
  return { item: await content.createFaqSection(fields) };
}

async function faqUpdate(id, body) {
  const item = await loadFaq(id);
  Object.assign(item, faqFields(body));
  await item.save();
  return { item };
}

async function faqRemove(id) {
  const item = await loadFaq(id);
  await item.deleteOne();
  return {};
}

/* ── testimonials ───────────────────────────────────────────────────── */

/** The carousel renders on every seller-category page under /seller/c/**. */
const revalidateTestimonials = (site) => {
  for (const path of site === 'seller' ? ['/seller', '/seller/sell-online'] : ['/']) revalidatePath(path);
};

function testimonialFields(body = {}) {
  const out = {};
  for (const k of ['name', 'company', 'avatar', 'quote']) if (typeof body[k] === 'string') out[k] = body[k].trim();
  if (body.order !== undefined) out.order = Number(body.order) || 0;
  if (body.isActive !== undefined) out.isActive = Boolean(body.isActive);
  return out;
}

/** TipTap emits `<p></p>` for an empty document, so "blank" means no words. */
const isBlankHtml = (html) =>
  !String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();

async function testimonialsPublic(site, query) {
  const filter = { site };
  if (query.active === '1') filter.isActive = true;
  const items = await content.testimonials(filter);
  return { items, count: items.length };
}
const testimonialsAdmin = async (site) => ({ items: await content.testimonialsAdmin(site) });

async function loadTestimonial(id, site) {
  const item = await content.testimonialOnSite(id, site);
  if (!item) throw AppError.notFound('Testimonial not found');
  return item;
}
const testimonialGet = async (site, id) => ({ item: await loadTestimonial(id, site) });

async function testimonialCreate(site, body) {
  const fields = testimonialFields(body);
  if (!fields.name) throw AppError.badRequest('Name is required');
  if (isBlankHtml(fields.quote)) throw AppError.badRequest('Feedback is required');
  if (fields.order === undefined) fields.order = ((await content.lastTestimonial(site))?.order ?? -1) + 1;
  const item = await content.createTestimonial({ ...fields, site });
  revalidateTestimonials(site);
  return { item };
}

async function testimonialUpdate(site, id, body) {
  const item = await loadTestimonial(id, site);
  const fields = testimonialFields(body);
  if (fields.name !== undefined && !fields.name) throw AppError.badRequest('Name is required');
  if (fields.quote !== undefined && isBlankHtml(fields.quote)) throw AppError.badRequest('Feedback is required');
  Object.assign(item, fields);
  await item.save();
  revalidateTestimonials(site);
  return { item };
}

/** doc.deleteOne() so the avatar-cleanup hook fires. */
async function testimonialRemove(site, id) {
  const item = await loadTestimonial(id, site);
  await item.deleteOne();
  revalidateTestimonials(site);
  return {};
}

/* ── redirects ──────────────────────────────────────────────────────── */

const redirectsPublic = async (site) => ({ items: await content.activeRedirects(site) });
/** Analytics only; swallowed on error so the storefront never blocks on it. */
const recordHit = async (site, id) => {
  await content.countRedirectHit(id, site).catch(() => {});
};
const redirectsAdmin = async (site) => ({ items: await content.redirectsAdmin(site) });

async function redirectCreate(site, { source, destination, statusCode, isActive, note }) {
  if (!source || !destination) throw AppError.badRequest('source and destination are required');
  const redirect = await content.createRedirect({
    site,
    source,
    destination,
    statusCode: statusCode || 301,
    isActive: isActive !== false,
    note: note || '',
  });
  return { redirect };
}

async function loadRedirect(id, site) {
  const r = await content.redirectOnSite(id, site);
  if (!r) throw AppError.notFound('Redirect not found');
  return r;
}

async function redirectUpdate(site, id, body) {
  const redirect = await loadRedirect(id, site);
  for (const f of ['source', 'destination', 'statusCode', 'isActive', 'note'])
    if (body[f] !== undefined) redirect[f] = body[f];
  await redirect.save();
  return { redirect };
}

async function redirectRemove(site, id) {
  const redirect = await loadRedirect(id, site);
  await redirect.deleteOne();
  return {};
}

module.exports = {
  faqPublic,
  faqAdminList,
  faqGet,
  faqCreate,
  faqUpdate,
  faqRemove,
  testimonialsPublic,
  testimonialsAdmin,
  testimonialGet,
  testimonialCreate,
  testimonialUpdate,
  testimonialRemove,
  redirectsPublic,
  recordHit,
  redirectsAdmin,
  redirectCreate,
  redirectUpdate,
  redirectRemove,
};
