const mongoose = require('mongoose');
const stripImageUrl = require('../../utils/stripImageUrl');
const { SITES, DEFAULT_SITE } = require('../../config/sites');

/**
 * BlogPost — primary blog content entity.
 *
 * Lifecycle (status field):
 *   - draft       → not yet visible to the public; default for new posts
 *   - published   → live on /blog (when publishedAt is in the past)
 *   - scheduled   → publishedAt is a future timestamp; cron / on-demand
 *                   query upgrades to published when the time arrives
 *   - archived    → hidden from list pages but still resolvable by slug
 *
 * Reading time is auto-calculated from the body's word count on save
 * (avg 220 wpm). Excerpt is auto-derived from body if not explicitly
 * set so the storefront cards always have something to show.
 *
 * SEO fields (metaTitle, metaDescription, ogImage) override the
 * defaults that would otherwise be derived from title/excerpt/image.
 */
const STATUSES = ['draft', 'published', 'scheduled', 'archived'];

const blogPostSchema = new mongoose.Schema(
  {
    // Which public property this post belongs to — 'main'
    // (throttlein.com) or 'seller' (seller.throttlein.com). A post
    // lives on exactly one site; cross-posting means two records.
    site: {
      type: String,
      enum: SITES,
      default: DEFAULT_SITE,
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    // Unique PER SITE — see the compound index near the bottom of this
    // file. The -2/-3 collision resolver in pre('save') is scoped to
    // the same site for the same reason.
    slug: {
      type: String,
      lowercase: true,
      trim: true,
    },
    excerpt: { type: String, default: '', trim: true },
    body: { type: String, default: '' }, // HTML produced by TipTap

    // Featured image used in the index card hero, detail page top, and
    // social/OG previews when `ogImage` is empty. Stored as a bare S3
    // key or a /uploads/ path — same convention as Product.images.
    featuredImage: { type: String, default: '', set: stripImageUrl },

    // Byline — references the CMS-curated BlogAuthor (distinct from the
    // User collection so we can have writer personas without giving them
    // login accounts). Optional; posts without an explicit author fall
    // back to a generic "Throttlein Team" label on the storefront.
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BlogAuthor',
      default: null,
      index: true,
    },
    // Audit trail — the admin User who actually created the post. Kept
    // separate from the byline so we can still see "who wrote this in
    // the CMS" even when the public byline is set to a different
    // BlogAuthor persona.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    // Primary category — used for the category pill on listing cards
    // and the JSON-LD structured data. Kept as a singular field for
    // backward compatibility with existing storefront code.
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BlogCategory',
      index: true,
    },
    // Additional categories — full multi-select set. Includes the
    // primary one. Used by filters that want to show a post in any of
    // its categories.
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BlogCategory', index: true }],
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BlogTag', index: true }],

    status: { type: String, enum: STATUSES, default: 'draft', index: true },

    // Scheduled-publish timestamp. For status='published' this is when
    // the post WAS published (sorting + display). For status='scheduled'
    // this is when it WILL publish. For draft/archived it's null.
    publishedAt: { type: Date, default: null, index: true },

    // Word-count derived; pre-save hook keeps it in sync.
    readingMinutes: { type: Number, default: 1 },

    // SEO overrides (all optional — fall back to title/excerpt/featured)
    metaTitle: { type: String, default: '' },
    metaDescription: { type: String, default: '' },
    ogImage: { type: String, default: '', set: stripImageUrl },

    // Heading shown above the FAQ accordion on the public article. Falls
    // back to "Have any questions?" when blank. Lets admins customise the
    // section title per post (e.g. "Common helmet questions").
    faqHeading: { type: String, default: '', trim: true },

    // Optional FAQ block rendered at the bottom of the article (accordion
    // section in the Figma). Capped at 10 to keep page size reasonable.
    faqs: {
      type: [
        {
          question: { type: String, required: true, trim: true },
          answer: { type: String, default: '', trim: true },
        },
      ],
      default: [],
      validate: [(arr) => !arr || arr.length <= 10, 'A blog post can have at most 10 FAQs.'],
    },

    // Key takeaways — bulleted/rich-text summary block rendered near
    // the top of the article body on the storefront. Stored as HTML
    // produced by the same TipTap editor we use for the body, so
    // authors can use bold, links, nested lists.
    keyTakeaways: { type: String, default: '' },

    // References / sources — list of citation links shown at the end
    // of the article. Each row is a {title, url} pair so we can render
    // a clean numbered list. Capped at 30 to keep the document small
    // and the storefront page reasonable.
    references: {
      type: [
        {
          title: { type: String, required: true, trim: true },
          url: { type: String, required: true, trim: true },
        },
      ],
      default: [],
      validate: [(arr) => !arr || arr.length <= 30, 'A blog post can have at most 30 references.'],
    },

    isFeatured: { type: Boolean, default: false, index: true },

    /**
     * When the post's CONTENT was last edited — maintained by the
     * pre-save hook below, which ignores counter-only writes.
     *
     * Why not just use `updatedAt`? Because `updatedAt` moves on ANY
     * write to the document, and the storefront bumps `viewCount` on
     * every article view. That made every published post look edited
     * today: the admin list showed one identical date for all posts and
     * the sitemap handed crawlers a fresh `lastmod` on every visit.
     * The counter writes now pass `timestamps: false`, and this field is
     * the explicit, display-safe signal.
     *
     * Absent on posts that predate it — readers should fall back to
     * `publishedAt`, which is the correct thing to show for a post that
     * has never been edited since publishing.
     */
    contentUpdatedAt: { type: Date, default: null },

    // Stats — incremented by storefront pings. Comments count is kept
    // in sync by BlogComment's post-save hook.
    viewCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
  },
  { timestamps: true, statics: { STATUSES } },
);

