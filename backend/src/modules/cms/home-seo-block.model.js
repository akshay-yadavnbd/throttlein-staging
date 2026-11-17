const mongoose = require('mongoose');

/**
 * HomeSeoBlock — the "Explore more" chip cloud + the SEO prose block
 * at the foot of the homepage, modelled as a SINGLETON.
 *
 * The page now renders TWO separate link clouds and each has its own
 * admin-editable list:
 *   - `links`        → the TOP "Explore more" cloud (above the prose)
 *   - `bottomLinks`  → the cloud BELOW the SEO prose
 *
 * Both default to empty; the storefront skips an empty list and the
 * admin manages them as two separate repeaters inside the same page.
 *
 * `body` is rich-text HTML produced by the admin TipTap editor; the
 * storefront renders it via dangerouslySetInnerHTML inside a prose
 * wrapper that mirrors how FAQ answers are rendered.
 */
const linkSubdoc = new mongoose.Schema(
  {
    label: { type: String, trim: true, default: '' },
    href: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const homeSeoBlockSchema = new mongoose.Schema(
  {
    heading: { type: String, default: '', trim: true, maxlength: 300 },
    // Rich-text HTML from TipTap. Kept unbounded — TipTap output for a
    // few short paragraphs is well under any sane limit.
    body: { type: String, default: '' },
    // Top chip cloud ("Explore more" heading above the SEO prose).
    links: { type: [linkSubdoc], default: [] },
    // Bottom chip cloud rendered immediately below the SEO prose.
    // Kept separate so the admin can curate different copy / URLs
    // for "related reads" without duplicating the top list.
    bottomLinks: { type: [linkSubdoc], default: [] },
    // Toggle to hide both link blocks AND the prose without losing the
    // copy. When false, storefront returns null and renders nothing.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('HomeSeoBlock', homeSeoBlockSchema);
