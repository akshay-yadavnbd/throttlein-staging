/**
 * Content for the seller property's "Sell Online" page
 * (seller.throttlein.com/sell-online) — Figma node 4624:1306.
 *
 * The copy lives here rather than inline in the component because the
 * page is 17,000px of largely repetitive structure: 12 guide sections,
 * ~125 checklist items, a 9-row responsibilities table and two numbered
 * step journeys. Separating data from layout keeps the component
 * readable and makes the eventual move into the CMS a data migration
 * rather than a rewrite.
 *
 * ── Copy fidelity ────────────────────────────────────────────────────
 * Text is verbatim from the design, with these deliberate exceptions,
 * all of which are design bugs rather than decisions:
 *
 *   - "Cancelled cheque or bank-verification document, where requeste"
 *     was truncated mid-word in Figma → "requested".
 *   - "Inspect the item and ensure it is genuine, unused, undamaged and
 *     complete" had no full stop → added.
 *   - "Raju Lunawath," had a trailing comma in the name field → removed.
 *   - "ThrottleIn" / "Throttle In" (two spellings in the design) →
 *     "Throttlein", matching the rest of the site.
 *
 * FAQ answers 2–4 were lorem placeholders in the design; they've been
 * written from this page's own content (fees, categories, approval
 * time). Flagged so a content owner can replace them.
 */

/* ────────────────────────────────────────────────────────────────────
 * Hero
 * ──────────────────────────────────────────────────────────────── */

export const HERO = {
  heading: 'Sell Motorcycle Gear Online with Throttlein',
  subheading: 'Take your motorcycle business beyond your physical store.',
  body:
    'Create your Throttlein seller account, list your products and connect with riders looking for helmets, riding gear, bike accessories, touring equipment and performance products across India.',
  proofPoints: ['Start with no setup fee', 'No monthly subscription'],
  image: {
    src: '/images/sell-online/hero.webp',
    // Figma renders this at 608×431 — a 1.411:1 crop of the 1536×1024
    // source. Expressed as an aspect ratio so it scales responsively
    // without letterboxing.
    width: 608,
    height: 431,
    alt: 'A motorcycle-gear seller packing orders for dispatch',
  },
} as const;

/* ────────────────────────────────────────────────────────────────────
 * Benefit cards — 5 cards, 3-up grid
 * ──────────────────────────────────────────────────────────────── */

export type BenefitCard = {
  /** 40×40 outline SVG exported from Figma. */
  icon: string;
  title: string;
  body: string;
};

export const BENEFITS_HEADING = 'Everything You Need to Start Selling Online';

