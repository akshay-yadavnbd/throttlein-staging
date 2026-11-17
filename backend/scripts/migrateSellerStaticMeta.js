#!/usr/bin/env node
/**
 * One-off: MOVE the seller landing page's SEO record onto the seller
 * property.
 *
 *   npm run migrate:seller-meta            # apply
 *   npm run migrate:seller-meta -- --dry   # report only
 *
 * WHY THIS EXISTS
 * `seller.throttlein.com/` is served by `app/seller/page.tsx`, and its
 * SEO override has always been stored as a MAIN-site record keyed
 * `staticRoute: '/seller'` — because before the multi-site split there
 * was only one site, and the page lived at `throttlein.com/seller`.
 *
 * Now that the seller property has its own Pages screen, that page is
 * listed there as "Seller home" at route `/` and reads a
 * `site: 'seller', staticRoute: '/'` record. Without this script the
 * marketing copy already written into the old record would simply stop
 * being used — the page would silently fall back to its in-code
 * defaults, the kind of regression nobody notices until a search
 * listing changes.
 *
 * WHY MOVE RATHER THAN COPY
 * Nothing reads the main-site record any more. `throttlein.com/seller`
 * 301s to the subdomain, so it has no metadata surface of its own, and
 * `/seller` has been removed from the main site's static manifest
 * (admin/lib/staticPages.ts) and from the filesystem walk
 * (src/utils/discoverStaticPages.js). Leaving the row behind would show
 * the seller domain's home page on the Throttlein Pages list wearing an
 * "SEO override" badge that no longer does anything — worse than having
 * no row at all.
 *
 * Idempotent: re-running finds no source record and exits cleanly.
 */

require('../loadEnv');
const mongoose = require('mongoose');
const Page = require('../src/modules/cms/page.model');

const DRY_RUN = process.argv.includes('--dry');
/**
 * `--cleanup` additionally DELETES the now-dead main-site rows for
 * `/seller` and `/sell`.
 *
 * Both are static-meta records for a page that no longer lives on the
 * main site. They're invisible in the admin — neither route is in the
 * main static manifest any more, so no row renders for them and there's
 * no way to delete them through the UI. Left alone they're harmless but
 * permanently orphaned.
 *
 * Off by default: this is destructive, and the sensible order is to
 * confirm the seller page reads correctly first, then clean up.
 */
const CLEANUP = process.argv.includes('--cleanup');
const log = (...a) => console.log('[migrate:seller-meta]', ...a);

/** Delete the orphaned main-site records, if asked. */
async function cleanupOrphans(Page) {
  const orphans = await Page.find({
    site: 'main',
    type: 'static-meta',
    staticRoute: { $in: ['/seller', '/sell'] },
  });
  if (!orphans.length) {
    log('cleanup: no orphaned /seller or /sell records found');
    return;
  }
  for (const o of orphans) {
    if (DRY_RUN) {
      log(`cleanup: WOULD delete main-site "${o.staticRoute}" (${o._id})`);
      continue;
    }
    await o.deleteOne();
    log(`cleanup: deleted main-site "${o.staticRoute}" (${o._id})`);
  }
}

/**
 * Drop the Redis page cache.
 *
 * `pageController` caches static-meta lookups under
 * `page:<site>:static-meta:<route>` for 5 minutes and busts them from
 * its own write paths. This script writes straight to Mongo, so it has
 * to do the busting itself — otherwise the storefront serves the old
 * meta for up to five minutes after a migration that reports success.
 */
async function bustPageCache() {
  // Nothing was written, so nothing is stale.
  if (DRY_RUN) return;
  try {
    const { deleteCacheByPattern } = require('../src/utils/redisCache');
    await deleteCacheByPattern('page:*');
    log('cleared the page:* Redis cache');
  } catch (err) {
    log(`could not clear the Redis cache (${err.message}).`);
    log('Not fatal — entries expire on their own within 5 minutes.');
  }
}

/** Fields reported in the dry-run summary so you can see what's being
 *  carried over before committing to it. */
