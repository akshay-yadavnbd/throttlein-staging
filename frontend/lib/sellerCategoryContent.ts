/**
 * SHARED content for the seller-category template ("Sell Helmets Online").
 *
 * Every one of these pages carries the same benefit cards, "why sell" cards,
 * onboarding steps, video, tips and closing CTA — only the nouns change. So
 * they live here once instead of being copied into every Page record, which
 * means a wording fix is one edit rather than one per category.
 *
 * Copy is VERBATIM from Figma node 4583:10494, with these deliberate fixes,
 * all of which are design typos rather than decisions:
 *
 *   - `Add Your  Products` had a double space → single.
 *   - `Seller Success Stories ` and `Who Can Sell Helmets on ThrottleIn? `
 *     had trailing spaces → trimmed.
 *   - Step 06 body had no terminal full stop → added.
 *   - Body-copy colour alternated between #424242 and #6b6b6b across cards
 *     with no visual intent → normalised to #424242 (--content/secondary).
 *   - Two limes exist in the design, #d3ff33 (CTA token) and #d4fa00 (FAQ
 *     chip) → using the token, #D3FF33, which the rest of the site uses.
 *
 * ── THE {category} TOKEN ─────────────────────────────────────────────
 * Headings that name the product ("Why Sell Motorcycle Helmets on
 * ThrottleIn?") use `{category}` / `{categoryShort}`, filled from the page's
 * own `sellerCategory.nounPlural` / `noun`. That is what lets these strings
 * stay shared without reading as generic filler.
 */

export type IconCard = { icon: string; title: string; body: string };
export type Step = {
  n: string;
  title: string;
  body: string;
  image?: string;
  /* NOTE: how the illustration is sized and positioned is NOT declared
   * here. Each of the seven cards has its own measured geometry in
   * `STEP_MEDIA` in components/pages/SellerCategoryPage.tsx, keyed by `n`.
   * A `fit: 'bleed' | 'center'` field used to live here, but it only ever
   * captured two of the design's treatments and duplicated a decision the
   * component had to make anyway. */
};
export type TipCard = { title: string; body: string };

/** Replace {category} / {categoryShort} in a shared string. */
export function fillCategory(
  text: string,
  nounPlural: string,
  noun: string,
): string {
  return String(text || '')
    .replace(/\{categoryShort\}/g, noun || nounPlural || 'products')
    .replace(/\{category\}/g, nounPlural || noun || 'products');
}

/* ── S3: "Everything You Need to Start Selling Online" — 5 cards ── */
export const BENEFITS_HEADING = 'Everything You Need to Start Selling Online';
export const BENEFITS: IconCard[] = [
  {
    icon: '/images/sell-online/icon-coin-rupee.svg',
    title: '₹0 Setup Fee',
    body: 'Create your ThrottleIn seller account without paying an initial account setup fee.',
  },
  {
    icon: '/images/sell-online/icon-cash-banknote-off.svg',
    title: '0% Commission',
    body: 'New sellers can start selling with zero commission, subject to current seller terms.',
  },
  {
    icon: '/images/sell-online/icon-checklist.svg',
    title: '24–48 Hour Verification',
    body: 'Submit the required business information and get your seller application reviewed within the standard approval period.',
  },
  {
    icon: '/images/sell-online/icon-building-store.svg',
    title: 'Rider-Focused Marketplace',
    body: 'Present your products to customers specifically interested in motorcycles, riding gear and bike accessories.',
  },
  {
    icon: '/images/sell-online/icon-headset.svg',
    title: 'Dedicated Seller Support',
    body: 'Get assistance with registration, product listings, orders, fulfilment and seller-account queries.',
  },
];

/* ── S5: "Why Sell {category} on ThrottleIn?" — 6 cards ── */
export const WHY_HEADING = 'Why Sell {category} on ThrottleIn?';
export const WHY_INTRO =
  'Selling {category} online through a motorcycle-focused marketplace can help you improve product visibility, reach more riders and grow your business outside your local market.';
export const WHY_CARDS: IconCard[] = [
  {
    icon: '/images/seller-category/icon-motorbike.svg',
    title: 'Reach Motorcycle Riders',
    body: 'Show your {category} collection to customers actively searching for motorcycle safety gear and riding equipment.',
  },
  {
    icon: '/images/seller-category/icon-arrows-maximize.svg',
    title: 'Expand Beyond Your Local Store',
    body: 'Sell your products to eligible customers outside your city without opening additional physical outlets.',
  },
  {
    icon: '/images/seller-category/icon-list-check.svg',
    title: 'Showcase Your Complete Collection',
    body: 'List multiple brands, models, sizes, colours and variants in one online catalogue.',
  },
  {
    icon: '/images/seller-category/icon-browser.svg',
    title: 'Manage Everything Online',
    body: 'Manage products, inventory, prices, orders and seller information through your ThrottleIn seller dashboard.',
  },
  {
    icon: '/images/seller-category/icon-user-dollar.svg',
    title: 'Build Your Seller Identity',
    body: 'Create a professional seller presence and help riders discover more products available from your business.',
  },
  {
    icon: '/images/seller-category/icon-trending-up.svg',
    title: 'Grow with a Relevant Marketplace',
    body: 'Sell in a marketplace built around motorcycle helmets, riding gear, touring accessories and bike products.',
  },
];

