/**
 * Orphan-cleanup script — finds every S3 object that NO database
 * record references, and (optionally) deletes them.
 *
 * Why this exists
 *   Deleting a record from MongoDB doesn't automatically remove the
 *   matching S3 objects unless the controller wires up the cleanup.
 *   Some legacy paths (seeded data, direct DB deletes, partial cascade
 *   failures) leave behind orphan objects. This script reconciles the
 *   two stores.
 *
 * Usage
 *   # Show what would be deleted — no S3 writes:
 *   node scripts/cleanupOrphanedS3Objects.js --dry-run
 *
 *   # Delete for real (will prompt for confirmation):
 *   node scripts/cleanupOrphanedS3Objects.js
 *
 *   # Restrict to a single S3 prefix (e.g. products only):
 *   node scripts/cleanupOrphanedS3Objects.js --prefix=products/ --dry-run
 *
 *   # Skip the interactive confirmation (CI / cron):
 *   node scripts/cleanupOrphanedS3Objects.js --yes
 *
 * What's considered "referenced"
 *   Pulls keys from every image-bearing field across all models:
 *     - Product.images[], Product.ogImage
 *     - Brand.logo, Brand.ogImage
 *     - BlogPost.featuredImage, BlogPost.ogImage
 *       + inline images parsed out of BlogPost.body
 *     - BlogAuthor.avatarUrl
 *     - Category.icon
 *     - Page.ogImage + inline body images + Page.body
 *     - HomeBanner.image, HomeBanner.imageMobile
 *     - TrendingProduct.image
 *     - User.avatar, User.kyc.gstCertificate, User.kyc.panCard,
 *       User.kyc.bankDetails.cancelledCheque
 *     - Order.items[].image (product snapshot at purchase time)
 *
 * Safety
 *   - Dry-run by default in spirit: deletes only happen after a typed
 *     "yes" confirmation OR the --yes flag.
 *   - Never deletes anything outside the bucket's S3 keys — does not
 *     touch local /uploads/, data URIs, or external CDN URLs even if
 *     they appear in the referenced set.
 *   - Logs everything to stdout so you can grep the output for keys
 *     before allowing the delete pass.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const path = require('path');
const readline = require('readline');

const upload = require(path.join(__dirname, '..', 'src', 'middleware', 'upload'));
const { ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const Product = require(path.join(__dirname, '..', 'src', 'models', 'Product'));
const Brand = require(path.join(__dirname, '..', 'src', 'models', 'Brand'));
const BlogPost = require(path.join(__dirname, '..', 'src', 'models', 'BlogPost'));
const BlogAuthor = require(path.join(__dirname, '..', 'src', 'models', 'BlogAuthor'));
const Category = require(path.join(__dirname, '..', 'src', 'models', 'Category'));
const Page = require(path.join(__dirname, '..', 'src', 'models', 'Page'));
const HomeBanner = require(path.join(__dirname, '..', 'src', 'models', 'HomeBanner'));
// (TrendingProduct model was removed from the codebase — reference dropped.)
const User = require(path.join(__dirname, '..', 'src', 'models', 'User'));
const Order = require(path.join(__dirname, '..', 'src', 'models', 'Order'));

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const AUTO_YES = args.includes('--yes');
const PREFIX_ARG = args.find((a) => a.startsWith('--prefix='));
// Environment folder inside the shared bucket (S3_KEY_PREFIX). Listing is
// scoped to it and every listed key is compared to DB references with the
// folder stripped, so a staging run can never see — let alone delete —
// production objects.
const { S3_KEY_PREFIX, toObjectKey, fromObjectKey } = require('../src/utils/s3KeyPrefix');
const SCOPE_PREFIX = PREFIX_ARG ? PREFIX_ARG.split('=')[1] : '';

const BUCKET = process.env.S3_BUCKET_NAME;
const s3 = upload.s3Client;

if (!s3 || !BUCKET) {
  console.error('S3 client is not configured. Aborting.');
  process.exit(1);
}

/**
 * Same key-extraction logic as the migrate script — accepts bare keys,
 * /api/files proxy URLs, and full S3 URLs. Returns null for anything
 * that isn't a key in our bucket (so we don't accidentally treat
 * external image URLs as referenced keys we need to keep).
 */
