const mongoose = require('mongoose');
const { SITES, DEFAULT_SITE } = require('../../config/sites');

/**
 * Page — generic static-prose page model.
 *
 * Drives storefront marketing surfaces that are mostly text: About,
 * Privacy Policy, Terms of Service, FAQ, Contact, Shipping, Returns,
 * etc. Each page is keyed by a URL-friendly `slug` and (for prose
 * pages) renders at `/page/<slug>` on the customer site.
 *
 * Pages are scoped to a `site` — 'main' (throttlein.com) or 'seller'
 * (seller.throttlein.com). Slugs are unique per site, so both
 * properties can own an "/about".
 *
 * The Pages admin (Admin → Pages → "Prose pages" row) provides CRUD —
 * admins can add new pages from there without code changes, so the
 * marketing/legal team can ship copy directly.
 */
const pageSchema = new mongoose.Schema(
  {
    // Which public property this page belongs to:
    //   'main'   → throttlein.com
    //   'seller' → seller.throttlein.com
    // Drives every read/write query and the storefront route prefix.
    // Defaults to 'main' so pre-multi-site rows keep their behaviour.
    site: {
      type: String,
      enum: SITES,
      default: DEFAULT_SITE,
      required: true,
      index: true,
    },
    // URL-friendly identifier — used in storefront routes
    // (/page/<slug> for prose, /<slug> for dynamic).
    // Auto-generated from title if empty. Unique PER SITE, not
    // globally — both properties may legitimately own an "/about".
    // The compound index is declared below via schema.index().
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    // Display title shown at the top of the page + in the <title> tag
    // when seoTitle is empty.
    title: { type: String, required: true, trim: true },
    // `type` discriminates the broad editor surface this page uses.
    // Kept for backcompat with existing rows; new code should branch
    // on `template` below for finer-grained behaviour.
    //   - 'home'    → SEO meta + section blocks (Hero banners,
    //                 Trending products). Body field is unused.
    //   - 'prose'   → SEO meta + Markdown body, rendered at /p/<slug>.
    //   - 'dynamic' → Template-driven page (products-list, brands-list,
    //                 categories-list). See `template`.
    //   - 'static-meta' → SEO meta override for a hard-coded route
    //                 (e.g. /products, /sell). `staticRoute` carries
    //                 the path.
    type: { type: String, enum: ['home', 'prose', 'dynamic', 'static-meta'], default: 'prose', index: true },

    // Template — only meaningful for type='dynamic'. Drives which
    // storefront renderer the page maps to.
    //   - 'products-list'    → category-style grid filtered by
    //                          filter.category + filter.brand + filter.location*
    //   - 'brands-list'      → renders like /brands
    //   - 'categories-list'  → renders like /categories
    //   - 'seller-category' → SELLER-property landing page for one product
    //                         category ("Sell Helmets Online"). Nested under
    //                         the Sell Online page: /sell-online/<slug>.
    template: {
      type: String,
      enum: ['products-list', 'brands-list', 'categories-list', 'seller-category', 'seller-category-2'],
      default: 'products-list',
    },

    // Optional parent category — drives the URL prefix for dynamic
    // pages. With parent set, URL = /<parentCategory.slug>/<slug>.
    // Without, URL = /locations/<slug> (safe namespace).
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
      index: true,
    },

    // Hard-coded storefront route this page provides SEO overrides for.
    // Used only when type='static-meta'. E.g. '/', '/products', '/sell'.
    staticRoute: { type: String, default: '', trim: true, index: true },

    // Saved filter that the dynamic templates render against. All fields
    // optional — a products-list page with no filter shows everything.
    filter: {
      category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
      brand: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', default: null },
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
      // Multi-select variants — a products-list page can aggregate
      // SEVERAL categories and/or brands. `category` above stays the
      // PRIMARY one (it drives the URL prefix); `categories` holds the
      // additional ones. `brand` is only set when exactly one brand is
      // picked (it adds the /<brand>/ URL segment); `brands` always
      // holds the full selection.
      categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
      brands: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Brand' }],
      // One of 'city' | 'state' | 'country' — picks which Product
      // location field to match. Value is a slug.
      locationLevel: { type: String, enum: ['', 'city', 'state', 'country'], default: '' },
      locationValue: { type: String, default: '', lowercase: true, trim: true },
    },
    // Body content. Stored as Markdown so we can render with a small
    // client-side parser; storage stays human-readable and diffable.
    // Only used when `type === 'prose'`.
    body: { type: String, default: '' },
    // SEO meta — both optional. Fall back to `title` and the first
    // paragraph of `body` when blank.
    seoTitle: { type: String, default: '' },
    seoDescription: { type: String, default: '' },
    // OG image — preview thumbnail shown when the page URL is shared on
    // social platforms (Facebook, X, WhatsApp link cards, etc.).
    // Stored as a resolvable image URL (proxy or local upload path).
    ogImage: { type: String, default: '' },
    // On-page content overrides — used by static-meta records for
    // listing pages (/products etc.): Top Content replaces the H1 +
    // intro line, Bottom Content renders after the product grid
    // (`bottomDescription` is admin rich-text HTML for SEO copy).
    contentTitle: { type: String, default: '', trim: true },
    contentDescription: { type: String, default: '', trim: true },
    bottomTitle: { type: String, default: '', trim: true },
    bottomDescription: { type: String, default: '' },

    /**
     * Fields for template='seller-category' — the "Sell <X> Online" landing
     * pages on the seller property.
     *
     * ONLY the category-specific parts live here. The design's benefit cards,
     * "why sell" cards, 7 onboarding steps, video, tips and closing CTA are
     * effectively identical for every category, so they are defined once in
     * frontend/lib/sellerCategoryContent.ts rather than copied into every
     * page record — otherwise a wording change means re-editing every page.
     *
     * `noun` / `nounPlural` are substituted into those shared headings via a
     * {category} token, which is what lets them stay shared while still
     * reading as "Why Sell Motorcycle Helmets on ThrottleIn?".
     *
     * The "types" and "brands" grids are NOT stored here — they resolve live
     * from `filter.category`'s child categories and the brands present in it,
     * so they can't go stale as the catalogue grows.
     */
    sellerCategory: {
      /**
       * "Sell Helmets Online" — the SHORT label used wherever this page is
       * listed as a link: the "Choose Your Categories" box on the Sell
       * Online page and the "Popular categories to sell across India" band
       * in the seller footer.
       *
       * Separate from `title` on purpose. `title` is the H1 and the SEO
       * title, so it wants to be descriptive ("Sell Helmets Online on
       * ThrottleIn"); repeated sixteen times in a footer grid that reads as
       * noise. Blank falls back to `title`, so a page without one still
       * links correctly.
       */
      linkTitle: { type: String, default: '', trim: true },

      // "Helmets" — used in headings and the parent page's category list.
      noun: { type: String, default: '', trim: true },
      // "motorcycle helmets" — the longer form used mid-sentence.
      nounPlural: { type: String, default: '', trim: true },

      // Hero: H1 comes from `title`; these are the two paragraphs + image.
      heroBodyOne: { type: String, default: '' },
      heroBodyTwo: { type: String, default: '' },
      heroImage: { type: String, default: '' },

      // "Expand Your <X> Business Online" — long-form SEO copy + wide image.
      expandHeading: { type: String, default: '', trim: true },
      expandBody: { type: String, default: '' },
      expandImage: { type: String, default: '' },

      /* "Why Sell <X> on ThrottleIn?" — the auto-advancing slider on the
       * Template-2 layout. Heading + intro + one card per slide (title,
       * paragraph, optional image). ALL optional: blank fields / an empty
       * array fall back to the shared static copy in
       * frontend/lib/sellerCategoryContent.ts, so pages authored before
       * these fields existed keep rendering unchanged. A card without an
       * uploaded image gets the built-in hub-and-spoke illustration. */
      whyHeading: { type: String, default: '', trim: true },
      whyIntro: { type: String, default: '' },
      whyCards: [
        {
          _id: false,
          title: { type: String, default: '', trim: true },
          body: { type: String, default: '' },
          image: { type: String, default: '' },
        },
      ],

      // "Who Can Sell <X> on ThrottleIn?" — one rich-text block for the whole
      // left column (intro + bullet list + footnote) plus the side image.
      // List items authored as <ul><li> get the circle-check treatment from
      // the design, applied in CSS by the renderer.
      eligibilityBody: { type: String, default: '' },
      eligibilityImage: { type: String, default: '' },
      /* Template-2 "Who can sell" banner. `eligibilityHeading` overrides
       * the shared section heading (blank → fallback). `eligibilityImages`
       * is the photo collage on the banner's right — ordered, any count;
       * empty falls back to the single `eligibilityImage` above. */
      eligibilityHeading: { type: String, default: '', trim: true },
      eligibilityImages: [{ type: String, trim: true }],

      /* DEPRECATED — superseded by `eligibilityBody` above, which merged these
       * three into a single rich-text field. Retained so existing records keep
       * rendering until they're re-saved (the admin composes them into HTML on
       * load, so the migration happens on the next save). Safe to drop once no
       * page has them set. */
      eligibilityIntro: { type: String, default: '' },
      eligibilityItems: [{ type: String, trim: true }],
      eligibilityFootnote: { type: String, default: '' },

      /* Closing CTA band background photo (Template 2, Figma 4853-916).
       * Blank falls back to the shared static closing image. */
      closingImage: { type: String, default: '' },

      /* "How to Register" steps accordion (Template 2, Figma 4853-754).
       * Heading + intro + one card per step (title, body, optional wide
       * image shown when the card is open). All optional — blank fields /
       * an empty array fall back to the shared static steps in
       * frontend/lib/sellerCategoryContent.ts. */
      stepsHeading: { type: String, default: '', trim: true },
      stepsIntro: { type: String, default: '' },
      steps: [
        {
          _id: false,
          title: { type: String, default: '', trim: true },
          body: { type: String, default: '' },
          image: { type: String, default: '' },
        },
      ],

      /**
       * "Watch seller onboarding guide" video block.
       *
       * Was a hard-coded constant in the frontend, so every category
       * page showed the same walkthrough and changing it meant a
       * deploy. Now per-page and optional — the whole section is
       * omitted when `videoId` is blank, rather than rendering a play
       * button that goes nowhere.
       *
       * `videoId` stores the BARE YouTube id (e.g. `dQw4w9WgXcQ`), not
       * a URL. The admin accepts a pasted watch/share/embed link and
       * extracts the id before saving, so editors don't have to care —
       * but what's persisted is always the id, which is what the embed
       * URL needs and what keeps the field robust to YouTube changing
       * its link formats.
       */
      videoHeading: { type: String, default: '', trim: true },
      videoThumbnail: { type: String, default: '' },
      videoId: { type: String, default: '', trim: true },

      // Per-page FAQ. Shared FAQ would be wrong here — the questions are
      // category-specific and this block also emits FAQPage JSON-LD.
      faq: [
        {
          _id: false,
          question: { type: String, default: '', trim: true },
          answer: { type: String, default: '' },
        },
      ],
    },
    // Draft toggle. Unpublished pages return 404 on the public route
    // but are still listed in the admin so editors can stage drafts.
    isPublished: { type: Boolean, default: true },
    // Manual sort key for the admin table.
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const { slugify, RESERVED_TOP_LEVEL_SLUGS, RESERVED_SLUGS_BY_SITE } = require('./page-slugs');

pageSchema.pre('save', function () {
  // Slug rules:
  //   - New page with no slug → derive it from the title (quick-add).
  //   - Slug explicitly set/changed → normalise it.
  //   - Existing page whose TITLE changes → keep the slug stable. This is
  //     important: prose pages (Privacy, Terms, …) are linked from the
  //     footer/sitemap by slug, so renaming a page's title in the admin
  //     must NOT silently change its URL and break those links.
  if (this.isNew && !this.slug) {
    this.slug = slugify(this.title);
  } else if (this.isModified('slug')) {
    this.slug = slugify(this.slug);
  }
  // Reserved-word guard for top-level (parentCategory-less) dynamic pages.
  // Uses the reserved set for THIS page's site — the two properties have
  // different built-in routes.
  const reserved = RESERVED_SLUGS_BY_SITE[this.site] || RESERVED_TOP_LEVEL_SLUGS;
  if (
    this.type === 'dynamic' &&
    !this.parentCategory &&
    // seller-category pages are nested under /sell-online/, so they never
    // occupy the property root and can't shadow a built-in route — the same
    // reasoning that exempts pages with a parentCategory.
    !['seller-category', 'seller-category-2'].includes(this.template) &&
    reserved.has(this.slug)
  ) {
    throw new Error(
      `Slug "${this.slug}" collides with a built-in route. Pick a different slug or attach this page to a parent category.`,
    );
  }
});

// Slug is unique PER SITE. Declared here rather than inline on the field
// so the two-key shape is explicit and Mongoose doesn't warn about a
// duplicate index declaration.
pageSchema.index({ site: 1, slug: 1 }, { unique: true });
// Common read paths: the admin list and the storefront route resolver
// both filter by site first.
pageSchema.index({ site: 1, type: 1 });
pageSchema.index({ site: 1, staticRoute: 1 });

// Auto-cleanup S3 objects when image fields are replaced or the doc
// is deleted. See utils/imageCleanup.js for the diff-and-delete logic.
const { attachImageCleanup } = require('../../utils/imageCleanup');
attachImageCleanup(pageSchema, [{ path: 'ogImage' }, { path: 'body', isHtml: true }]);

module.exports = mongoose.model('Page', pageSchema);
module.exports.RESERVED_SLUGS_BY_SITE = RESERVED_SLUGS_BY_SITE;
