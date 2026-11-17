/**
 * Startup seed — creates the singleton HomeSeoBlock document on first
 * boot with the exact copy that used to be hardcoded in
 * frontend/components/pages/HomePage.tsx (EXPLORE_LINKS + SEO_INTRO).
 *
 * Idempotent: if any document already exists in the collection the
 * seed is a no-op so admin edits are never clobbered.
 */
const HomeSeoBlock = require('../../modules/cms/home-seo-block.model');
const { logger } = require('../../utils/logger');

const SEED_HEADING =
  'Discover our extensive range of bike accessories Throttlein is your go-to marketplace for all things biking.';

// Authored as three <p> blocks — one per logical paragraph in the
// original SEO_INTRO body. Stored as HTML so the admin TipTap editor
// can round-trip it.
const SEED_BODY =
  "<p>Whether you're gearing up for a new ride or looking to upgrade your current setup, Throttlein is here to inspire you with budget-friendly bike accessory solutions. From helmets to protective gear, we have something for every rider.</p>" +
  "<p>Shopping at Throttlein is a unique experience compared to traditional retail. It's about immersing yourself in hands-on solutions and discovering ideas that fit your biking lifestyle. That's why we offer over 10,000 products and services for you to explore.</p>" +
  '<p>When you visit Throttlein, feel free to interact with our product displays. Test the comfort of our helmets, examine the quality of our gear, and explore our wide range of accessories. Each product tag provides essential information, including where to find it in our store. Most of our products are designed for easy transport, making it simple to take your new gear home.</p>';

// Exact label + href + order copied 1:1 from the original EXPLORE_LINKS
// constant in frontend/components/pages/HomePage.tsx.
const SEED_LINKS = [
  { label: 'Explore LS2 Helmets', href: '/helmets-and-accessories' },
  { label: 'Discover Rynox Gloves', href: '/gloves' },
  { label: 'Purchase Stylish Jackets', href: '/jackets' },
  { label: 'Check Out Head Lights', href: '/lighting' },
  { label: 'Investigate Protective Gear', href: '/rider-protection' },
  { label: 'Locate Riding Boots', href: '/boots' },
  { label: 'Browse Safety Accessories', href: '/bike-safety' },
  { label: 'Select Motorcycle Apparel', href: '/jackets' },
  { label: 'Uncover Essential Gear', href: '/products' },
  { label: 'Find Performance Accessories', href: '/exhaust' },
  { label: 'Shop for Riding Equipment', href: '/products' },
  { label: 'View Our Safety Gear', href: '/rider-protection' },
  { label: 'Discover Your Riding Essentials', href: '/products' },
  { label: 'Check Out Your Motorcycle Gear', href: '/products' },
  { label: 'Explore Our Riding Accessories', href: '/products' },
  { label: 'Browse New Safety Equipment', href: '/bike-safety' },
];

async function seedHomeSeoBlock() {
  const existing = await HomeSeoBlock.estimatedDocumentCount();
  if (existing > 0) {
    return; // already seeded — never overwrite admin edits
  }
  await HomeSeoBlock.create({
    heading: SEED_HEADING,
    body: SEED_BODY,
    links: SEED_LINKS,
    isActive: true,
  });
  logger.info('Seeded HomeSeoBlock singleton.');
}

module.exports = seedHomeSeoBlock;
module.exports.SEED_HEADING = SEED_HEADING;
module.exports.SEED_BODY = SEED_BODY;
module.exports.SEED_LINKS = SEED_LINKS;
