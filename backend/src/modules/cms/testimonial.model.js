const mongoose = require('mongoose');
const stripImageUrl = require('../../utils/stripImageUrl');
const { SITES, DEFAULT_SITE } = require('../../config/sites');

/**
 * Testimonial — admin-managed seller success stories.
 *
 * Replaces the hardcoded `TESTIMONIALS` array in
 * frontend/lib/sellOnlineContent.ts, which held exactly one entry and
 * could only be changed by shipping code. Staff now manage the lineup
 * from the Testimonials tab in the super admin panel.
 *
 * Rendered by:
 *   - the "Seller Success Stories" carousel on every seller-category
 *     page (/sell-online/<slug>)
 *   - the testimonials section on the Sell Online landing page
 *
 * ── WHY SITE-SCOPED ──────────────────────────────────────────────
 * Unlike PromoBlock and SellerCta (which are main-site singletons and
 * therefore carry no `site`), testimonials are wanted on BOTH
 * properties and must not bleed between them: a seller quote about
 * onboarding belongs on seller.throttlein.com, not beside buyer
 * product listings on throttlein.com. Scoping also means the admin's
 * existing site switcher works with no extra plumbing — staff pick
 * "Seller" in the sidebar and see only seller testimonials.
 *
 * Public read: GET /api/testimonials?active=1&site=seller — active
 * entries for that site only, sorted ascending by `order`.
 */
const testimonialSchema = new mongoose.Schema(
  {
    // Which property this testimonial belongs to. Defaults to 'main' so
    // the field is safe to add to an existing collection.
    site: {
      type: String,
      enum: SITES,
      default: DEFAULT_SITE,
      required: true,
      index: true,
    },

    // ─── The card, as designed ────────────────────────────────────
    // Figma renders these three as: bold name, muted company beneath,
    // then the quote. Name is the only one the card can't do without.
    name: { type: String, required: true, trim: true, maxlength: 120 },

    // Business / shop name shown under the person's name. Optional —
    // an individual seller may not trade under a separate name, and the
    // card degrades cleanly to just the name.
    company: { type: String, default: '', trim: true, maxlength: 160 },

    // Circular avatar. Bare S3 key; `stripImageUrl` normalises whatever
    // the admin form posts back (it may round-trip a presigned URL).
    // Optional: the card falls back to the person's initials so a
    // missing photo never leaves a broken image icon.
    avatar: { type: String, default: '', set: stripImageUrl },

    // The feedback paragraph, as rich-text HTML from the admin's TipTap
    // editor — same storage contract as FaqSection.answer. Stored raw
    // and sanitised at render time by RichTextView (DOMPurify), which
    // is the established split: the DB keeps what was authored, the
    // renderer decides what is safe to show.
    quote: { type: String, default: '', trim: true },

    // Manual sort key, ascending. The carousel shows them in this order.
    order: { type: Number, default: 0 },

    // Hide without deleting. The public read filters on this when
    // ?active=1 is passed, which is how the storefront always calls it.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Ordering is the access pattern for both the public carousel and the
// admin list, and both are always scoped to one site.
testimonialSchema.index({ site: 1, order: 1, createdAt: 1 });

// Free the avatar from S3 when it's replaced or the row is deleted.
// `quote` is declared as HTML so inline images pasted into the editor
// are tracked too — the editor uploads them through the same pipeline.
const { attachImageCleanup } = require('../../utils/imageCleanup');
attachImageCleanup(testimonialSchema, [{ path: 'avatar' }, { path: 'quote', isHtml: true }]);

module.exports = mongoose.model('Testimonial', testimonialSchema);
