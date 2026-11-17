/**
 * Startup seed: ensure the PromoBlock collection has the 3 default
 * blocks that match the original hardcoded PROMO_LEFT / PROMO_RIGHT /
 * PROMO_BOTTOM constants in frontend/components/pages/HomePage.tsx.
 *
 * Runs ONCE on first boot — if the collection already has any document
 * this is a no-op so we never overwrite admin-edited content.
 *
 * After this seed runs, admins manage all promo blocks from
 * /admin → Pages → Promo Blocks.
 */
const PromoBlock = require('../../modules/cms/promo-block.model');
const { logger } = require('../../utils/logger');

const SEED_BLOCKS = [
  {
    order: 0,
    variant: 'image-grid',
    title: 'Mobile Holders & Navigation Accessories',
    chips: [
      { label: 'Phone mounts', href: '/products?tag=phone-mounts' },
      { label: 'Charging mounts', href: '/products?tag=charging' },
      { label: 'Waterproof phone cases', href: '/products?tag=waterproof-cases' },
      { label: 'Navigation Screen', href: '/products?tag=navigation' },
    ],
    ctaLabel: 'Explore Products',
    ctaHref: '/mobile-holders',
    images: [
      '/images/figma/promo-mobile-1.jpg',
      '/images/figma/promo-mobile-2.jpg',
      '/images/figma/promo-mobile-3.jpg',
      '/images/figma/promo-mobile-4.jpg',
    ],
    isActive: true,
  },
  {
    order: 1,
    variant: 'single-image',
    title: 'Seasonal Collections',
    chips: [
      { label: 'Chains', href: '/products?tag=chains' },
      { label: 'Inner Sleeves', href: '/products?tag=inner-sleeves' },
      { label: 'Chest Cover Jackets', href: '/products?tag=chest-cover' },
      { label: 'Waterproof Boots', href: '/products?tag=waterproof-boots' },
    ],
    ctaLabel: 'Explore',
    ctaHref: '/seasonal-collections',
    images: ['/images/figma/promo-seasonal.jpg'],
    isActive: true,
  },
  {
    order: 2,
    variant: 'image-grid',
    title: 'Bike Protection Accessories',
    chips: [
      { label: 'Crash guards', href: '/products?tag=crash-guards' },
      { label: 'Frame sliders', href: '/products?tag=frame-sliders' },
      { label: 'Engine guards', href: '/products?tag=engine-guards' },
      { label: 'Radiator guards', href: '/products?tag=radiator-guards' },
    ],
    ctaLabel: 'Explore Products',
    ctaHref: '/bike-protection',
    images: [
      '/images/figma/promo-protect-1.jpg',
      '/images/figma/promo-protect-2.jpg',
      '/images/figma/promo-protect-3.jpg',
      '/images/figma/promo-protect-4.jpg',
    ],
    isActive: true,
  },
];

async function seedPromoBlocks() {
  const existing = await PromoBlock.estimatedDocumentCount();
  if (existing > 0) {
    return; // already seeded — never clobber admin-edited content
  }
  await PromoBlock.insertMany(SEED_BLOCKS);
  logger.info(`Seeded ${SEED_BLOCKS.length} promo blocks.`);
}

module.exports = seedPromoBlocks;
module.exports.SEED_BLOCKS = SEED_BLOCKS;
