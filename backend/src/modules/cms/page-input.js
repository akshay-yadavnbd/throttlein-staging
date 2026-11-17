/**
 * Page payload shaping — pure. Whitelists types and templates, builds the
 * `sellerCategory` subdocument by MERGING onto the existing one (Mongoose
 * replaces a subdocument wholesale on assignment, so a partial payload
 * would otherwise blank every field the editor didn't touch), and maps a
 * page to the storefront route to revalidate.
 */
const VALID_TYPES = new Set(['home', 'prose', 'dynamic', 'static-meta']);
const VALID_TEMPLATES = new Set([
  'products-list',
  'brands-list',
  'categories-list',
  'seller-category',
  // Layout variant — same data, same /sell-online/<slug> URL, different renderer.
  'seller-category-2',
]);

/**
 * Both properties are served by ONE Next app; the seller host's clean
 * URLs are rewritten by frontend/proxy.ts onto `/seller/c/...`, and ISR
 * keys on that INTERNAL path. Keep in sync with the proxy rewrite and
 * frontend/app/seller/c/[...path]/page.tsx.
 */
const SITE_ROUTE_PREFIX = { main: '', seller: '/seller/c' };

/** The storefront path a page renders at, or null when it has none. */
function pageToRoute(page) {
  if (!page) return null;
  let path = null;
  if (page.type === 'home') path = '/';
  else if (page.type === 'static-meta') path = page.staticRoute || null;
  else if (page.type === 'prose') {
    // Main serves prose under /page/<slug>; the seller property at its root.
    path = page.slug ? (page.site === 'seller' ? `/${page.slug}` : `/page/${page.slug}`) : null;
  } else if (page.type === 'dynamic') {
    // Seller-category pages hang off the Sell Online page.
    path =
      ['seller-category', 'seller-category-2'].includes(page.template) && page.slug
        ? `/sell-online/${page.slug}`
        : page.staticRoute || (page.slug ? `/${page.slug}` : null);
  }
  if (!path) return null;
  const prefix = SITE_ROUTE_PREFIX[page.site] ?? '';
  if (!prefix) return path;
  return path === '/' ? prefix : `${prefix}${path}`;
}

/** Any pasted YouTube reference → its bare 11-character id, or '' when unrecognised. */
function extractYouTubeId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/embed\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
    /\/live\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) return m[1];
  }
  return '';
}

const SELLER_CATEGORY_TEXT = [
  'linkTitle',
  'noun',
  'nounPlural',
  'heroBodyOne',
  'heroBodyTwo',
  'heroImage',
  'expandHeading',
  'expandBody',
  'expandImage',
  'whyHeading',
  'whyIntro',
  'stepsHeading',
  'stepsIntro',
  'closingImage',
  'eligibilityBody',
  'eligibilityImage',
  'eligibilityHeading',
  'videoHeading',
  'videoThumbnail',
  // Deprecated, still accepted so an older client can't wipe them.
  'eligibilityIntro',
  'eligibilityFootnote',
];

const cleanStrings = (list) => list.map((v) => String(v ?? '').trim()).filter(Boolean);

/** Merge a `sellerCategory` payload onto the existing subdocument (absent on create). */
function pickSellerCategory(input, existing) {
  if (!input || typeof input !== 'object') return undefined;
  const base = existing
    ? JSON.parse(JSON.stringify(typeof existing.toObject === 'function' ? existing.toObject() : existing))
    : {};
  delete base._id;
  const out = base;
  for (const k of SELLER_CATEGORY_TEXT) if (input[k] !== undefined) out[k] = String(input[k] ?? '');
  // Stored as the id, never a URL; junk is stored blank, which hides the section.
  if (input.videoId !== undefined) out.videoId = extractYouTubeId(input.videoId);
  if (Array.isArray(input.eligibilityImages)) out.eligibilityImages = cleanStrings(input.eligibilityImages);
  if (Array.isArray(input.eligibilityItems)) out.eligibilityItems = cleanStrings(input.eligibilityItems);
  // A row with no title is an empty repeater row; dropping it keeps the
  // renderer's "empty array → static fallback" contract.
  for (const arrKey of ['whyCards', 'steps']) {
    if (Array.isArray(input[arrKey])) {
      out[arrKey] = input[arrKey]
        .map((c) => ({
          title: String(c?.title ?? '').trim(),
          body: String(c?.body ?? ''),
          image: String(c?.image ?? ''),
        }))
        .filter((c) => c.title);
    }
  }
  if (Array.isArray(input.faq)) {
    out.faq = input.faq
      .map((f) => ({ question: String(f?.question ?? '').trim(), answer: String(f?.answer ?? '') }))
      .filter((f) => f.question);
  }
  return out;
}

/** Dynamic-page fields (template, parentCategory, staticRoute, sellerCategory, filter), shaped and whitelisted. */
function pickDynamicFields(body, existing) {
  const out = {};
  if (body.template !== undefined && VALID_TEMPLATES.has(body.template)) out.template = body.template;
  if (body.parentCategory !== undefined) out.parentCategory = body.parentCategory || null;
  if (body.staticRoute !== undefined) out.staticRoute = String(body.staticRoute || '').trim();
  if (body.sellerCategory !== undefined) {
    const sc = pickSellerCategory(body.sellerCategory, existing?.sellerCategory);
    if (sc) out.sellerCategory = sc;
  }
  if (body.filter !== undefined && body.filter && typeof body.filter === 'object') {
    const f = body.filter;
    const toIdList = (v) => (Array.isArray(v) ? [...new Set(v.filter(Boolean).map(String))] : []);
    out.filter = {
      category: f.category || null,
      brand: f.brand || null,
      product: f.product || null,
      categories: toIdList(f.categories),
      brands: toIdList(f.brands),
      locationLevel: ['city', 'state', 'country'].includes(f.locationLevel) ? f.locationLevel : '',
      locationValue: String(f.locationValue || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    };
  }
  return out;
}

module.exports = { VALID_TYPES, VALID_TEMPLATES, pageToRoute, extractYouTubeId, pickSellerCategory, pickDynamicFields };
