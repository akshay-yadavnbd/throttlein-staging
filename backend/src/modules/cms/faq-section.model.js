/**
 * FaqSection — one section on the /faqs page (e.g. "About ThrottleIn",
 * "Orders & Shipping"). Each section owns an embedded array of Q&A
 * items, kept inline so the admin UI can edit a section and all its
 * questions in one form / one save.
 *
 * Why embedded instead of a separate Faq collection?
 *   - Sections and questions are always loaded together (the public
 *     page renders every section + every question).
 *   - The admin UI groups by section, so editing one section never
 *     touches another section's questions.
 *   - Mongo doc-size limits aren't a concern; a section has 4-6 Qs
 *     at most, each a few hundred bytes.
 *
 * Order is a manual integer (lower = earlier). Both at section level
 * and at question level. Mongoose sorts ascending in the controller's
 * public list query.
 */
const mongoose = require('mongoose');

const faqItemSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    // Answer is rich-text HTML produced by the admin's TipTap editor —
    // sanitised on the client side and stored as-is.
    answer: { type: String, required: true },
    order: { type: Number, default: 0 },
  },
  { _id: true, timestamps: false },
);

const { SITES, DEFAULT_SITE } = require('../../config/sites');

const faqSectionSchema = new mongoose.Schema(
  {
    /**
     * Which property this section belongs to — 'main' renders on
     * throttlein.com/faqs, 'seller' on the seller landing page's FAQ
     * block. Defaults to 'main' so every pre-multi-site row keeps its
     * behaviour without a migration.
     */
    site: {
      type: String,
      enum: SITES,
      default: DEFAULT_SITE,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    faqs: { type: [faqItemSchema], default: [] },
  },
  { timestamps: true },
);

module.exports = mongoose.model('FaqSection', faqSectionSchema);
