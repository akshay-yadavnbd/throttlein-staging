#!/usr/bin/env node
/**
 * Multi-site migration — backfills the `site` field and swaps the legacy
 * globally-unique slug indexes for site-scoped compound ones.
 *
 *   npm run migrate:site            # apply
 *   npm run migrate:site -- --dry   # report only, change nothing
 *
 * Idempotent: safe to run repeatedly. Every step is a no-op once
 * applied, so a half-finished run can simply be re-run.
 *
 * WHY A SCRIPT AND NOT syncIndexes() ALONE
 *   Mongoose creates indexes it knows about but will NOT drop indexes
 *   that disappeared from the schema. The old `slug_1 unique` index
 *   would survive `syncIndexes()` on some versions and silently keep
 *   rejecting a seller page whose slug matches a main-site one. So we
 *   drop the legacy indexes explicitly, then let syncIndexes() build
 *   the new ones.
 *
 * RUN ORDER IN PRODUCTION
 *   1. Deploy the backend carrying the new schemas.
 *   2. Run this script.
 *   3. Deploy admin + frontend.
 *   Because `site` defaults to 'main' and every read defaults to 'main',
 *   the live site behaves identically throughout.
 */

require('../loadEnv');
const mongoose = require('mongoose');
const { DEFAULT_SITE } = require('../src/config/sites');

const DRY_RUN = process.argv.includes('--dry');

// Models whose documents get `site: 'main'` and whose legacy indexes
// need dropping. `legacyIndexes` are index NAMES as Mongo reports them.
const TARGETS = [
  { name: 'Page', path: '../src/modules/cms/page.model', legacyIndexes: ['slug_1'] },
  { name: 'BlogPost', path: '../src/modules/blog/blog-post.model', legacyIndexes: ['slug_1'] },
  { name: 'BlogCategory', path: '../src/modules/blog/blog-category.model', legacyIndexes: ['slug_1', 'name_1'] },
  { name: 'BlogTag', path: '../src/modules/blog/blog-tag.model', legacyIndexes: ['slug_1', 'name_1'] },
  { name: 'Redirect', path: '../src/modules/cms/redirect.model', legacyIndexes: ['source_1'] },
  // BlogComment has no legacy unique index — its `site` is denormalised
  // from the parent post, handled separately below.
  { name: 'BlogComment', path: '../src/models/BlogComment', legacyIndexes: [], skipSimpleBackfill: true },
];

function log(...args) {
  console.log('[migrate:site]', ...args);
}

async function backfillSite(Model, label) {
  const missing = await Model.countDocuments({ site: { $exists: false } });
  if (missing === 0) {
    log(`${label}: site already set on all documents — skipping backfill`);
    return 0;
  }
  if (DRY_RUN) {
    log(`${label}: WOULD set site='${DEFAULT_SITE}' on ${missing} document(s)`);
    return missing;
  }
  const res = await Model.updateMany({ site: { $exists: false } }, { $set: { site: DEFAULT_SITE } });
  log(`${label}: set site='${DEFAULT_SITE}' on ${res.modifiedCount} document(s)`);
  return res.modifiedCount;
}

/**
 * Comments inherit their site from the post they belong to. Done as a
 * grouped update (one updateMany per distinct site) rather than a
 * per-document loop so a large comment table doesn't take minutes.
 */
async function backfillCommentSites(BlogComment, BlogPost) {
  const missing = await BlogComment.countDocuments({ site: { $exists: false } });
  if (missing === 0) {
    log('BlogComment: site already set on all documents — skipping backfill');
    return;
  }
  if (DRY_RUN) {
    log(`BlogComment: WOULD derive site from parent post for ${missing} document(s)`);
    return;
  }
  // Post IDs grouped by the site their post belongs to.
  const groups = await BlogPost.aggregate([{ $group: { _id: '$site', ids: { $push: '$_id' } } }]);
  let total = 0;
  for (const g of groups) {
    const site = g._id || DEFAULT_SITE;
    const res = await BlogComment.updateMany({ site: { $exists: false }, post: { $in: g.ids } }, { $set: { site } });
    total += res.modifiedCount;
    log(`BlogComment: set site='${site}' on ${res.modifiedCount} document(s)`);
  }
  // Orphans — comments whose post was hard-deleted. Default them so the
  // required field is satisfied and they stay visible to moderation.
  const orphans = await BlogComment.updateMany({ site: { $exists: false } }, { $set: { site: DEFAULT_SITE } });
  if (orphans.modifiedCount) {
    log(`BlogComment: ${orphans.modifiedCount} orphaned comment(s) defaulted to '${DEFAULT_SITE}'`);
  }
  log(`BlogComment: ${total + orphans.modifiedCount} total updated`);
}

