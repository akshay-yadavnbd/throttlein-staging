const mongoose = require('mongoose');
const stripImageUrl = require('../../utils/stripImageUrl');

/**
 * Hierarchical category — supports unlimited nesting via self-referencing `parent`.
 * Top-level categories have parent = null.
 */
const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, lowercase: true, trim: true, index: true },
    description: { type: String, default: '' },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
      index: true,
    },
    icon: { type: String, default: '', set: stripImageUrl },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    // SEO overrides — when set they win over the auto-derived title /
    // description on the storefront category listing page. Kept
    // optional so existing categories are unaffected. Length caps mirror
    // Google's practical limits for title (~60) and description (~160).
    seoTitle: { type: String, default: '', trim: true, maxlength: 100 },
    seoDescription: { type: String, default: '', trim: true, maxlength: 200 },

    // ─── On-page content overrides (SEO copy) ──────────────────────
    // Top Content — replaces the H1 + intro line at the top of the
    // storefront category page when set. Plain text.
    contentTitle: { type: String, default: '', trim: true, maxlength: 150 },
    contentDescription: { type: String, default: '', trim: true, maxlength: 500 },
    // Bottom Content — SEO section rendered AFTER the product grid.
    // `bottomDescription` is sanitised rich-text HTML from the admin's
    // editor (keyword-rich copy, internal links, etc.).
    bottomTitle: { type: String, default: '', trim: true, maxlength: 150 },
    bottomDescription: { type: String, default: '' },
  },
  { timestamps: true },
);

categorySchema.index({ parent: 1, name: 1 }, { unique: true });

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/**
 * Reserved top-level path segments that the storefront uses for its
 * own routes. Categories live at `/<slug>` now, so any category that
 * resolves to one of these slugs would be invisible to users — the
 * static Next.js route always wins. Block them at save time so the
 * admin gets a clear error instead of a silent collision.
 *
 * Keep in sync with `frontend/app/*` top-level folder names.
 */
const RESERVED_CATEGORY_SLUGS = new Set([
  'account',
  'api',
  'blog',
  'brands',
  'c',
  'cart',
  'categories',
  'dashboard',
  'forgot-password',
  'locations',
  'login',
  'logout',
  'opengraph-image',
  'p',
  'page',
  'product',
  'products',
  'register',
  'reset-password',
  'robots',
  'sell',
  'seller',
  'signin',
  'signup',
  'sitemap',
  'static',
]);

categorySchema.pre('save', function () {
  if (!this.slug || (this.isModified('name') && !this.isModified('slug'))) {
    this.slug = slugify(this.name);
  } else if (this.isModified('slug')) {
    this.slug = slugify(this.slug);
  }
  if (RESERVED_CATEGORY_SLUGS.has(this.slug)) {
    // Surface the collision rather than letting it through — the
    // category would render an empty grid in production because Next
    // would route to the static page of the same name. Slug is a
    // user-facing thing, so the error message lists the alternatives.
    throw new Error(
      `Slug "${this.slug}" collides with a reserved storefront route. ` +
        `Pick a different slug — try a hyphenated variant (e.g. "${this.slug}-gear").`,
    );
  }
});

// Auto-cleanup S3 objects when image fields are replaced or the doc
// is deleted. See utils/imageCleanup.js for the diff-and-delete logic.
const { attachImageCleanup } = require('../../utils/imageCleanup');
attachImageCleanup(categorySchema, [{ path: 'icon' }]);

module.exports = mongoose.model('Category', categorySchema);