/* ── S10a: "How to Register and Sell {category} Online" — 7 steps ── */
export const STEPS_HEADING = 'How to Register and Sell {category} Online';
export const STEPS_INTRO =
  'You can begin your online selling journey by completing the following steps.';
export const STEPS: Step[] = [
  {
    n: '01',
    title: 'Create Your Seller Account',
    body: 'Register using your active mobile number and business email address. Add your name and basic business information to begin onboarding.',
    image: '/images/seller-category/step-01.webp',
  },
  {
    n: '02',
    title: 'Complete Your Business Details',
    body: 'Provide PAN, GSTIN, pickup address, bank account, and business info. Additional documents may be needed based on your business type or brands.',
    image: '/images/seller-category/step-02.webp',
  },
  {
    n: '03',
    title: 'Submit Your Seller Application',
    body: 'Check the information you have entered and submit your seller profile for review.',
    // Composed render of the illustration CONTAINER (Submit button + cursor),
    // exported at 3× so it stays sharp on HiDPI screens. The per-layer export
    // was the bare cursor, which object-cover blew up into a black triangle.
    image: '/images/seller-category/step-03-submit-hi.webp',
  },
  {
    n: '04',
    title: 'Add Your Products',
    body: 'Once your account is approved, add your catalogue with accurate product titles, photographs, descriptions and specifications.',
    image: '/images/seller-category/step-04.webp',
  },
  {
    n: '05',
    title: 'Start Receiving Orders',
    body: 'After your listings are published, customers can discover your products and place orders through ThrottleIn.',
    image: '/images/seller-category/step-05.webp',
  },
  {
    n: '06',
    title: 'Pack and Dispatch',
    body: 'Confirm the ordered products model, size and colour. Pack the product securely and follow the available shipping instructions.',
    image: '/images/seller-category/step-06.webp',
  },
  {
    n: '07',
    title: 'Receive Your Payment',
    body: 'Payments for completed orders are processed according to the applicable ThrottleIn seller-payment cycle and terms.',
    // Composed render of the wallet illustration at 3×. The earlier export was
    // a raster of the whole card, so it repeated this card's own text inside it.
    image: '/images/seller-category/step-07-wallet-hi.webp',
  },
];

/* ── S10b: onboarding video ── */
export const VIDEO = {
  heading: 'Watch seller onboarding guide',
  title: 'Learn how to become a ThrottleIn Seller | Seller Hub',
  subtitle: 'Official step-by-step onboarding walkthrough',
  thumbnail: '/images/seller-category/video-thumb.webp',
  /** Blank until a real video exists — the player renders as a static
   *  thumbnail rather than linking somewhere wrong. */
  youtubeUrl: '',
};

/* ── S11: "Tips to Increase Your {categoryShort} Sales Online" — 8 cards ── */
export const TIPS_HEADING = 'Tips to Increase Your {categoryShort} Sales Online';
export const TIPS: TipCard[] = [
  {
    title: 'Provide a Detailed Size Guide',
    body: 'Explain how customers should measure and choose the appropriate size.',
  },
  {
    title: 'Show Every Colour and Graphic',
    body: 'Upload accurate images for every product variant instead of using one image for several different designs.',
  },
  {
    title: 'Mention the Intended Riding Use',
    body: 'Tell customers whether the product is suitable for commuting, touring, adventure riding or off-road riding.',
  },
  {
    title: 'Display Certification Information',
    body: 'Clearly mention the applicable product-certification details and show genuine product labels in your images.',
  },
  {
    title: 'Keep Popular Sizes Available',
    body: 'Monitor your inventory and maintain sufficient stock for frequently purchased sizes.',
  },
  {
    title: 'Use Accurate Product Information',
    body: 'Avoid exaggerated claims or specifications that are not supported by the manufacturer.',
  },
  {
    title: 'Pack Products Securely',
    body: 'Protect the product, its accessories and original packaging during shipping.',
  },
  {
    title: 'Process Orders Promptly',
    body: 'Review new orders regularly and prepare eligible products for dispatch without unnecessary delays.',
  },
];

/* ── S12: closing CTA band ── */
export const CLOSING = {
  heading: 'Start Selling {categoryShort} Online Today',
  body: 'Take your motorcycle business online and make your products discoverable to riders beyond your local store. Register on ThrottleIn, create your catalogue and manage your online selling activities from one seller dashboard.',
  primary: 'Register as a Seller',
  secondary: 'Seller Login',
  background: '/images/seller-category/cta-bg.webp',
};

/* ── Section headings that name the category ── */
export const TYPES_HEADING = 'Types of {category} to sell on Throttlein';
export const BRANDS_HEADING = 'Top {categoryShort} brands sold on Throttlein';
export const ELIGIBILITY_HEADING = 'Who Can Sell {categoryShort} on ThrottleIn?';
export const TESTIMONIALS_HEADING = 'Seller Success Stories';
export const FAQ_HEADING = 'Have any questions?';
