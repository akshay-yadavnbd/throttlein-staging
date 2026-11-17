/**
 * One-shot: seed the seller landing page's FAQ block into the CMS.
 *
 * Copies the four Q&As that were hardcoded in
 * frontend/components/pages/SellPage.tsx into a single
 * FaqSection{site:'seller'}, so the section becomes admin-managed
 * (Pages → Seller home tab). Idempotent: refuses to run if ANY seller
 * section already exists, so re-running can't duplicate content.
 *
 * Run: node scripts/seedSellerFaqs.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const FaqSection = require('../src/modules/cms/faq-section.model');

const FAQS = [
  {
    question: 'What services does Throttlein offer for bike part sales?',
    answer:
      'Throttlein is a curated multi-seller marketplace for motorcycle accessories - helmets, jackets, boots, lights, exhausts, luggage, electronics and more. As a seller you get your own storefront, listings dashboard, integrated checkout, automated courier label printing and a customer-support workflow built in.',
  },
  {
    question: 'What can I sell on THROTTLEIN?',
    answer:
      'Any genuine motorcycle accessory you have rights to sell: gear (helmets, jackets, gloves, boots, pants), luggage, lighting, electronics, exhausts, performance parts, safety/protection, and bike-specific OEM/aftermarket parts. Counterfeits and unsafe gear are not allowed.',
  },
  {
    question: 'Is there a setup fee or monthly subscription?',
    answer:
      'No setup fee, no monthly subscription. We earn a small commission only when you make a sale, so we only grow when you do.',
  },
  {
    question: 'How long does approval take?',
    answer:
      'Most sellers are approved within 24 hours of submitting their KYC. You can start listing immediately; orders begin flowing once your KYC is verified and your first product is live.',
  },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const existing = await FaqSection.countDocuments({ site: 'seller' });
  if (existing > 0) {
    console.log(`Skipped: ${existing} seller FAQ section(s) already exist.`);
  } else {
    const doc = await FaqSection.create({
      site: 'seller',
      title: 'Have any questions?',
      order: 1,
      isActive: true,
      faqs: FAQS.map((f, i) => ({ ...f, order: i })),
    });
    console.log('Created seller FAQ section', String(doc._id), 'with', doc.faqs.length, 'questions.');
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
