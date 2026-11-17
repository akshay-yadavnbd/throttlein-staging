/**
 * Startup seed: ensure system pages exist.
 *
 * The Pages CMS needs one canonical record per "logical" storefront
 * page so the admin can manage that page's content + SEO regardless of
 * whether the page itself is data-driven (Home, Brands index) or static
 * prose (legal/policy + seller docs).
 *
 * The prose pages below are seeded as `type: 'prose'` with a Markdown
 * `body`. After the first boot they appear under Admin → Pages →
 * Static pages and are fully editable from the admin panel (Markdown
 * editor + live Preview). They render on the storefront at the clean
 * root URL `/<slug>` and are picked up automatically by sitemap.xml.
 *
 * Two groups:
 *   Buyer / legal  — privacy-policy, terms-and-conditions,
 *                    return-and-refund-policy, shipping-policy,
 *                    cancellation-policy
 *   Seller         — seller-terms, seller-faq, pricing-and-fees,
 *                    seller-onboarding-guide
 *
 * Operating entity, contact, and current commercial terms are baked in
 * (Noseberry Private Limited; GSTIN 09AAGCN8874N1ZG; gateway 2.5% + GST;
 * settlement T+7, weekly; TCS 1%; 5-day returns; exchange-first). Have
 * everything reviewed by a legal professional / CA before relying on it.
 *
 * Idempotent — looks up by slug, skips if already present. To push fresh
 * template copy onto existing rows, use the SYSTEM_PAGES export with an
 * upsert script (see scripts), or delete the page in admin and reboot.
 */
const Page = require('../../modules/cms/page.model');
const { DEFAULT_SITE } = require('../../config/sites');
const { logger } = require('../../utils/logger');

const {
  PRIVACY_POLICY,
  TERMS_OF_USE,
  RETURN_REFUND_POLICY,
  SHIPPING_POLICY,
  CANCELLATION_POLICY,
} = require('./pages-content/buyer-policies');

const { SELLER_TERMS, SELLER_FAQ, PRICING_AND_FEES, SELLER_ONBOARDING } = require('./pages-content/seller-documents');

/** @type {Array<{ slug: string, type: 'home' | 'prose' | 'dynamic' | 'static-meta', site?: string, [field: string]: any }>} */
const SYSTEM_PAGES = [
  {
    slug: 'home',
    title: 'Home page',
    type: 'home',
    body: '',
    seoTitle: '',
    seoDescription: '',
    ogImage: '',
    isPublished: true,
    order: 0,
  },
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    type: 'prose',
    body: PRIVACY_POLICY,
    seoTitle: 'Privacy Policy · THROTTLEIN',
    seoDescription:
      "How THROTTLEIN (Noseberry Private Limited) collects, uses, shares, and protects buyer and seller data, aligned with India's DPDP Act.",
    isPublished: true,
    order: 1,
  },
  {
    slug: 'terms-and-conditions',
    title: 'Terms of Use',
    type: 'prose',
    body: TERMS_OF_USE,
    seoTitle: 'Terms of Use · THROTTLEIN',
    seoDescription:
      'The buyer terms for using the THROTTLEIN marketplace for motorcycle helmets, gear, parts, and accessories.',
    isPublished: true,
    order: 2,
  },
  {
    slug: 'return-and-refund-policy',
    title: 'Returns, Refunds & Cancellations Policy',
    type: 'prose',
    body: RETURN_REFUND_POLICY,
    seoTitle: 'Returns, Refunds & Cancellations · THROTTLEIN',
    seoDescription:
      "THROTTLEIN's exchange-first returns policy — eligibility, who pays return shipping, refunds, cancellations, and dispute handling.",
    isPublished: true,
    order: 3,
  },
  {
    slug: 'shipping-policy',
    title: 'Shipping & Fulfillment Policy',
    type: 'prose',
    body: SHIPPING_POLICY,
    seoTitle: 'Shipping & Fulfillment Policy · THROTTLEIN',
    seoDescription:
      'Seller-fulfilled shipping via Shiprocket — coverage, timelines, who pays, COD, transit liability, and RTO on THROTTLEIN.',
    isPublished: true,
    order: 4,
  },
  {
    slug: 'cancellation-policy',
    title: 'Cancellation Policy',
    type: 'prose',
    body: CANCELLATION_POLICY,
    seoTitle: 'Cancellation Policy · THROTTLEIN',
    seoDescription: 'When and how to cancel a THROTTLEIN order, seller-side cancellations, and refund handling.',
    isPublished: true,
    order: 5,
  },
  {
    slug: 'seller-terms',
    site: 'seller',
    title: 'Seller Terms & Conditions',
    type: 'prose',
    body: SELLER_TERMS,
    seoTitle: 'Seller Terms & Conditions · THROTTLEIN',
    seoDescription:
      'The seller agreement for THROTTLEIN — fees, gateway charges, settlements, authenticity, obligations, and liability.',
    isPublished: true,
    order: 6,
  },
  {
    slug: 'seller-faq',
    site: 'seller',
    title: 'Seller FAQ',
    type: 'prose',
    body: SELLER_FAQ,
    seoTitle: 'Seller FAQ · THROTTLEIN',
    seoDescription:
      'Plain-language answers for selling on THROTTLEIN — signup, documents, costs, listings, shipping, settlements, and returns.',
    isPublished: true,
    order: 7,
  },
  {
    slug: 'pricing-and-fees',
    site: 'seller',
    title: 'Pricing & Fees Schedule',
    type: 'prose',
    body: PRICING_AND_FEES,
    seoTitle: 'Seller Pricing & Fees · THROTTLEIN',
    seoDescription:
      'What it costs to sell on THROTTLEIN — free registration/listing/commission (current terms), 2.5%+GST gateway, 1% TCS, T+7 weekly settlements.',
    isPublished: true,
    order: 8,
  },
  {
    slug: 'seller-onboarding-guide',
    site: 'seller',
    title: 'Seller Onboarding Handbook',
    type: 'prose',
    body: SELLER_ONBOARDING,
    seoTitle: 'Seller Onboarding Handbook · THROTTLEIN',
    seoDescription:
      'Step-by-step guide to start selling on THROTTLEIN — from signup and KYC to listing, shipping, going live, and getting paid.',
    isPublished: true,
    order: 9,
  },
];

async function seedPages() {
  for (const def of SYSTEM_PAGES) {
    // Each entry declares which property it belongs to. The four seller
    // documents (Seller Terms, Seller FAQ, Pricing & Fees, Onboarding
    // Handbook) carry `site: 'seller'` — they're linked from the seller
    // header and footer and render on seller.throttlein.com. Everything
    // else (home, privacy, buyer terms, returns, shipping,
    // cancellation) defaults to the main site.
    //
    // The lookup is scoped to the same site as the create. Without that,
    // a page on one property sharing a slug would make this conclude the
    // system page already exists and skip it forever — silently, showing
    // up only as a missing legal page on the live site.
    const site = def.site || DEFAULT_SITE;
    const existing = await Page.findOne({ site, slug: def.slug });
    if (existing) continue;
    await Page.create({ ...def, site });
    logger.info(`Seeded system page: ${def.slug} (${site})`);
  }
}

module.exports = seedPages;
module.exports.SYSTEM_PAGES = SYSTEM_PAGES;
