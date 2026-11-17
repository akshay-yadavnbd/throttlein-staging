const mongoose = require('mongoose');
const stripImageUrl = require('../../utils/stripImageUrl');

/**
 * PromoBlock — admin-managed promo cards rendered on the homepage,
 * just under the "Best selling this month" carousel.
 *
 * Replaces what used to be three hardcoded constants (PROMO_LEFT,
 * PROMO_RIGHT, PROMO_BOTTOM) in frontend/components/pages/HomePage.tsx.
 * Admins now manage the lineup (add / reorder / edit / disable) from
 * /pages → Promo Blocks.
 *
 * Two layout variants are supported:
 *   - 'image-grid'    — 4 small square images + chip cloud + text CTA.
 *                       Renders in the wider left column of the homepage
 *                       grid (2fr_1fr split).
 *   - 'single-image'  — 1 large image + chip cloud + arrow-button CTA.
 *                       Renders in the narrower right column.
 *
 * The storefront pairs blocks up by variant: image-grid blocks stack
 * down the left column, single-image blocks stack down the right column.
 * If only one variant exists, it renders full-width.
 *
 * Public read (GET /api/promo-blocks?active=1) returns active blocks
 * sorted ascending by `order`. Admins use the /admin sub-routes for
 * full CRUD, gated by the 'pages' permission so any staff member with
 * Pages access can manage them.
 */
const chipSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 60 },
    href: { type: String, required: true, trim: true, maxlength: 300 },
  },
  { _id: true, timestamps: false },
);

const promoBlockSchema = new mongoose.Schema(
  {
    // Card heading shown to customers. Required; the storefront falls
    // back to nothing if blank, which would look broken — hence the
    // required + trim constraints.
    title: { type: String, required: true, trim: true, maxlength: 200 },
    // Layout variant. See file header for the visual contract.
    variant: {
      type: String,
      enum: ['image-grid', 'single-image'],
      default: 'image-grid',
    },
    // Chip cloud — short link list under the title. Capped at ~6 visually
    // so we don't enforce that here; the admin UI hints the limit.
    chips: { type: [chipSchema], default: [] },
    // CTA button / link label. Defaults to "Explore Products" so a freshly
    // created block has a sensible visible label even if the admin
    // forgets to set one.
    ctaLabel: { type: String, default: 'Explore Products', trim: true, maxlength: 60 },
    // Where the CTA points. Required — without a target the CTA is a
    // dead link.
    ctaHref: { type: String, required: true, trim: true, maxlength: 200 },
    // Image references — stored as bare S3 keys (the `stripImageUrl`
    // setter normalises whatever the form posts back). image-grid
    // variants use the first 4 keys; single-image variants use the first.
    images: {
      type: [{ type: String, set: stripImageUrl }],
      default: [],
    },
    // Manual sort key. Lower values appear first. The storefront sorts
    // ascending in the controller's public list query.
    order: { type: Number, default: 0 },
    // Toggle in the admin to hide a block without deleting it. The
    // storefront filters on this when ?active=1 is passed.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Auto-cleanup S3 objects when an image is replaced or the doc is
// deleted. images is an array path; the helper diffs old/new on save.
const { attachImageCleanup } = require('../../utils/imageCleanup');
attachImageCleanup(promoBlockSchema, [{ path: 'images', isArray: true }]);

module.exports = mongoose.model('PromoBlock', promoBlockSchema);
