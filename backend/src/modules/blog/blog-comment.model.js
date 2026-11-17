const mongoose = require('mongoose');
const { SITES, DEFAULT_SITE } = require('../../config/sites');

/**
 * BlogComment — public comment thread per post.
 *
 * Moderation:
 *   - status='pending'   → newly submitted, hidden until approved
 *   - status='approved'  → publicly visible
 *   - status='spam'      → hidden, kept for audit
 *   - status='rejected'  → hidden, soft-deleted
 *
 * Comments support a single level of replies via `parent`. Two-deep
 * threading is enough for blog discussion; nested-replies grow into
 * Reddit territory which the storefront layout isn't designed for.
 *
 * Author identification:
 *   - If `user` is set, the comment is from a logged-in customer/seller
 *   - Else `guestName` + `guestEmail` carry the public submission
 *     (email is kept for moderation contact, never shown publicly)
 */
const STATUSES = ['pending', 'approved', 'spam', 'rejected'];

const blogCommentSchema = new mongoose.Schema(
  {
    // Denormalised from the parent post's `site`. Strictly derivable via
    // a join, but the admin moderation queue filters by site on every
    // load — a copied indexed field turns that into a single-collection
    // query. Set by the controller on create; never edited afterwards.
    site: {
      type: String,
      enum: SITES,
      default: DEFAULT_SITE,
      required: true,
      index: true,
    },

    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BlogPost',
      required: true,
      index: true,
    },

    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BlogComment',
      default: null,
      index: true,
    },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    guestName: { type: String, default: '', trim: true },
    guestEmail: { type: String, default: '', trim: true, lowercase: true },

    body: { type: String, required: true, trim: true },

    status: { type: String, enum: STATUSES, default: 'pending', index: true },

    // Reviewer audit trail
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true, statics: { STATUSES } },
);

module.exports = mongoose.model('BlogComment', blogCommentSchema);
