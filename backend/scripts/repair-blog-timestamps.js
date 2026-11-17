/**
 * One-off repair: undo `updatedAt` pollution on blog posts.
 *
 * WHY
 * The storefront bumped `viewCount` with a plain `updateOne`, and
 * Mongoose stamps `updatedAt` on every update by default — so each
 * ARTICLE VIEW looked like a content edit. Every published post drifted
 * to "updated today": the admin list showed one identical date for all
 * posts, and the sitemap advertised a fresh `lastmod` to crawlers on
 * every request.
 *
 * The write paths are fixed (the counters now pass `timestamps: false`,
 * and `BlogPost.contentUpdatedAt` is the explicit display date). Display
 * code already falls back to `publishedAt` when `contentUpdatedAt` is
 * absent, so **running this script is optional** — it exists because the
 * stored `updatedAt` values are still garbage, and anything that sorts
 * or filters on them (the admin list's default sort) stays meaningless
 * until they're reset.
 *
 * WHAT IT DOES
 * For every post with no `contentUpdatedAt` (i.e. never edited since the
 * fix) it rewrites `updatedAt` to the post's own `publishedAt`. Posts
 * that carry a real `contentUpdatedAt` are left alone. The true edit
 * dates were destroyed before this fix and cannot be recovered;
 * `publishedAt` is the correct thing to show for an unedited post.
 *
 * USAGE
 *   node src/utils/repairBlogTimestamps.js            # dry run (default)
 *   node src/utils/repairBlogTimestamps.js --apply    # write changes
 *
 * Writes go through the raw collection to bypass Mongoose's own
 * timestamp handling — otherwise the repair would itself stamp
 * `updatedAt` to now, which is the bug we're undoing.
 */
require('../loadEnv');
const mongoose = require('mongoose');
const BlogPost = require('../src/modules/blog/blog-post.model');
const { env } = require('../src/config/env');

const APPLY = process.argv.includes('--apply');

async function run() {
  const mongoUri = env.MONGO_URI || env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Missing MONGO_URI in .env');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  console.log(APPLY ? 'MODE: apply (writing changes)\n' : 'MODE: dry run — pass --apply to write\n');

  const posts = await BlogPost.find({
    // Never edited since the fix landed, so `updatedAt` carries no
    // information we'd be destroying.
    $or: [{ contentUpdatedAt: null }, { contentUpdatedAt: { $exists: false } }],
    publishedAt: { $ne: null },
  })
    .select('slug site publishedAt updatedAt')
    .lean();

  if (!posts.length) {
    console.log('Nothing to repair.');
    await mongoose.disconnect();
    return;
  }

  const coll = mongoose.connection.collection(BlogPost.collection.name);
  let changed = 0;
  let skipped = 0;

  for (const p of posts) {
    const published = new Date(p.publishedAt);
    const updated = p.updatedAt ? new Date(p.updatedAt) : null;
    // Only touch rows where updatedAt is LATER than publishedAt — those
    // are the drifted ones. An updatedAt at/behind publish time is
    // already consistent.
    if (updated && updated.getTime() <= published.getTime()) {
      skipped += 1;
      continue;
    }
    const days = updated ? Math.round((updated - published) / 86400000) : 0;
    console.log(
      `  ${p.site || 'main'}/${p.slug}\n` +
        `      updatedAt ${updated ? updated.toISOString() : '(none)'} → ${published.toISOString()}  (drifted ~${days}d)`,
    );
    if (APPLY) {
      // Raw driver update — no Mongoose timestamp middleware.
      await coll.updateOne({ _id: p._id }, { $set: { updatedAt: published } });
    }
    changed += 1;
  }

  console.log(`\n${APPLY ? 'Repaired' : 'Would repair'} ${changed} post(s); ${skipped} already consistent.`);
  if (!APPLY && changed > 0) console.log('Re-run with --apply to write these changes.');
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Repair failed:', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
