const mongoose = require('mongoose');
const stripImageUrl = require('../../utils/stripImageUrl');

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, lowercase: true, trim: true, index: true },
    logo: { type: String, default: '', set: stripImageUrl }, // URL or relative path to logo image
    website: { type: String, default: '' },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    // `featured` brands surface in the homepage Top Brands rail. Brands
    // can still be `isActive: true` but `featured: false` — that means
    // they show on the /brands index but not the homepage shortcut.
    featured: { type: Boolean, default: false },
    order: { type: Number, default: 0 },

    // ─── SEO overrides ─────────────────────────────────────────────
    // Optional per-brand metadata. When set, takes precedence over the
    // auto-generated values in the storefront's brand detail
    // generateMetadata.
    seoTitle: { type: String, default: '', trim: true, maxlength: 100 },
    seoDescription: { type: String, default: '', trim: true, maxlength: 200 },
    ogImage: { type: String, default: '', trim: true },

    // ─── On-page content overrides (SEO copy) ─────────────────────
    // Top Content — replaces the heading + intro line on the brand
    // landing page when set. Bottom Content renders AFTER the product
    // grid; `bottomDescription` is rich-text HTML from the admin.
    contentTitle: { type: String, default: '', trim: true, maxlength: 150 },
    contentDescription: { type: String, default: '', trim: true, maxlength: 500 },
    bottomTitle: { type: String, default: '', trim: true, maxlength: 150 },
    bottomDescription: { type: String, default: '' },
  },
  { timestamps: true },
);

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

brandSchema.pre('save', function () {
  if (!this.slug || (this.isModified('name') && !this.isModified('slug'))) {
    this.slug = slugify(this.name);
  } else if (this.isModified('slug')) {
    this.slug = slugify(this.slug);
  }
});

// Auto-cleanup S3 objects when image fields are replaced or the doc
// is deleted. See utils/imageCleanup.js for the diff-and-delete logic.
const { attachImageCleanup } = require('../../utils/imageCleanup');
attachImageCleanup(brandSchema, [{ path: 'logo' }, { path: 'ogImage' }]);

module.exports = mongoose.model('Brand', brandSchema);
