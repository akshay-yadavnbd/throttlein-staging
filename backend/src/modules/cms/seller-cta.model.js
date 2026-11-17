const mongoose = require('mongoose');
const stripImageUrl = require('../../utils/stripImageUrl');

/**
 * SellerCta — the "Take your offline business online" callout block
 * that lives near the foot of the homepage.
 *
 * Modelled as a SINGLETON. The controller exposes only a "current"
 * GET + a single PUT (upsert). Having a one-row collection rather
 * than a key-value store keeps the admin form purpose-built and the
 * schema validation strict.
 *
 * `bgImage` and `portraitImage` are S3 keys produced by the shared
 * upload middleware (or fall through to default static assets when
 * empty — the storefront falls back to /images/figma/seller-bg.webp
 * and /images/figma/seller-portrait.webp so the page never goes blank
 * before an admin has filled the record in).
 */
const sellerCtaSchema = new mongoose.Schema(
  {
    // Background photo behind the L→R black gradient overlay.
    bgImage: { type: String, default: '', set: stripImageUrl },
    // Portrait photo on the right side of the block.
    portraitImage: { type: String, default: '', set: stripImageUrl },

    // Copy — kept short; the admin form caps lengths to match the
    // homepage layout (long subtext wraps awkwardly past two lines).
    heading: { type: String, default: 'Take your offline business online', trim: true, maxlength: 120 },
    subtext: {
      type: String,
      default: 'Onboard in 48 hours. Reach 2M+ riders. Zero setup fees.',
      trim: true,
      maxlength: 280,
    },

    // CTA button. `ctaHref` defaults to /sell (the seller onboarding
    // landing page) — admins typically only override this if they
    // want to A/B test a different funnel.
    ctaLabel: { type: String, default: 'Become a Seller', trim: true, maxlength: 60 },
    ctaHref: { type: String, default: '/seller', trim: true, maxlength: 200 },

    // Toggle to hide the whole section without losing the content.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Auto-cleanup S3 objects when image fields are replaced or the doc
// is deleted. See utils/imageCleanup.js for the diff-and-delete logic.
const { attachImageCleanup } = require('../../utils/imageCleanup');
attachImageCleanup(sellerCtaSchema, [{ path: 'bgImage' }, { path: 'portraitImage' }]);

module.exports = mongoose.model('SellerCta', sellerCtaSchema);
