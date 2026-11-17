const mongoose = require('mongoose');
const { SITES, DEFAULT_SITE } = require('../../config/sites');

/**
 * Blog tag — multi-select per post. Free-form labels used for grouping
 * posts beyond the single primary category (e.g. "winter-gear",
 * "first-bike", "tail-light-review"). Storefront uses tag pages at
 * /blog/tag/<slug> for SEO long-tail.
 *
 * Tag list is intended to grow organically — admin creates tags either
 * via the Tags admin page or by typing a new one into the post editor's
 * tag picker (which calls findOrCreate on the backend).
 */
const blogTagSchema = new mongoose.Schema(
  {
    // 'main' (throttlein.com) or 'seller' (seller.throttlein.com).
    // Name/slug uniqueness is scoped to the site — see indexes below.
    site: {
      type: String,
      enum: SITES,
      default: DEFAULT_SITE,
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    slug: { type: String, lowercase: true, trim: true },
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
      .slice(0, 60) || 'tag'
  );
}

blogTagSchema.pre('save', function () {
  if (!this.slug || (this.isModified('name') && !this.isModified('slug'))) {
    this.slug = slugify(this.name);
  } else if (this.isModified('slug')) {
    this.slug = slugify(this.slug);
  }
});

// Name and slug are unique PER SITE, not globally.
blogTagSchema.index({ site: 1, slug: 1 }, { unique: true });
blogTagSchema.index({ site: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('BlogTag', blogTagSchema);
