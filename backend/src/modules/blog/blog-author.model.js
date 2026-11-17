const mongoose = require('mongoose');

/**
 * BlogAuthor — bylines for blog posts. Distinct from the platform's
 * User collection because blog authors are CMS-curated personas (their
 * full identity is shown in the article meta strip + end-of-article
 * card), not application accounts. Multiple posts can share one author;
 * an author can never log in.
 *
 * Surface in the storefront:
 *   - Avatar + name appear in the post's meta strip
 *   - Avatar, role, bio, and credential chips render in the
 *     end-of-article author card
 *   - Future /blog/author/<slug> archive lists every post by the author
 */
const blogAuthorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, lowercase: true, trim: true, unique: true, index: true },
    role: { type: String, default: '', trim: true },
    bio: { type: String, default: '', trim: true, maxlength: 1200 },
    avatarUrl: { type: String, default: '' },
    /** Trust-signal pills rendered on the end-of-article card. Max 8
     *  enforced at the controller level (model just caps for safety). */
    credentials: {
      type: [{ type: String, trim: true }],
      default: [],
      validate: {
        validator(arr) {
          return Array.isArray(arr) && arr.length <= 12;
        },
        message: 'Up to 12 credential chips.',
      },
    },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
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
      .slice(0, 80) || 'author'
  );
}

blogAuthorSchema.pre('save', async function () {
  // Slug auto-derives from name. Collision-resolves with -2, -3, …
  if (!this.slug || (this.isModified('name') && !this.isModified('slug'))) {
    const base = slugify(this.name);
    let candidate = base;
    let n = 1;
    while (await this.$model().exists({ slug: candidate, _id: { $ne: this._id } })) {
      n += 1;
      candidate = `${base}-${n}`;
      if (n > 50) {
        candidate = `${base}-${Date.now().toString(36)}`;
        break;
      }
    }
    this.slug = candidate;
  } else if (this.isModified('slug')) {
    this.slug = slugify(this.slug);
  }
});

// Auto-cleanup S3 objects when image fields are replaced or the doc
// is deleted. See utils/imageCleanup.js for the diff-and-delete logic.
const { attachImageCleanup } = require('../../utils/imageCleanup');
attachImageCleanup(blogAuthorSchema, [{ path: 'avatarUrl' }]);

module.exports = mongoose.model('BlogAuthor', blogAuthorSchema);