async function dropLegacyIndexes(Model, label, names) {
  if (!names.length) return;
  const existing = await Model.collection.indexes().catch(() => []);
  const existingNames = new Set(existing.map((i) => i.name));
  for (const name of names) {
    if (!existingNames.has(name)) {
      log(`${label}: legacy index "${name}" already gone`);
      continue;
    }
    if (DRY_RUN) {
      log(`${label}: WOULD drop legacy index "${name}"`);
      continue;
    }
    try {
      await Model.collection.dropIndex(name);
      log(`${label}: dropped legacy index "${name}"`);
    } catch (err) {
      // IndexNotFound (27) is fine — a concurrent run beat us to it.
      if (err.code === 27 || /index not found/i.test(err.message)) {
        log(`${label}: legacy index "${name}" not found (already dropped)`);
      } else {
        throw err;
      }
    }
  }
}

/**
 * Before creating a unique compound index, make sure it can actually be
 * built. If two documents on the same site share a slug (possible only
 * if someone inserted directly), the index build fails with a cryptic
 * E11000 — better to name the offenders up front.
 */
async function checkDuplicates(Model, label, keys) {
  const groupId = Object.fromEntries(keys.map((k) => [k, `$${k}`]));
  const dupes = await Model.aggregate([
    { $group: { _id: groupId, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
  ]);
  if (dupes.length) {
    log(`${label}: ✗ ${dupes.length} duplicate group(s) on ${keys.join('+')}:`);
    for (const d of dupes) {
      log(`    ${JSON.stringify(d._id)} → ${d.ids.length} docs: ${d.ids.join(', ')}`);
    }
    return false;
  }
  return true;
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('[migrate:site] MONGO_URI is not set. Aborting.');
    process.exit(1);
  }

  log(DRY_RUN ? 'DRY RUN — no changes will be written' : 'Applying migration');
  await mongoose.connect(uri);
  log(`connected to ${mongoose.connection.name}`);

  const loaded = TARGETS.map((t) => ({ ...t, Model: require(t.path) }));
  const BlogPost = loaded.find((t) => t.name === 'BlogPost').Model;
  const BlogComment = loaded.find((t) => t.name === 'BlogComment').Model;

  // ── Step 1: backfill `site`
  log('── Step 1: backfill site field');
  for (const t of loaded) {
    if (t.skipSimpleBackfill) continue;
    await backfillSite(t.Model, t.name);
  }
  await backfillCommentSites(BlogComment, BlogPost);

  // ── Step 2: verify the compound uniques are buildable
  log('── Step 2: check for duplicates that would block the new indexes');
  let clean = true;
  clean = (await checkDuplicates(loaded.find((t) => t.name === 'Page').Model, 'Page', ['site', 'slug'])) && clean;
  clean = (await checkDuplicates(BlogPost, 'BlogPost', ['site', 'slug'])) && clean;
  clean =
    (await checkDuplicates(loaded.find((t) => t.name === 'BlogCategory').Model, 'BlogCategory', ['site', 'slug'])) &&
    clean;
  clean = (await checkDuplicates(loaded.find((t) => t.name === 'BlogTag').Model, 'BlogTag', ['site', 'slug'])) && clean;
  clean =
    (await checkDuplicates(loaded.find((t) => t.name === 'Redirect').Model, 'Redirect', ['site', 'source'])) && clean;
  if (!clean) {
    console.error('[migrate:site] Duplicates found — resolve them, then re-run. Nothing else was changed.');
    await mongoose.disconnect();
    process.exit(1);
  }
  log('no duplicates — safe to build compound unique indexes');

  // ── Step 3: drop legacy indexes
  log('── Step 3: drop legacy single-field unique indexes');
  for (const t of loaded) {
    await dropLegacyIndexes(t.Model, t.name, t.legacyIndexes);
  }

  // ── Step 4: build the new indexes from the schemas
  log('── Step 4: sync indexes');
  for (const t of loaded) {
    if (DRY_RUN) {
      log(`${t.name}: WOULD syncIndexes()`);
      continue;
    }
    await t.Model.syncIndexes();
    log(`${t.name}: indexes synced`);
  }

  // ── Step 5: summary
  log('── Summary');
  for (const t of loaded) {
    const total = await t.Model.countDocuments();
    const main = await t.Model.countDocuments({ site: 'main' });
    const seller = await t.Model.countDocuments({ site: 'seller' });
    const unset = await t.Model.countDocuments({ site: { $exists: false } });
    log(`${t.name.padEnd(14)} total=${total}  main=${main}  seller=${seller}  unset=${unset}`);
    if (unset > 0 && !DRY_RUN) {
      console.warn(`[migrate:site] WARNING: ${t.name} still has ${unset} document(s) without a site.`);
    }
  }

  await mongoose.disconnect();
  log(DRY_RUN ? 'dry run complete — nothing written' : 'migration complete');
}

main()
  .then(() => {
    // The Redis client (ioredis) keeps a retry timer alive when the server
    // is unreachable, which leaves the process hanging after the work is
    // done. Everything is committed by this point, so exit explicitly.
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[migrate:site] FAILED:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