const MEANINGFUL_FIELDS = [
  'seoTitle',
  'seoDescription',
  'ogImage',
  'contentTitle',
  'contentDescription',
  'bottomTitle',
  'bottomDescription',
];

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('[migrate:seller-meta] MONGO_URI is not set. Aborting.');
    process.exit(1);
  }

  log(DRY_RUN ? 'DRY RUN — no changes will be written' : 'Applying');
  await mongoose.connect(uri);
  log(`connected to ${mongoose.connection.name}`);

  // `--cleanup` runs on its own: the point of it is to remove the
  // records this script would otherwise treat as its source, so doing
  // both in one pass would be self-defeating.
  if (CLEANUP) {
    await cleanupOrphans(Page);
    await bustPageCache();
    await mongoose.disconnect();
    log(DRY_RUN ? 'dry run complete — nothing written' : 'cleanup done');
    return;
  }

  const source = await Page.findOne({
    site: 'main',
    type: 'static-meta',
    staticRoute: '/seller',
  });

  if (!source) {
    log('no main-site "/seller" static-meta record found — nothing to copy.');
    log('That is fine: it just means nobody had written SEO copy for the');
    log('seller landing page yet. Create it from Admin → Seller → Pages.');
    await mongoose.disconnect();
    return;
  }

  log(`found source record ${source._id}: "${source.seoTitle || source.title}"`);
  const set = MEANINGFUL_FIELDS.filter((f) => source[f]);
  log(`fields carried over: ${set.join(', ') || '(none set)'}`);

  const existing = await Page.findOne({
    site: 'seller',
    type: 'static-meta',
    staticRoute: '/',
  });

  if (existing) {
    // A record can exist and still be EMPTY — clicking "Set meta" in the
    // admin creates the row before any copy is typed into it. Refusing
    // in that case would be the wrong call: an empty placeholder would
    // permanently block the real copy from ever arriving, and the page
    // would keep falling back to its in-code defaults with a row in the
    // admin that looks like it's doing something.
    const populated = MEANINGFUL_FIELDS.filter((f) => existing[f]);
    if (populated.length > 0) {
      log(`a seller-site "/" record already exists (${existing._id}) and has`);
      log(`copy in: ${populated.join(', ')}.`);
      log('Not overwriting it — merging two sets of copy is a judgement');
      log('call this script should not make. Review both and delete the');
      log('stale one by hand.');
      await mongoose.disconnect();
      return;
    }

    log(`a seller-site "/" record exists (${existing._id}) but is empty —`);
    log('treating it as the placeholder the admin UI creates and filling it in.');
    if (DRY_RUN) {
      log(`WOULD copy ${set.join(', ') || '(nothing)'} into it.`);
      await mongoose.disconnect();
      log('dry run complete — nothing written');
      return;
    }
    for (const f of MEANINGFUL_FIELDS) {
      if (source[f]) existing[f] = source[f];
    }
    existing.title = existing.title || 'Seller home';
    existing.isPublished = source.isPublished !== false;
    await existing.save();
    log(`filled ${existing._id} from the main-site "/seller" record.`);
    log('The source record is left in place; delete it once you have');
    log('confirmed the seller page reads correctly.');
    await bustPageCache();
    await mongoose.disconnect();
    log('done');
    return;
  }

  if (DRY_RUN) {
    log('WOULD move this record to site="seller", staticRoute="/",');
    log('slug="static-home", title="Seller home".');
    log('The main-site "/seller" row would then disappear from the');
    log('Throttlein Pages list — which is the point: that page belongs');
    log('to the seller domain.');
    await mongoose.disconnect();
    log('dry run complete — nothing written');
    return;
  }

  // Reassign in place. Keeps the _id, createdAt and any image-cleanup
  // bookkeeping attached to the document, which a delete-and-recreate
  // would throw away (and would fire the S3 cleanup hook on ogImage).
  source.site = 'seller';
  source.staticRoute = '/';
  // Slug is required by the model but unused for static-meta rows, which
  // are keyed by staticRoute. Deliberately matches what the admin UI
  // generates for route '/' — `static-` + slugified route, which falls
  // back to 'home' for an empty path. See
  // admin/app/pages/static-meta/new/page.tsx, so a record created either
  // way has the same shape.
  source.slug = 'static-home';
  source.title = 'Seller home';
  await source.save();

  log(`moved record ${source._id} → site="seller", staticRoute="/"`);
  log('It now appears under Admin → (switch to Seller) → Pages, and is');
  log('read by seller.throttlein.com/.');
  await bustPageCache();

  // The legacy '/sell' record (from before the route was renamed) is
  // left alone: it isn't in either manifest, so it renders nowhere and
  // harms nothing. Delete it from Mongo if you want the tidiness.
  const legacySell = await Page.countDocuments({
    site: 'main',
    type: 'static-meta',
    staticRoute: '/sell',
  });
  if (legacySell) {
    log(`note: ${legacySell} legacy "/sell" record(s) remain from the old`);
    log('route name. They are unreferenced and invisible in the admin.');
  }

  await mongoose.disconnect();
  log('done');
}

main()
  .then(() => {
    // The Redis client (ioredis) keeps a retry timer alive when the server
    // is unreachable, which leaves the process hanging after the work is
    // done. Everything is committed by this point, so exit explicitly.
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[migrate:seller-meta] FAILED:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
