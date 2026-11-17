const mongoose = require('mongoose');
const stripImageUrl = require('../../utils/stripImageUrl');

/**
 * SellerGuide -- admin-managed knowledge cards rendered AFTER the
 * "Ready to open your shop?" hero on the /sell landing page.
 *
 * The storefront fetches active cards via
 *   GET /api/seller-guides?active=1
 * and renders them as a responsive grid (4 / 2 / 1 cols). Each card
 * navigates to /sell/guide/<slug> where the full rich-text body is
 * shown. Admins manage the list from /pages/sell in the admin panel.
 *
 * Pairs with SellerGuideSection (singleton) which stores the section
 * heading + optional sub-heading. Kept in a separate model so the
 * heading can be edited independently of the cards.
 */
const sellerGuideSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    // URL-safe slug, lowercase, unique. Used in /sell/guide/<slug>.
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    // Short blurb shown on the card. line-clamped to 2-3 lines.
    shortDescription: { type: String, default: '', trim: true, maxlength: 500 },
    // Rich-text HTML body shown on the detail page. Unbounded --
    // matches HomeSeoBlock.body.
    content: { type: String, default: '' },
    // Card thumbnail / detail hero image. S3 key -- resolved via the
    // presign middleware before it reaches the client.
    image: { type: String, default: '', set: stripImageUrl },
    // Manual sort key -- lower values appear first.
    order: { type: Number, default: 0 },
    // Toggle to hide a card from the storefront without deleting.
    isActive: { type: Boolean, default: true },

    // Optional publish timestamp shown on the detail page below the
    // title (mirrors BlogPost.publishedAt). When unset, the storefront
    // falls back to `createdAt`. Stored as Date so the storefront can
    // localize / format with toLocaleDateString.
    publishedAt: { type: Date, default: null },

    // SEO overrides. All optional. When blank, the storefront derives
    // sensible defaults from title / shortDescription / image. Mirrors
    // the BlogPost.{metaTitle, metaDescription, ogImage} convention so
    // the meta builder code can stay symmetric.
    metaTitle: { type: String, default: '' },
    metaDescription: { type: String, default: '' },
    ogImage: { type: String, default: '', set: stripImageUrl },
  },
  { timestamps: true },
);

// Auto-cleanup S3 objects when the image field is replaced or the
// doc is deleted. See utils/imageCleanup.js.
const { attachImageCleanup } = require('../../utils/imageCleanup');
attachImageCleanup(sellerGuideSchema, [
  { path: 'image' },
  // OG image override -- separate slot from the hero/card image so
  // admins can ship a 1200x630 social preview without re-cropping
  // the hero. Cleanup keeps S3 tidy when it's replaced or removed.
  { path: 'ogImage' },
  // The rich-text body can embed inline <img> tags pasted from the
  // media picker -- clean those up too so deleting a guide doesn't
  // leak its embedded screenshots.
  { path: 'content', isHtml: true },
]);

module.exports = mongoose.model('SellerGuide', sellerGuideSchema);
