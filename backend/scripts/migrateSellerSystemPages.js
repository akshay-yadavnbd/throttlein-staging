#!/usr/bin/env node
/**
 * One-off: move the four SELLER system documents from the main site to
 * the seller property.
 *
 *   npm run migrate:seller-pages            # apply
 *   npm run migrate:seller-pages -- --dry   # report only
 *
 * WHY
 * `src/utils/seedPages.js` seeds ten system pages. Four of them are
 * seller documents — the seller agreement, the seller FAQ, the fee
 * schedule and the onboarding handbook. They were created before the
 * multi-site split, so `migrateSiteField.js` filed them under
 * `site: 'main'` along with everything else.
 *
 * They belong to seller.throttlein.com: the seller header and footer
 * link to them, and they're written for sellers, not shoppers. Left on
 * the main site they'd show up on the Throttlein Pages list while the
 * seller nav pointed at slugs that resolve to nothing on its own domain.
 *
 * The six genuinely main-site documents stay put:
 *   home, privacy-policy, terms-and-conditions,
 *   return-and-refund-policy, shipping-policy, cancellation-policy
 *
 * Note privacy-policy is deliberately NOT duplicated. One company, one
 * privacy policy — the seller footer links to it on the main origin
 * rather than keeping a second copy in sync.
 *
 * Idempotent. Re-running finds nothing left to move.
 */

require('../loadEnv');
const mongoose = require('mongoose');
const Page = require('../src/modules/cms/page.model');

const DRY_RUN = process.argv.includes('--dry');
const log = (...a) => console.log('[migrate:seller-pages]', ...a);

/** Slugs that belong to the seller property. Keep in sync with the
 *  `site: 'seller'` entries in src/utils/seedPages.js. */
const SELLER_SLUGS = ['seller-terms', 'seller-faq', 'pricing-and-fees', 'seller-onboarding-guide'];

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('[migrate:seller-pages] MONGO_URI is not set. Aborting.');
    process.exit(1);
  }

  log(DRY_RUN ? 'DRY RUN — no changes will be written' : 'Applying');
  await mongoose.connect(uri);
  log(`connected to ${mongoose.connection.name}`);

  let moved = 0;
  let skipped = 0;

  for (const slug of SELLER_SLUGS) {
    const onMain = await Page.findOne({ site: 'main', slug });
    if (!onMain) {
      log(`${slug}: nothing on the main site — already moved or never seeded`);
      skipped += 1;
      continue;
    }

    // A record with this slug may already exist on the seller side (if
    // someone created one by hand). Slug is unique per site, so moving
    // would throw E11000 — report it and let a human decide which copy
    // is the real one.
    const clash = await Page.findOne({ site: 'seller', slug });
    if (clash) {
      log(`${slug}: ✗ a seller-site page with this slug already exists (${clash._id}).`);
      log(`    Leaving the main-site copy (${onMain._id}) alone. Compare the two`);
      log('    and delete whichever is stale, then re-run.');
      skipped += 1;
      continue;
    }

    if (DRY_RUN) {
      log(`${slug}: WOULD move "${onMain.title}" → site="seller"`);
      moved += 1;
      continue;
    }

    // Reassign in place, keeping _id/createdAt and avoiding the S3
    // image-cleanup hook that a delete-and-recreate would trigger on
    // ogImage.
    onMain.site = 'seller';
    await onMain.save();
    log(`${slug}: moved "${onMain.title}" → site="seller"`);
    moved += 1;
  }

  // Bust the page cache.
  //
  // `pageController` Redis-caches lookups under `page:<site>:slug:<slug>`
  // for 5 minutes, and normally busts them from its own write paths. A
  // script writing straight to Mongo bypasses that entirely — so
  // without this, a moved page keeps being served from the OLD site's
  // cache entry for up to five minutes. It self-heals, but "the
  // migration says it worked and the site disagrees" is a confusing
  // five minutes to spend.
  if (!DRY_RUN && moved > 0) {
    try {
      const { deleteCacheByPattern } = require('../src/utils/redisCache');
      await deleteCacheByPattern('page:*');
      log('cleared the page:* Redis cache');
    } catch (err) {
      log(`could not clear the Redis cache (${err.message}).`);
      log('Not fatal — entries expire on their own within 5 minutes.');
    }
  }

  log('── Summary');
  log(`${moved} ${DRY_RUN ? 'would move' : 'moved'}, ${skipped} skipped`);

  const mainCount = await Page.countDocuments({ site: 'main' });
  const sellerCount = await Page.countDocuments({ site: 'seller' });
  log(`Pages now: main=${mainCount}  seller=${sellerCount}`);

  if (!DRY_RUN && moved > 0) {
    log('');
    log('These pages now render at seller.throttlein.com/page/<slug> and');
    log('appear under Admin → (switch to Seller) → Pages.');
  }

  await mongoose.disconnect();
  log(DRY_RUN ? 'dry run complete — nothing written' : 'done');
}

main()
  .then(() => {
    // The Redis client (ioredis) keeps a retry timer alive when the server
    // is unreachable, which leaves the process hanging after the work is
    // done. Everything is committed by this point, so exit explicitly.
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[migrate:seller-pages] FAILED:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
