const mongoose = require('mongoose');

/**
 * SellerGuideSection — singleton holding the heading + subheading for
 * the "Seller Guide" section on /sell. The cards themselves live in
 * the separate `SellerGuide` model so admins can edit copy and cards
 * independently.
 *
 * The collection holds at most ONE document — mirrors HomeSeoBlock /
 * SellerCta. The controller lazily creates the doc on first read so
 * the admin form always loads with safe defaults.
 *
 *   GET  /api/seller-guide-section            — public (?active=1)
 *   PUT  /api/seller-guide-section            — admin upsert
 */
const sellerGuideSectionSchema = new mongoose.Schema(
  {
    heading: {
      type: String,
      default: "Your seller's playbook",
      trim: true,
      maxlength: 300,
    },
    subheading: { type: String, default: '', trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('SellerGuideSection', sellerGuideSectionSchema);