function toS3Key(stored) {
  if (!stored || typeof stored !== 'string') return null;
  if (stored.startsWith('data:')) return null;
  if (stored.startsWith('/uploads/')) return null;
  // Bare key — common case post-refactor.
  if (/^[a-z]/i.test(stored) && !stored.startsWith('http') && !stored.startsWith('/')) {
    return stored;
  }
  const proxyMatch = stored.match(/\/api\/files\/(.+)$/);
  if (proxyMatch) return decodeURIComponent(proxyMatch[1]);
  if (/^https?:\/\//i.test(stored) && stored.includes(BUCKET)) {
    try {
      const url = new URL(stored);
      return fromObjectKey(decodeURIComponent(url.pathname.replace(/^\//, '')));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Pull S3 keys out of a chunk of HTML produced by the rich-text editor.
 * The editor writes either `<img src="/api/files/<key>">` (the proxy
 * path) or `<img src="https://.../bucket/<key>">` (direct S3). Both
 * shapes get extracted here so inline embeds aren't reaped as orphans.
 */
function extractKeysFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const out = [];
  // /api/files/<key>
  const proxyRe = /\/api\/files\/([^"'\s>]+)/g;
  let m;
  while ((m = proxyRe.exec(html)) !== null) {
    out.push(decodeURIComponent(m[1]));
  }
  // Full S3 URL containing the bucket name.
  const s3Re = new RegExp(`https?:[^"'\\s>]*${BUCKET}[^"'\\s>]*`, 'g');
  while ((m = s3Re.exec(html)) !== null) {
    const k = toS3Key(m[0]);
    if (k) out.push(k);
  }
  return out;
}

function addKey(set, raw) {
  const k = toS3Key(raw);
  if (k) set.add(k);
}

async function buildReferencedKeys() {
  const refs = new Set();

  // ─── Products ─────────────────────────────────────────────────
  const products = await Product.find({}, 'images ogImage description').lean();
  for (const p of products) {
    for (const img of p.images || []) addKey(refs, img);
    addKey(refs, p.ogImage);
    extractKeysFromHtml(p.description).forEach((k) => refs.add(k));
  }
  console.log(`  · products       : ${products.length}`);

  // ─── Brands ───────────────────────────────────────────────────
  const brands = await Brand.find({}, 'logo ogImage').lean();
  for (const b of brands) {
    addKey(refs, b.logo);
    addKey(refs, b.ogImage);
  }
  console.log(`  · brands         : ${brands.length}`);

  // ─── Blog posts ──────────────────────────────────────────────
  const posts = await BlogPost.find({}, 'featuredImage ogImage body keyTakeaways').lean();
  for (const post of posts) {
    addKey(refs, post.featuredImage);
    addKey(refs, post.ogImage);
    extractKeysFromHtml(post.body).forEach((k) => refs.add(k));
    extractKeysFromHtml(post.keyTakeaways).forEach((k) => refs.add(k));
  }
  console.log(`  · blog posts     : ${posts.length}`);

  // ─── Blog authors ────────────────────────────────────────────
  const authors = await BlogAuthor.find({}, 'avatarUrl').lean();
  for (const a of authors) addKey(refs, a.avatarUrl);
  console.log(`  · blog authors   : ${authors.length}`);

  // ─── Categories ──────────────────────────────────────────────
  const cats = await Category.find({}, 'icon').lean();
  for (const c of cats) addKey(refs, c.icon);
  console.log(`  · categories     : ${cats.length}`);

  // ─── Pages (prose / dynamic) ─────────────────────────────────
  const pages = await Page.find({}, 'ogImage body').lean();
  for (const pg of pages) {
    addKey(refs, pg.ogImage);
    extractKeysFromHtml(pg.body).forEach((k) => refs.add(k));
  }
  console.log(`  · pages          : ${pages.length}`);

  // ─── Home banners + trending ─────────────────────────────────
  const banners = await HomeBanner.find({}, 'image imageMobile').lean();
  for (const b of banners) {
    addKey(refs, b.image);
    addKey(refs, b.imageMobile);
  }
  console.log(`  · home banners   : ${banners.length}`);

  // ─── Users (avatars + KYC) ───────────────────────────────────
  const users = await User.find(
    {},
    'avatar kyc.gstCertificate kyc.panCard kyc.bankDetails.cancelledCheque kycRevision',
  ).lean();
  for (const u of users) {
    addKey(refs, u.avatar);
    if (u.kycRevision) {
      addKey(refs, u.kycRevision.gstCertificate);
      addKey(refs, u.kycRevision.panCard);
      addKey(refs, u.kycRevision.bankDetails?.cancelledCheque);
    }
    if (u.kyc) {
      addKey(refs, u.kyc.gstCertificate);
      addKey(refs, u.kyc.panCard);
      if (u.kyc.bankDetails) addKey(refs, u.kyc.bankDetails.cancelledCheque);
    }
  }
  console.log(`  · users (KYC)    : ${users.length}`);

  // ─── Orders (product snapshot images) ────────────────────────
  const orders = await Order.find({}, 'items.image').lean();
  for (const o of orders) {
    for (const item of o.items || []) addKey(refs, item.image);
  }
  console.log(`  · orders         : ${orders.length}`);

  return refs;
}

async function listAllKeys(prefix = '') {
  const keys = [];
  let ContinuationToken;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: toObjectKey(prefix || '') || undefined,
        ContinuationToken,
      }),
    );
    for (const obj of r.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

async function deleteBatch(keys) {
  // S3 caps DeleteObjects at 1000 per call.
  for (let i = 0; i < keys.length; i += 1000) {
    const slice = keys.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: slice.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

(async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  console.log(
    `Connected. Bucket=${BUCKET}${S3_KEY_PREFIX ? `/${S3_KEY_PREFIX}` : ''}  ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'}${SCOPE_PREFIX ? `  prefix="${SCOPE_PREFIX}"` : ''}`,
  );

  console.log('\nCollecting referenced S3 keys from DB:');
  const referenced = await buildReferencedKeys();
  console.log(`Total referenced keys: ${referenced.size}\n`);

  console.log(`Listing S3 objects${SCOPE_PREFIX ? ` under "${SCOPE_PREFIX}"` : ''}…`);
  const allKeys = await listAllKeys(SCOPE_PREFIX);
  console.log(`Total objects in bucket: ${allKeys.length}\n`);

  // Listed keys carry the environment folder; DB references do not.
  const orphans = allKeys.filter((k) => !referenced.has(fromObjectKey(k)));
  console.log(`Orphans found: ${orphans.length}`);

  if (orphans.length === 0) {
    console.log('Nothing to delete. Bucket is clean.');
    await mongoose.disconnect();
    return;
  }

  // Print the first 50 keys so the operator can spot-check; full list
  // is only printed when there are 50 or fewer (avoids spamming the
  // terminal with thousands of lines on the first run).
  const preview = orphans.slice(0, 50);
  console.log(`\nFirst ${preview.length}:`);
  for (const k of preview) console.log(`  ${k}`);
  if (orphans.length > preview.length) {
    console.log(`  … ${orphans.length - preview.length} more`);
  }

  if (DRY_RUN) {
    console.log('\nDry run — no objects deleted. Re-run without --dry-run to clean up.');
    await mongoose.disconnect();
    return;
  }

  if (!AUTO_YES) {
    const answer = await prompt(`\nDelete ${orphans.length} orphan object(s)? [yes/N] `);
    if (answer !== 'yes' && answer !== 'y') {
      console.log('Aborted by user.');
      await mongoose.disconnect();
      return;
    }
  }

  console.log(`\nDeleting ${orphans.length} object(s)…`);
  try {
    await deleteBatch(orphans);
    console.log('Done.');
  } catch (err) {
    console.error('Delete failed:', err.message);
    process.exitCode = 1;
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