export const BENEFITS: BenefitCard[] = [
  {
    icon: '/images/sell-online/icon-coin-rupee.svg',
    title: '₹0 Setup Fee',
    body: 'Create your Throttlein seller account without paying an initial account setup fee.',
  },
  {
    icon: '/images/sell-online/icon-cash-banknote-off.svg',
    title: '0% Commission',
    body: 'New sellers can start selling with zero commission , subject to current seller terms.',
  },
  {
    icon: '/images/sell-online/icon-checklist.svg',
    // En-dash is intentional — matches the design.
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

/* ────────────────────────────────────────────────────────────────────
 * Testimonial
 * ──────────────────────────────────────────────────────────────── */

export const TESTIMONIALS_HEADING = 'Businesses Growing with Throttlein';
export const TESTIMONIALS_INTRO =
  'From local motorcycle-accessories stores to specialised riding-gear brands, Throttlein helps businesses build their online presence and reach more riders. Discover how sellers are using Throttlein to showcase their complete catalogue, receive online orders and grow beyond their local market.';

export type Testimonial = {
  name: string;
  company: string;
  quote: string;
  avatar: string;
};

/**
 * The design ships prev/next carousel controls but only ONE slide. The
 * controls are rendered and functional, and disable themselves at the
 * ends — so with a single entry they're inert rather than broken. Add
 * more entries here and they come alive.
 */
export const TESTIMONIALS: Testimonial[] = [
  {
    name: 'Raju Lunawath',
    company: 'Revgearzz',
    quote:
      'Beginning with a single category, the incredible support and cutting-edge platform from Throttlein allowed me to expand rapidly. I grew to six unique categories, achieving an impressive 5x growth each year!',
    avatar: '/images/sell-online/avatar-raju.webp',
  },
];

/* ────────────────────────────────────────────────────────────────────
 * Guide sections — the 12 anchor-navigable cards
 * ──────────────────────────────────────────────────────────────── */

/** A titled block of prose, optionally followed by a checklist. */
export type SubSection = {
  title: string;
  body?: string;
  /** Rendered as a check-icon list. */
  items?: string[];
};

/** A numbered step with a connector line down the left. */
export type Step = {
  n: string;
  title: string;
  body: string;
};

/** A named group of checklist items (e.g. "Business Information"). */
export type CheckGroup = {
  title: string;
  items: string[];
};

export type GuideSection = {
  /** URL fragment + anchor-nav target. */
  id: string;
  /** Anchor-nav label (short). */
  navLabel: string;
  /** Blue pill above the heading. */
  pill: string;
  heading: string;
  /** Intro paragraphs. */
  paras?: string[];
  /** Named checklist groups. */
  groups?: CheckGroup[];
  /** A single unnamed checklist. */
  items?: string[];
  /** Titled prose sub-sections. */
  subSections?: SubSection[];
  /** A named list of titled sub-sections, e.g. "How the Shipping Process Works". */
  subSectionsHeading?: string;
  /** Numbered journey/workflow steps. */
  steps?: Step[];
  stepsHeading?: string;
  /** Heading above `items`. */
  itemsHeading?: string;
  /** Paragraph after the list. */
  closing?: string;
  /** CTAs at the foot of the card. */
  ctas?: { label: string; href: string; variant: 'primary' | 'secondary' }[];
};

/** Destinations used by the in-card CTAs. Kept together so a route
 *  rename is one edit. `SELLER_CTA`/`sellerNav` own the header links;
 *  these are page-local. */
const CTA_REGISTER = '/register';
const CTA_LOGIN = '/login';
const CTA_ONBOARDING = '/page/seller-onboarding-guide';
const CTA_FEES = '/page/pricing-and-fees';
const CTA_FAQ = '/page/seller-faq';

export const GUIDE_SECTIONS: GuideSection[] = [
  /* ── 01 ─────────────────────────────────────────────────────── */
  {
    id: 'create-account',
    navLabel: 'Create Account',
    pill: 'Create Your Seller Account',
    heading: 'Create Your Throttlein Seller Account',
    paras: [
      'Starting your online motorcycle business on Throttlein is simple.',
      'Register using your shop name, mobile number and business email address. Add your business, tax, banking and pickup information to complete your seller profile.',
      'Once your details have been submitted, the Throttlein team will review your seller application. After approval, you can create your online storefront and begin listing products.',
    ],
    itemsHeading: 'Keep These Details Ready',
    groups: [
      {
        title: 'Business Information',
        items: [
          'Business or shop name',
          'Business type',
          'Registered business address',
          'Owner or authorised representative details',
          'Active mobile number',
          'Business email address',
        ],
      },
      {
        title: 'Tax Information',
        items: [
          'PAN details',
          'Business-registration documents, where applicable',
          'GSTIN or applicable tax-registration information',
        ],
      },
      {
        title: 'Bank Information',
        items: [
          'Account-holder name',
          // Figma truncated this mid-word ("requeste") — completed here.
          'Cancelled cheque or bank-verification document, where requested',
          'IFSC code',
          'Bank account number',
        ],
      },
      {
        title: 'Pickup Information',
        items: [
          'Complete pickup address',
          'Correct postal code',
          'Pickup contact person',
          'Active contact number',
          'Preferred pickup timings',
        ],
      },
    ],
    ctas: [
      { label: 'Create Seller Account', href: CTA_REGISTER, variant: 'primary' },
      { label: 'View Registration Guide', href: CTA_ONBOARDING, variant: 'secondary' },
    ],
  },

  /* ── 02 ─────────────────────────────────────────────────────── */
  {
    id: 'choose-a-category',
    navLabel: 'Choose a Category',
    pill: 'Seller Category Hub',
    heading: 'Popular Motorcycle Categories to Sell Across India',
    paras: [
      'Whether you specialise in rider safety, motorcycle touring, performance parts or everyday accessories, you can build your catalogue in a category relevant to your business.',
    ],
    groups: [
      {
        title: 'Helmets and Rider Safety',
        items: [
          'Sell Helmets Online',
          'Sell Riding Pants Online',
          'Sell Riding Jackets Online',
          'Sell Rider Protection Gear Online',
          'Sell Riding Gloves Online',
          'Sell Rain Riding Gear Online',
          'Sell Riding Boots and Shoes Online',
          'Sell Helmet Accessories Online',
        ],
      },
      {
        title: 'Motorcycle Protection and Accessories',
        items: [
          'Sell Bike Protection Products Online',
          'Sell Wheel Accessories Online',
          'Sell Handlebar Accessories Online',
          'Sell Bike Locks and Security Products Online',
          'Sell Carriers and Backrests Online',
          'Sell Mobile Holders and Navigation Products Online',
        ],
      },
      {
        title: 'Touring and Travel',
        items: [
          'Sell Motorcycle Luggage Online',
          'Sell Travel and Touring Accessories Online',
          'Sell Adventure Riding Gear Online',
        ],
      },
      {
        title: 'Electronics and Performance',
        items: [
          'Sell Bike Lights Online',
          'Sell Motorcycle Performance Parts Online',
          'Sell Battery Chargers Online',
          'Sell Motorcycle Spare Parts Online',
          'Sell Motorcycle Exhaust Systems Online',
        ],
      },
      {
        title: 'Bike Care and Lifestyle',
        items: [
          'Sell Bike Care and Cleaning Products Online',
          'Sell Biker Casuals and Merchandise Online',
        ],
      },
    ],
    ctas: [
      { label: 'Create Seller Account', href: CTA_REGISTER, variant: 'primary' },
      { label: 'View Registration Guide', href: CTA_ONBOARDING, variant: 'secondary' },
    ],
  },

  /* ── 03 ─────────────────────────────────────────────────────── */
  {
    id: 'list-products',
    navLabel: 'List Products',
    pill: 'List Your Products',
    heading: 'Add Your Motorcycle Products to Throttlein',
    paras: [
      'A product listing is the online page customers use to discover, understand and purchase your product.',
      'Every listing should provide complete and accurate information, including the product name, brand, category, images, specifications, compatibility, price, available variants and stock.',
      'Detailed listings help riders choose the correct product and can reduce preventable questions, cancellations and returns.',
    ],
    itemsHeading: 'Information to Include in Every Listing',
    items: [
      'Product title',
      'Material information',
      'Brand and model',
      'Warranty details',
      'Product category',
      'Vehicle compatibility, where applicable',
      'Product description',
      'Certification details, where applicable',
      'Key features',
      'High-quality images',
      'Manufacturer or importer information',
      'Selling price',
      'Package contents',
      'Available quantity',
      'Usage and installation guidance',
      'Size and colour variants',
      'Return or exchange conditions',
      'Product dimensions',
    ],
    subSectionsHeading: 'How to Add a Product',
    subSections: [
      {
        title: 'Create a New Product',
        body: 'If the product is not already available in the Throttlein catalogue, create a new listing. Provide complete product information, including:',
        items: [
          'Correct product name',
          'Dimensions',
          'Brand and model',
          'Size or fit information',
          'Product photographs',
          'Bike compatibility',
          'Technical specifications',
          'Features and benefits',
          'Warranty',
          'Usage instructions',
          'Package contents',
          'Certification information',
        ],
      },
    ],
    closing: 'The product may be reviewed before it becomes visible to customers.',
    ctas: [{ label: 'Add Your First Product', href: CTA_REGISTER, variant: 'primary' }],
  },

  /* ── 04 ─────────────────────────────────────────────────────── */
  {
    id: 'create-better-listings',
    navLabel: 'Create Better Listings',
    pill: 'Create Better Listings',
    heading: 'Help Riders Choose the Right Product',
    paras: [
      'Motorcycle products often require more detailed information than general consumer products. Size, fitment, certification and compatibility can directly affect whether an item is suitable for the customer.',
    ],
    subSections: [
      {
        title: 'Upload Clear Images',
        body: 'Show the product from several angles and include close-up photographs of important features, labels, connectors, mounting points and package contents.',
      },
      {
        title: 'Add Size Information',
        body: 'For helmets, jackets, gloves, boots and riding pants, provide a brand-specific size chart and clear measurement instructions.',
      },
      {
        title: 'Add Bike Compatibility',
        body: 'For crash guards, exhausts, lights, carriers, mobile holders and performance parts, mention the compatible:',
        items: [
          'Motorcycle brand',
          'Variant',
          'Motorcycle model',
          'Installation requirements',
          'Model year',
        ],
      },
      {
        title: 'Mention Certification Details',
        body: 'For products such as helmets and protective riding gear, provide genuine and verifiable certification information wherever applicable.',
      },
      {
        title: 'Maintain Accurate Inventory',
        body: 'Update stock separately for each size, colour, graphic, fitment or product variant.',
      },
      {
        title: 'Write Useful Product Descriptions',
        body: 'Explain what the product is, who it is suitable for, its important features and any limitations the rider should understand.',
      },
    ],
  },

  /* ── 05 ─────────────────────────────────────────────────────── */
  {
    id: 'manage-orders',
    navLabel: 'Manage Orders',
    pill: 'Manage Orders',
    heading: 'Receive and Manage Orders from One Dashboard',
    paras: [
      'When a customer places an order, the order will appear in your Throttlein seller dashboard. You can review the ordered product, selected variant, customer delivery information and fulfilment status before preparing it for dispatch.',
    ],
    stepsHeading: 'Your Order Workflow',
    steps: [
      { n: '1', title: 'Receive the Order', body: 'Get notified through your seller dashboard and registered email address.' },
      { n: '2', title: 'Verify the Product', body: 'Confirm the model, size, colour, compatibility and quantity selected by the customer.' },
      { n: '3', title: 'Confirm the Order', body: 'Accept the order and move it into processing.' },
      // Figma omitted the full stop here.
      { n: '4', title: 'Prepare the Product', body: 'Inspect the item and ensure it is genuine, unused, undamaged and complete.' },
      { n: '5', title: 'Pack and Label', body: 'Pack the product securely and attach the generated shipping label.' },
      { n: '6', title: 'Dispatch the Order', body: 'Hand the package to the assigned courier partner or follow the applicable shipping process.' },
      { n: '7', title: 'Track the Delivery', body: 'Monitor shipment progress and update the order when required.' },
    ],
    ctas: [{ label: 'Explore Order Management', href: CTA_LOGIN, variant: 'primary' }],
  },

  /* ── 06 ─────────────────────────────────────────────────────── */
  {
    id: 'packing-and-shipping',
    navLabel: 'Packing and Shipping',
    pill: 'Packing and Shipping',
    heading: 'Pack Securely and Ship with Confidence',
    paras: [
      // NOTE: the design repeats this paragraph verbatim from section 04.
      // Reproduced as-is; worth de-duplicating with the content owner.
      'Motorcycle products often require more detailed information than general consumer products. Size, fitment, certification and compatibility can directly affect whether an item is suitable for the customer.',
      'Throttlein gives sellers access to order information, shipping-label tools and fulfilment-status updates through the seller dashboard.',
    ],
    subSectionsHeading: 'How the Shipping Process Works',
    subSections: [
      { title: 'Store Products at Your Location', body: 'Keep your products at your shop, office, warehouse or approved pickup location until an order is received.' },
      { title: 'Pack Each Order', body: "Use suitable packaging based on the product's size, weight, value and fragility." },
      { title: 'Generate the Shipping Label', body: 'Download or print the available courier label from your seller dashboard.' },
      { title: 'Schedule or Prepare for Pickup', body: 'Keep the labelled order ready for collection according to the available courier workflow.' },
      { title: 'Track the Shipment', body: 'Follow the shipment status from dispatch to delivery.' },
      { title: 'Manage Delivery Issues', body: 'Use the seller-support workflow for eligible delivery, return or shipment-related concerns.' },
    ],
  },

  /* ── 07 ── responsibilities table, rendered specially ────────── */
  {
    id: 'responsibilities',
    navLabel: 'Seller and Throttlein Responsibilities',
    pill: 'Seller and Throttlein Responsibilities',
    heading: 'How Order Fulfilment Is Managed',
  },

  /* ── 08 ─────────────────────────────────────────────────────── */
  {
    id: 'packaging-guidance',
    navLabel: 'Packaging Guidance',
    pill: 'Packaging Guidance',
    heading: 'Protect Products During Delivery',
    subSections: [
      { title: 'Helmets', body: 'Use the original helmet bag and box where available. Protect the visor, air vents, spoiler and shell, and place the product box inside a suitable outer carton.' },
      { title: 'Riding Jackets and Pants', body: 'Fold products carefully and use moisture-resistant inner packaging. Avoid compressing protective armour in a way that could damage it.' },
      { title: 'Riding Gloves', body: 'Keep the pair together, protect hard knuckles and securely seal the retail packaging.' },
      { title: 'Riding Boots', body: 'Use the original footwear box where available and place it inside an appropriate outer shipping carton.' },
      { title: 'Motorcycle Lights and Electronics', body: 'Protect connectors, wiring, lenses and electronic components with suitable cushioning and anti-static packaging where necessary.' },
      { title: 'Exhausts and Metal Parts', body: "Cover sharp edges, protect finished surfaces and use packaging strong enough to support the product's weight." },
      { title: 'Liquids and Bike-Care Products', body: 'Ensure containers are properly sealed and packed according to applicable courier and product-shipping requirements.' },
    ],
  },

  /* ── 09 ─────────────────────────────────────────────────────── */
  {
    id: 'build-customer-trust',
    navLabel: 'Build Customer Trust',
    pill: 'Build Customer Trust',
    heading: 'Build a Reliable Seller Profile',
    paras: [
      'Customers are more likely to buy from sellers who provide accurate information and consistently fulfil orders correctly.',
      'You can strengthen trust in your online store by:',
    ],
    items: [
      'Completing business verification',
      'Confirming orders promptly',
      'Using your correct shop or brand name',
      'Dispatching within the promised timeline',
      'Listing genuine products',
      'Handling eligible returns professionally',
      'Providing accurate specifications',
      'Following Throttlein seller policies',
      'Uploading actual product images',
      'Packing products securely',
      'Maintaining current inventory',
    ],
    closing: 'Reliable selling practices can help improve customer confidence, repeat purchases and long-term store performance.',
    ctas: [{ label: 'Complete Your Seller Profile', href: CTA_REGISTER, variant: 'primary' }],
  },

  /* ── 10 ─────────────────────────────────────────────────────── */
  {
    id: 'receive-payments',
    navLabel: 'Receive Payments',
    pill: 'Receive Payments',
    heading: 'Receive Payments in Your Registered Bank Account',
    paras: [
      'Payments for successfully completed orders are processed to the bank account connected to your Throttlein seller profile.',
      'You can review applicable order values, marketplace charges, shipping adjustments, returns and settlement information through the available seller-payment workflow.',
    ],
    stepsHeading: 'Payment Process',
    steps: [
      { n: '1', title: 'Customer Places an Order', body: 'The customer completes payment through the Throttlein checkout.' },
      { n: '2', title: 'You Fulfil the Order', body: 'Confirm, pack and dispatch the correct product.' },
      { n: '3', title: 'The Order Is Delivered', body: 'The shipment is delivered and completes the applicable order and return-validation period.' },
      { n: '4', title: 'Settlement Is Processed', body: 'The eligible amount is included in your seller-payment cycle.' },
      { n: '5', title: 'Payment Reaches Your Bank', body: 'The settlement is transferred to your registered bank account.' },
    ],
    ctas: [{ label: 'Understand Fees and Pricing', href: CTA_FEES, variant: 'primary' }],
  },

  /* ── 11 ─────────────────────────────────────────────────────── */
  {
    id: 'seller-dashboard',
    navLabel: 'Seller Dashboard',
    pill: 'Seller Dashboard',
    heading: 'Manage Your Business from One Seller Dashboard',
    paras: [
      'Stay connected with your Throttlein shop and manage everyday selling activities from one place.',
      'The seller dashboard allows you to:',
    ],
    items: [
      'Create product listings',
      'Generate courier labels',
      'Edit existing listings',
      'Update fulfilment status',
      'Add product images',
      'Review shipment progress',
      'Manage sizes and variants',
      'Monitor returns',
      'Update prices',
      'View payment information',
      'Track inventory',
      'Manage seller details',
      'Receive order notifications',
      'Contact seller support',
      'Confirm customer orders',
    ],
    closing: 'Whether you are at your store, warehouse or office, your seller dashboard helps you stay informed and take action on important orders.',
  },

  /* ── 12 ── has a leading image block, rendered specially ─────── */
  {
    id: 'help-and-support',
    navLabel: 'Help and Support',
    pill: 'Help and Support',
    heading: 'Seller Support at Every Step',
    paras: [
      'Selling online can involve questions about registration, product listings, orders, shipping, payments and returns.',
      "Throttlein's seller-support resources are designed to help you understand the platform and resolve eligible seller-account or order-related issues.",
    ],
    itemsHeading: 'Seller Support Can Help With',
    items: [
      'Account registration',
      'Business verification',
      'GST and document-submission guidance',
      'Product-category selection',
      'Product-listing issues',
      'Brand and model information',
      'Size and variant setup',
      'Bike-compatibility fields',
      'Inventory management',
      'Order processing',
      'Courier-label issues',
      'Shipping-status queries',
      'Payment and settlement queries',
      'Returns and exchanges',
      'Seller-policy questions',
      'Seller-dashboard access',
    ],
    ctas: [
      { label: 'Contact Seller Support', href: CTA_FAQ, variant: 'primary' },
      { label: 'Download Seller Onboarding Guide', href: CTA_ONBOARDING, variant: 'secondary' },
    ],
  },
];

/* ── Section 01's nested "Don't Have a GSTIN?" card ────────────── */

export const GSTIN_CARD = {
  heading: "Don't Have a GSTIN?",
  paras: [
    'GST registration requirements may depend on your business type, turnover, products and applicable Indian tax regulations.',
    'Visit the official GST portal to understand the current registration requirements and complete the applicable process for your business.',
  ],
  stepsHeading: 'General Registration Journey',
  steps: [
    { n: '01', title: 'Visit the Official GST Portal', body: 'Open the official government GST registration website and select the new-registration option.' },
    { n: '02', title: 'Enter Your Business Details', body: 'Provide the required PAN, contact information, business address and business-activity details.' },
    { n: '03', title: 'Upload the Required Documents', body: 'Submit the applicable identity, address, bank and business-registration documents.' },
    { n: '04', title: 'Submit and Track Your Application', body: 'Complete the verification process and use your application reference number to track the registration status.' },
  ],
} as const;

/* ── Section 02's nested "Choose Your Categories" card ─────────── */

export const CATEGORY_SHORTLIST_HEADING = 'Choose Your Categories';

/** The same 16 labels the seller FOOTER uses. Duplicated in the design;
 *  here it's one array referenced from both places it appears. */
export const CATEGORY_SHORTLIST = [
  'Sell Helmets Online',
  'Sell Riding Gear Online',
  'Sell Bike Parts Online',
  'Sell Accessories Online',
  'Sell Exhaust Systems Online',
  'Sell Performance Parts Online',
  'Sell Motorcycle Apparel Online',
  'Sell Tools & Maintenance Online',
  'Sell Tyres & Wheels Online',
  'Sell Lubricants Online',
  'Sell GPS & Electronics Online',
  'Sell Vintage Parts Online',
  'Sell Custom Parts Online',
  'Sell Safety Equipment Online',
  'Sell Touring Accessories Online',
  'Sell Racing Gear Online',
];

/* ── Section 12's support image block ──────────────────────────── */

export const SUPPORT_IMAGE = {
  src: '/images/sell-online/support.webp',
  width: 170,
  height: 202,
  alt: 'A Throttlein seller-support agent at a desk',
};

/* ────────────────────────────────────────────────────────────────────
 * Section 07 — responsibilities table
 * ──────────────────────────────────────────────────────────────── */

export const RESPONSIBILITIES_COLUMNS = ['Activity', 'Seller Responsibility'] as const;

export const RESPONSIBILITIES: {
  activity: string;
  seller: string;
  throttlein: string;
}[] = [
  { activity: 'Product storage',  seller: 'Store products safely at the registered location', throttlein: 'Provide inventory-management tools' },
  { activity: 'Product quality',  seller: 'Inspect authenticity, condition and completeness', throttlein: 'Provide listing and policy standards' },
  { activity: 'Packaging',        seller: 'Select and pack products securely',                throttlein: 'Provide shipping details and workflow guidance' },
  { activity: 'Shipping label',   seller: 'Print and attach the correct label',               throttlein: 'Generate or provide the label through the dashboard' },
  { activity: 'Courier pickup',   seller: 'Keep the order ready on time',                     throttlein: 'Connect the order with the applicable delivery workflow' },
  { activity: 'Shipment tracking', seller: 'Monitor orders and respond when action is required', throttlein: 'Display available tracking updates' },
  { activity: 'Order status',     seller: 'Confirm and update fulfilment stages',              throttlein: 'Provide dashboard status controls' },
  { activity: 'Returns',          seller: 'Review and process eligible returned products',     throttlein: 'Provide the return and support workflow' },
  { activity: 'Customer support', seller: 'Provide accurate product and order information',    throttlein: 'Assist with platform and order-related queries' },
];

/* ────────────────────────────────────────────────────────────────────
 * Closing CTA banner
 * ──────────────────────────────────────────────────────────────── */

export const CLOSING_CTA = {
  heading: 'Ready to Take Your Motorcycle Business Online?',
  body: 'Join a marketplace built for motorcycle businesses and riders. Create your seller account, list your products and start building your online shop on Throttlein.',
  proofPoints: [
    'Start with no setup fee',
    'No monthly subscription',
    '0% commission.',
  ],
  background: '/images/sell-online/cta-bg-png.webp',
} as const;

/* ────────────────────────────────────────────────────────────────────
 * FAQ
 * ──────────────────────────────────────────────────────────────── */

/**
 * Answers 2–4 were lorem placeholders in the design
 * ("We meticulously uncover your core needs…"). They've been written
 * from this page's own content so the accordion isn't shipping filler —
 * replace with approved copy when available.
 *
 * Answer 1 in the design is boilerplate from an unrelated project
 * ("high-quality throttles", "custom code", "responsive design"), so it
 * has been rewritten too.
 */
export const FAQ: { q: string; a: string }[] = [
  {
    q: 'What services does Throttlein offer for bike part sales?',
    a: 'Throttlein is a marketplace built specifically for motorcycle gear and parts. You get an online storefront, a seller dashboard for listings and orders, courier-label generation and fulfilment tracking, settlement of payments to your registered bank account, and seller support for registration, listing and order queries.',
  },
  {
    q: 'What can I sell on THROTTLEIN?',
    a: 'Helmets and rider safety gear, riding jackets, gloves, boots and pants, bike protection and accessories, touring luggage, lights and electronics, exhausts and performance parts, spares, bike-care products and biker merchandise. If you manufacture, import or retail motorcycle products, there is a category for you.',
  },
  {
    q: 'Is there a setup fee or monthly subscription?',
    a: 'No. Creating a Throttlein seller account has no setup fee and no monthly subscription. New sellers also start with 0% commission, subject to the current seller terms.',
  },
  {
    q: 'How long does approval take?',
    a: 'Seller applications are usually reviewed within 24–48 hours of submitting complete business, tax, bank and pickup details. Having your documents ready before you start is the quickest route to approval.',
  },
];
