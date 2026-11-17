/**
 * Homepage furniture: banners, promo blocks, the SEO block and the seller
 * CTA. Writes nudge the storefront's home route so an edit shows within
 * seconds instead of waiting out ISR.
 */
const { revalidatePath } = require('../../infrastructure/storefront/revalidate');
const { AppError } = require('../../errors/AppError');
const home = require('./home.repository');

const activeFilter = (query) => (query.active === '1' ? { isActive: true } : {});
const pick = (body, keys) => Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
const cleanStrings = (list) => list.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
/** Rows need both a label and a URL; half-filled rows are dropped. */
const cleanLinks = (arr) =>
  arr
    .map((l) => ({
      label: typeof l?.label === 'string' ? l.label.trim() : '',
      href: typeof l?.href === 'string' ? l.href.trim() : '',
    }))
    .filter((l) => l.label && l.href);

/* ── banners ────────────────────────────────────────────────────────── */
const BANNER_FIELDS = [
  'image',
  'imageMobile',
  'title',
  'description',
  'brandLogos',
  'ctaLabel',
  'ctaHref',
  'ctaTheme',
  'alt',
  'href',
  'order',
  'isActive',
];

function bannerFields(body) {
  const fields = pick(body, BANNER_FIELDS);
  if (Array.isArray(fields.brandLogos)) fields.brandLogos = cleanStrings(fields.brandLogos);
  if (fields.ctaTheme && !['dark', 'light'].includes(fields.ctaTheme)) fields.ctaTheme = 'dark';
  return fields;
}

async function listBanners(query) {
  const items = await home.banners(activeFilter(query));
  return { items, count: items.length };
}

async function createBanner(body) {
  const fields = bannerFields(body);
  if (!fields.image || !String(fields.image).trim()) throw AppError.badRequest('Banner image is required');
  if (typeof fields.order !== 'number') fields.order = 0;
  if (fields.isActive === undefined) fields.isActive = true;
  return { banner: await home.createBanner(fields) };
}

async function loadBanner(id) {
  const banner = await home.findBanner(id);
  if (!banner) throw AppError.notFound('Banner not found');
  return banner;
}

async function updateBanner(id, body) {
  const banner = await loadBanner(id);
  Object.assign(banner, bannerFields(body));
  await banner.save();
  revalidatePath('/');
  return { banner };
}

async function removeBanner(id) {
  const banner = await loadBanner(id);
  await banner.deleteOne();
  revalidatePath('/');
  return { message: 'Banner deleted' };
}

/* ── promo blocks ───────────────────────────────────────────────────── */
const PROMO_VARIANTS = ['image-grid', 'single-image'];

function promoFields(body = {}) {
  const out = {};
  if (typeof body.title === 'string') out.title = body.title.trim();
  if (typeof body.variant === 'string' && PROMO_VARIANTS.includes(body.variant)) out.variant = body.variant;
  if (typeof body.ctaLabel === 'string') out.ctaLabel = body.ctaLabel.trim();
  if (typeof body.ctaHref === 'string') out.ctaHref = body.ctaHref.trim();
  if (body.order !== undefined) out.order = Number(body.order) || 0;
  if (body.isActive !== undefined) out.isActive = Boolean(body.isActive);
  if (Array.isArray(body.chips)) out.chips = cleanLinks(body.chips);
  // Image strings pass through the model's `stripImageUrl` setter on assign.
  if (Array.isArray(body.images)) out.images = cleanStrings(body.images);
  return out;
}

async function listPromoBlocks(query) {
  const items = await home.promoBlocks(activeFilter(query));
  return { items, count: items.length };
}
const adminPromoBlocks = async () => ({ items: await home.promoBlocksAdmin() });

async function loadPromoBlock(id) {
  const item = await home.findPromoBlock(id);
  if (!item) throw AppError.notFound('Promo block not found');
  return item;
}
const getPromoBlock = async (id) => ({ item: await loadPromoBlock(id) });

async function createPromoBlock(body) {
  const fields = promoFields(body);
  if (!fields.title) throw AppError.badRequest('Title is required');
  if (!fields.ctaHref) throw AppError.badRequest('CTA link is required');
  // New blocks go to the end so existing ones don't shuffle.
  if (fields.order === undefined) fields.order = ((await home.lastPromoBlock())?.order ?? -1) + 1;
  return { item: await home.createPromoBlock(fields) };
}

async function updatePromoBlock(id, body) {
  const item = await loadPromoBlock(id);
  Object.assign(item, promoFields(body));
  await item.save();
  revalidatePath('/');
  return { item };
}

/** doc.deleteOne() so the schema's image-cleanup hook fires. */
async function removePromoBlock(id) {
  const item = await loadPromoBlock(id);
  await item.deleteOne();
  revalidatePath('/');
  return {};
}

/* ── singletons ─────────────────────────────────────────────────────── */

async function getHomeSeo(query) {
  const block = await home.homeSeoBlock();
  return { block: query.active === '1' && !block.isActive ? null : block };
}

/** Patches only the fields present, so a partial payload can't wipe the record. */
async function updateHomeSeo(body) {
  const block = await home.homeSeoBlock();
  if (typeof body.heading === 'string') block.heading = body.heading;
  if (typeof body.body === 'string') block.body = body.body;
  if (body.isActive !== undefined) block.isActive = Boolean(body.isActive);
  if (Array.isArray(body.links)) block.links = cleanLinks(body.links);
  if (Array.isArray(body.bottomLinks)) block.bottomLinks = cleanLinks(body.bottomLinks);
  await block.save();
  revalidatePath('/');
  return { block };
}

async function getSellerCta(query) {
  const cta = await home.sellerCta();
  return { cta: query.active === '1' && !cta.isActive ? null : cta };
}

async function updateSellerCta(body) {
  const cta = await home.sellerCta();
  Object.assign(cta, pick(body, ['bgImage', 'portraitImage', 'heading', 'subtext', 'ctaLabel', 'ctaHref', 'isActive']));
  await cta.save();
  return { cta };
}

module.exports = {
  listBanners,
  createBanner,
  updateBanner,
  removeBanner,
  listPromoBlocks,
  adminPromoBlocks,
  getPromoBlock,
  createPromoBlock,
  updatePromoBlock,
  removePromoBlock,
  getHomeSeo,
  updateHomeSeo,
  getSellerCta,
  updateSellerCta,
};