// Search index — title + excerpt + body text-search. Used by the admin
// list page's search field. (Mongo allows only ONE text index per
// collection, so this can't be compounded with `site`; the site filter
// is applied alongside the $text clause in the query instead.)
blogPostSchema.index({ title: 'text', excerpt: 'text' });

// Slug is unique PER SITE, not globally.
blogPostSchema.index({ site: 1, slug: 1 }, { unique: true });
// Hot read paths: public list (site + status + publishedAt) and the
// admin list (site + updatedAt).
blogPostSchema.index({ site: 1, status: 1, publishedAt: -1 });
blogPostSchema.index({ site: 1, updatedAt: -1 });

function slugifyBase(input) {
  return (
    String(input || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'post'
  );
}

/** Strip HTML tags + collapse whitespace to count words for reading time. */
function plainTextWordCount(html) {
  if (!html) return 0;
  const stripped = String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ');
  const words = stripped.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/** Cheap excerpt — first ~30 words of the body, stripped of HTML. */
function autoExcerpt(html, maxWords = 30) {
  if (!html) return '';
  const stripped = String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = stripped.split(' ');
  if (words.length <= maxWords) return stripped;
  return words.slice(0, maxWords).join(' ') + '…';
}

blogPostSchema.pre('save', async function () {
  // ── Slug: derive from title, ensure uniqueness with -2, -3, …
  if (this.isModified('title') || !this.slug) {
    const base = slugifyBase(this.slug || this.title);
    let candidate = base;
    let n = 1;
    // Uniqueness is per-site: a seller post called "About Us" must not
    // become "about-us-2" just because the main site already has one.
    while (
      await this.$model().exists({
        site: this.site || DEFAULT_SITE,
        slug: candidate,
        _id: { $ne: this._id },
      })
    ) {
      n += 1;
      candidate = `${base}-${n}`;
      if (n > 50) {
        candidate = `${base}-${Date.now().toString(36)}`;
        break;
      }
    }
    this.slug = candidate;
  }

  // ── Auto-fill excerpt from body if blank
  if (!this.excerpt && this.body) {
    this.excerpt = autoExcerpt(this.body);
  }

  // ── Recalc reading time on body change. 220 wpm is a comfortable
  // pace for casual readers; rounds up so a ~50-word post still says
  // "1 min read" instead of 0.
  if (this.isModified('body')) {
    const words = plainTextWordCount(this.body);
    this.readingMinutes = Math.max(1, Math.round(words / 220));
  }

  // ── publishedAt rules: when transitioning to 'published' for the
  // first time, stamp now. Scheduled posts keep their future date.
  if (this.isModified('status')) {
    if (this.status === 'published' && !this.publishedAt) {
      this.publishedAt = new Date();
    }
    if (this.status === 'scheduled' && !this.publishedAt) {
      // Defensive — controller should enforce this, but if a scheduled
      // post arrives without a date, default to "now + 1 day".
      this.publishedAt = new Date(Date.now() + 24 * 3600 * 1000);
    }
    if (this.status === 'draft' || this.status === 'archived') {
      // leave publishedAt as-is so re-publishing keeps its history
    }
  }

  /* ── contentUpdatedAt ──────────────────────────────────────────────
   * Stamp the display date only when something a READER would notice
   * changed. Counters and the timestamps Mongoose manages are excluded,
   * so a view or a comment never reads as an edit. On creation it stays
   * null — an unedited post should display its publish date. */
  if (!this.isNew) {
    const INCIDENTAL = new Set(['viewCount', 'commentCount', 'contentUpdatedAt', 'createdAt', 'updatedAt', '__v']);
    const substantive = this.modifiedPaths().some((p) => {
      const root = String(p).split('.')[0];
      return !INCIDENTAL.has(root);
    });
    if (substantive) this.contentUpdatedAt = new Date();
  }
});

// Auto-cleanup S3 objects when image fields are replaced or the doc
// is deleted. See utils/imageCleanup.js for the diff-and-delete logic.
const { attachImageCleanup } = require('../../utils/imageCleanup');
attachImageCleanup(blogPostSchema, [
  { path: 'featuredImage' },
  { path: 'ogImage' },
  { path: 'body', isHtml: true },
  { path: 'keyTakeaways', isHtml: true },
]);

module.exports = mongoose.model('BlogPost', blogPostSchema);
