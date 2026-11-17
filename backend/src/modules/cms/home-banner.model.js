const mongoose = require('mongoose');
const stripImageUrl = require('../../utils/stripImageUrl');

/**
 * HomeBanner — slides that appear in the homepage hero swiper.
 *
 * Two flavours supported in one record:
 *
 *   1. "Image-only" banner — admin uploads a background image with all
 *      copy / badges baked in. Only `image` + (optionally) `imageMobile`
 *      are set. This is the legacy shape — any banner created before
 *      the rich overlay fields landed reads as this.
 *
 *   2. "Rich" banner — admin uploads a clean background image and the
 *      storefront overlays a title / description / brand-logo pills /
 *      CTA button on top. Switch to this shape by filling in `title`
 *      and any of the optional rich fields below.
 *
 * The frontend HeroBanner picks the render mode per-slide: if the
 * record has a `title`, it renders the overlay; otherwise it just
 * shows the bare image. So new fields are 100% additive — existing
 * banners keep working.
 *
 * The customer-facing storefront fetches active banners via
 * GET /api/home-banners?active=1 and renders them in order. Admins
 * manage the list from the /pages/home → Hero banners accordion.
 */
const homeBannerSchema = new mongoose.Schema(
  {
    // Background image — required. Resolved via /home-banners/upload.
    image: { type: String, required: true, set: stripImageUrl },
    // Mobile background image — optional. When present, the storefront
    // serves this to viewports <768px instead of cropping the desktop.
    imageMobile: { type: String, default: '', set: stripImageUrl },

    // ─── Rich overlay (optional) ───────────────────────────────────
    // Big H2 over the image. Filling this in switches the banner to
    // "rich" render mode on the storefront.
    title: { type: String, default: '', trim: true, maxlength: 200 },
    // One-paragraph description shown below the title.
    description: { type: String, default: '', trim: true, maxlength: 500 },
    // Brand-logo pills shown between the title and description. Each
    // entry is an S3 key for a logo asset; the storefront renders them
    // as small white capsule chips. Up to ~5 fits comfortably.
    brandLogos: { type: [String], default: [], set: (v) => (v || []).map(stripImageUrl) },
    // CTA button copy.
    ctaLabel: { type: String, default: '', trim: true, maxlength: 60 },
    // CTA button link. Falls back to `href` (the top-level banner click
    // target) when blank.
    ctaHref: { type: String, default: '', trim: true, maxlength: 200 },
    // Visual theme of the CTA button. `dark` = black bg + white text
    // (best on light backgrounds); `light` = white bg + black text
    // (best on dark backgrounds). The default `dark` matches the most
    // common case where the BG is photographic / dark.
    ctaTheme: { type: String, enum: ['dark', 'light'], default: 'dark' },

    // ─── Existing shared fields ────────────────────────────────────
    // Accessible alt text — required for screen readers + image fallback.
    alt: { type: String, default: '' },
    // Click-through link for the WHOLE banner. Empty string means the
    // banner is non-clickable. (Distinct from `ctaHref` which is for
    // the explicit button.)
    href: { type: String, default: '' },
    // Manual sort key. Lower values appear first in the swiper.
    order: { type: Number, default: 0 },
    // Toggle in the admin to hide a banner without deleting it.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Auto-cleanup S3 objects when image fields are replaced or the doc
// is deleted. See utils/imageCleanup.js for the diff-and-delete logic.
const { attachImageCleanup } = require('../../utils/imageCleanup');
attachImageCleanup(homeBannerSchema, [{ path: 'image' }, { path: 'imageMobile' }, { path: 'brandLogos' }]);

module.exports = mongoose.model('HomeBanner', homeBannerSchema);
