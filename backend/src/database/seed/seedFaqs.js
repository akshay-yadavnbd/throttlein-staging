/**
 * Startup seed: ensure the FAQ collection has the 7 default sections +
 * 27 questions. Runs ONCE on first boot — if the FaqSection collection
 * already has any document, this is a no-op so we never overwrite
 * admin-edited content.
 *
 * Source: the original hardcoded SECTIONS list in
 * frontend/components/pages/FaqsPage.tsx (pre-CMS). After this seed
 * runs, admins manage all sections + Q&As from /admin → Pages → FAQs.
 *
 * Answers are stored as HTML paragraphs so they render through the
 * RichTextView component on the storefront. Plain-text answers are
 * wrapped in a single <p>.
 */
const FaqSection = require('../../modules/cms/faq-section.model');
const { logger } = require('../../utils/logger');

function p(text) {
  return `<p>${text.trim()}</p>`;
}

const SEED_SECTIONS = [
  {
    title: 'About ThrottleIn',
    order: 0,
    isActive: true,
    faqs: [
      {
        order: 0,
        question: 'What is ThrottleIn?',
        answer: p(
          `ThrottleIn is India's marketplace for motorcycle riders, offering a wide range of riding gear, helmets, bike accessories, luggage systems, lighting solutions, and performance parts from trusted brands.`,
        ),
      },
      {
        order: 1,
        question: 'Why should I shop on ThrottleIn?',
        answer: p(
          'You get one trusted place to find authentic gear from real Indian sellers, with bike-specific compatibility filters, verified seller storefronts, and an exchange-first returns policy — instead of bike gear buried inside a general marketplace.',
        ),
      },
      {
        order: 2,
        question: 'Does ThrottleIn manufacture or sell its own products?',
        answer: p(
          'No. ThrottleIn is an intermediary marketplace under the Information Technology Act, 2000. Products are sold by independent third-party sellers, and the contract of sale is directly between you and the relevant seller. We provide the platform that connects buyers and sellers and facilitates payments and logistics.',
        ),
      },
      {
        order: 3,
        question: 'Who can sell on ThrottleIn?',
        answer: p(
          'Brands, retailers, distributors, and online or Instagram-based sellers of genuine motorcycle gear. You need a valid GSTIN, a bank account for settlements, and to complete KYC (business + identity verification) to onboard.',
        ),
      },
    ],
  },
  {
    title: 'Marketplace & Trust',
    order: 1,
    isActive: true,
    faqs: [
      {
        order: 0,
        question: 'How do you ensure product authenticity?',
        answer: p(
          'Sellers are KYC-verified before going live, and our seller terms require that only authentic, genuine products be listed. Counterfeit, replica, or non-certified safety gear is prohibited. Safety items like helmets must meet applicable standards (such as BIS / ISI certification where required).',
        ),
      },
      {
        order: 1,
        question: 'Can I buy products from multiple brands in one place?',
        answer: p(
          'Yes. Throttlein hosts top brands like LS2, Studds, Steelbird, Vega, Axor, Royal Enfield-fit gear, and many more — all browsable and filterable by brand, category, and bike compatibility from one search.',
        ),
      },
      {
        order: 2,
        question: 'Do you support both riders and brands?',
        answer: p(
          'Yes. Riders get a focused marketplace with authentic gear and a unified checkout. Brands and shops get a verified seller storefront, bulk product upload, an order dashboard with real-time email alerts, and pan-India reach via our logistics partner.',
        ),
      },
      {
        order: 3,
        question: 'Can brands partner directly with ThrottleIn?',
        answer: p(
          'Yes. Brands can onboard as sellers with their own storefront, brand identity, and listings. There are currently no listing fees or marketplace commissions — for brand partnership inquiries, reach us at info@throttlein.com.',
        ),
      },
    ],
  },
  {
    title: 'Orders & Shipping',
    order: 2,
    isActive: true,
    faqs: [
      {
        order: 0,
        question: 'How can I track my order?',
        answer: p(
          'Once your order ships, a tracking link is sent to your email and is also available under My Account → Orders. The link updates as the parcel moves through our logistics partner (Shiprocket).',
        ),
      },
      {
        order: 1,
        question: 'How long does delivery take?',
        answer: p(
          'Sellers dispatch within their stated SLA (typically up to 10 days). Once dispatched, orders typically arrive within about 10 days depending on the delivery PIN code. Estimates are indicative, not guaranteed.',
        ),
      },
      {
        order: 2,
        question: 'Do you ship across India?',
        answer: p(
          'Yes — we deliver to every serviceable PIN code across India, subject to courier serviceability. International shipping is not currently offered.',
        ),
      },
      {
        order: 3,
        question: 'What happens if my order is delayed?',
        answer: p(
          'If a shipment is significantly delayed beyond the seller’s SLA, contact our support team at info@throttlein.com with your order number and we’ll work with the seller and courier to resolve it — or refund per our Returns & Cancellations Policy.',
        ),
      },
    ],
  },
  {
    title: 'Returns & Exchanges',
    order: 3,
    isActive: true,
    faqs: [
      {
        order: 0,
        question: 'How do I request a return?',
        answer: p(
          'Go to My Account → Orders, open the order, and choose Return / Replace with a reason. You have 5 days from delivery to raise a request. The seller (with Throttlein’s oversight) reviews and either schedules a pickup or shares return instructions.',
        ),
      },
      {
        order: 1,
        question: 'How long do refunds take?',
        answer: p(
          'Refunds are processed after the returned item is received and inspected, typically within 5–7 business days. Your bank may take additional time to reflect the credit. Refunds go to the original payment method (or to your bank/UPI for COD orders).',
        ),
      },
      {
        order: 2,
        question: 'Can I exchange a product for a different size?',
        answer: p(
          'Yes — Throttlein operates an exchange-first model. For size or fit issues, you can exchange for a different size where available; the buyer bears return shipping for change-of-mind exchanges.',
        ),
      },
      {
        order: 3,
        question: 'Which products are not eligible for return?',
        answer: p(
          'For safety and hygiene reasons, helmets and protective gear that have been used or whose seal/tag is removed are not returnable except for genuine defects. Custom-made items, items returned without tags / bills / invoices, and items damaged by the buyer after delivery are also not eligible.',
        ),
      },
    ],
  },
  {
    title: 'Seller Support',
    order: 4,
    isActive: true,
    faqs: [
      {
        order: 0,
        question: 'How do I become a seller on ThrottleIn?',
        answer: p(
          'Visit the Become a Seller page, register with your shop name, email, and phone, and complete KYC. Most sellers are approved and live within 24 hours. We can also set your account up for you, free — just reach out.',
        ),
      },
      {
        order: 1,
        question: 'How long does seller approval take?',
        answer: p(
          'Approvals typically complete within ~24 hours after you submit your business documents and GSTIN. There’s no extended vetting queue for most product categories.',
        ),
      },
      {
        order: 2,
        question: 'Is there a fee to list products?',
        answer: p(
          'No. Current early-seller terms are free registration, free listing, and zero marketplace commission. The only cost is the standard payment gateway charge (2.5% + GST), deducted at settlement.',
        ),
      },
      {
        order: 3,
        question: 'What documents are required for seller verification?',
        answer: p(
          'You’ll need a valid GSTIN, a bank account for settlements, and business + identity KYC documents. Full details are in the Seller Onboarding Handbook, accessible after account creation.',
        ),
      },
    ],
  },
  {
    title: 'Product Listings',
    order: 5,
    isActive: true,
    faqs: [
      {
        order: 0,
        question: 'What products can I sell on ThrottleIn?',
        answer: p(
          'Riding gear (helmets, jackets, gloves, boots, knee/back protectors), bike accessories (crash guards, lights, exhaust systems, tank/saddle bags, bike covers), and electronics + safety items (GPS, alarms, chargers). Anything a motorcycle rider wears, uses, or attaches to their bike.',
        ),
      },
      {
        order: 1,
        question: 'Can I upload products in bulk?',
        answer: p(
          'Yes. The seller dashboard supports bulk upload alongside individual listing creation. Bulk upload accepts a structured CSV — useful when migrating an existing catalogue.',
        ),
      },
      {
        order: 2,
        question: 'How many images can I add to a product?',
        answer: p(
          'You can add multiple high-quality images per product — we recommend at least 4–5 (front, back, side, in-use, and detail shots). Quality listings with more images consistently outperform single-image ones on the platform.',
        ),
      },
      {
        order: 3,
        question: 'What if my brand is not available in the list?',
        answer: p(
          'You can request a new brand from the seller dashboard. Brand requests are reviewed by Throttlein’s team and usually approved within a business day for legitimate motorcycle gear brands.',
        ),
      },
    ],
  },
  {
    title: 'Payments & Payouts',
    order: 6,
    isActive: true,
    faqs: [
      {
        order: 0,
        question: 'When do sellers receive payouts?',
        answer: p(
          'Settlements run on a T+7 day cycle and are paid out weekly to your registered bank account, after deduction of payment gateway charges, applicable TCS, and any returns or refunds.',
        ),
      },
      {
        order: 1,
        question: 'How can I update my bank details?',
        answer: p(
          'Go to your seller dashboard → Settings → Bank account. Changes are verified before the next settlement cycle, so update at least 2–3 days before your expected payout date.',
        ),
      },
      {
        order: 2,
        question: 'Are there any hidden charges?',
        answer: p(
          'No. The only deductions are the standard payment gateway charge (2.5% + GST per transaction) and 1% TCS under GST (collected by Throttlein as required under Section 52 of the CGST Act, 2017). There’s no platform fee, listing fee, or marketplace commission on top.',
        ),
      },
    ],
  },
];

async function seedFaqs() {
  const existing = await FaqSection.estimatedDocumentCount();
  if (existing > 0) {
    return; // already seeded — never clobber admin-edited content
  }
  await FaqSection.insertMany(SEED_SECTIONS);
  logger.info(
    `Seeded ${SEED_SECTIONS.length} FAQ sections with ${SEED_SECTIONS.reduce(
      (n, s) => n + s.faqs.length,
      0,
    )} questions.`,
  );
}

module.exports = seedFaqs;
module.exports.SEED_SECTIONS = SEED_SECTIONS;
