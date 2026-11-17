const mongoose = require('mongoose');
const { SITES, DEFAULT_SITE } = require('../../config/sites');

/**
 * Blog category — taxonomy entry for blog posts. A post can be assigned
 * to one primary category plus any number of additional categories
 * (see BlogPost.category + BlogPost.categories). Categories may also
 * nest via the optional `parent` field, so the admin can build a
 * shallow hierarchy (e.g. "Riding tips" › "Touring tips").
 *
 * Auto-slugged from name on save. Name and slug are unique PER SITE so
 * storefront URLs (/blog/category/<slug>) resolve unambiguously within
 * a property while letting both properties own e.g. a "News" category.
 */
const blogCategorySchema = new mongoose.Schema(
  {
    // 'main' (throttlein.com) or 'seller' (seller.throttlein.com).
    site: {
      type: String,
      enum: SITES,
      default: DEFAULT_SITE,
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    slug: { type: String, lowercase: true, trim: true },
    description: { type: String, default: '' },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    // Optional parent — null for top-level categories. Self-referential
    // ref lets us build a shallow tree (Settings page validates against
    // cycles before saving).
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BlogCategory',
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

function slugify(s) {
  return (
    String(s || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'category'
  );
}

blogCategorySchema.pre('save', function () {
  if (!this.slug || (this.isModified('name') && !this.isModified('slug'))) {
    this.slug = slugify(this.name);
  } else if (this.isModified('slug')) {
    this.slug = slugify(this.slug);
  }
});

// Name and slug are unique PER SITE, not globally.
blogCategorySchema.index({ site: 1, slug: 1 }, { unique: true });
blogCategorySchema.index({ site: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('BlogCategory', blogCategorySchema);
