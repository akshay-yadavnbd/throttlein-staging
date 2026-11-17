/**
 * Quick listing of everything under the top-level `products/` S3
 * folder + a best-effort label for what each file is referenced by.
 *
 * After the seller-folder migration this prefix should hold only
 * admin-uploaded assets — brand logos, category icons, home banners,
 * blog featured images, blog inline images, blog author avatars,
 * prose-page OG images. Anything seller-owned should live under
 * `sellers/<slug>/...` now.
 *
 * Usage
 *   node scripts/listProductsFolder.js
 *
 * Output
 *   <key>  <size>  ← Brand: <name>          (when matched to a record)
 *   <key>  <size>  ← Blog featured: <title>
 *   <key>  <size>  ← (unreferenced — candidate for cleanup)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const path = require('path');

const upload = require(path.join(__dirname, '..', 'src', 'middleware', 'upload'));
const Brand = require(path.join(__dirname, '..', 'src', 'models', 'Brand'));
const Category = require(path.join(__dirname, '..', 'src', 'models', 'Category'));
const HomeBanner = require(path.join(__dirname, '..', 'src', 'models', 'HomeBanner'));
// (TrendingProduct model was removed from the codebase — reference dropped.)
const BlogPost = require(path.join(__dirname, '..', 'src', 'models', 'BlogPost'));
const BlogAuthor = require(path.join(__dirname, '..', 'src', 'models', 'BlogAuthor'));
const Page = require(path.join(__dirname, '..', 'src', 'models', 'Page'));
const Product = require(path.join(__dirname, '..', 'src', 'models', 'Product'));
const User = require(path.join(__dirname, '..', 'src', 'models', 'User'));
const { toObjectKey, fromObjectKey } = require('../src/utils/s3KeyPrefix');
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

const BUCKET = process.env.S3_BUCKET_NAME;
const s3 = upload.s3Client;
if (!s3 || !BUCKET) {
  console.error('S3 not configured.');
  process.exit(1);
}

function toS3Key(s) {
  if (!s || typeof s !== 'string') return null;
  if (s.startsWith('data:') || s.startsWith('/uploads/')) return null;
  if (/^[a-z]/i.test(s) && !s.startsWith('http') && !s.startsWith('/')) return s;
  const m = s.match(/\/api\/files\/(.+)$/);
  if (m) return decodeURIComponent(m[1]);
  if (/^https?:\/\//i.test(s) && s.includes(BUCKET)) {
    try {
      return fromObjectKey(decodeURIComponent(new URL(s).pathname.replace(/^\//, '')));
    } catch {
      return null;
    }
  }
  return null;
}

function extractInlineKeys(html) {
  if (!html) return [];
  const out = [];
  for (const m of html.matchAll(/\/api\/files\/([^"'\s>]+)/g)) {
    out.push(decodeURIComponent(m[1]));
  }
  return out;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

async function listProductsFolder() {
  const out = [];
  let ContinuationToken;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: toObjectKey('products/'),
        ContinuationToken,
      }),
    );
    for (const o of r.Contents || []) {
      if (o.Key) out.push({ key: fromObjectKey(o.Key), size: o.Size || 0 });
    }
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out;
}

(async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri);

  // Build a per-key reverse map so we can label what each file is for.
  const labels = new Map();
  const tag = (key, label) => {
    if (key) labels.set(key, label);
  };

  for (const b of await Brand.find({}, 'name logo ogImage').lean()) {
    tag(toS3Key(b.logo), `Brand logo: ${b.name}`);
    tag(toS3Key(b.ogImage), `Brand OG: ${b.name}`);
  }
  for (const c of await Category.find({}, 'name icon').lean()) {
    tag(toS3Key(c.icon), `Category icon: ${c.name}`);
  }
  for (const b of await HomeBanner.find({}, 'alt image imageMobile').lean()) {
    tag(toS3Key(b.image), `Home banner: ${b.alt || '(no alt)'}`);
    tag(toS3Key(b.imageMobile), `Home banner mobile: ${b.alt || '(no alt)'}`);
  }
  for (const p of await BlogPost.find({}, 'title featuredImage ogImage body keyTakeaways').lean()) {
    tag(toS3Key(p.featuredImage), `Blog featured: ${p.title}`);
    tag(toS3Key(p.ogImage), `Blog OG: ${p.title}`);
    for (const k of extractInlineKeys(p.body)) tag(k, `Blog inline (${p.title})`);
    for (const k of extractInlineKeys(p.keyTakeaways)) tag(k, `Blog takeaway img (${p.title})`);
  }
  for (const a of await BlogAuthor.find({}, 'name avatarUrl').lean()) {
    tag(toS3Key(a.avatarUrl), `Blog author avatar: ${a.name}`);
  }
  for (const pg of await Page.find({}, 'title ogImage body').lean()) {
    tag(toS3Key(pg.ogImage), `Page OG: ${pg.title}`);
    for (const k of extractInlineKeys(pg.body)) tag(k, `Page inline (${pg.title})`);
  }
  // Just in case any Product still references a `products/...` key
  // (shouldn't after the seller-folder migration, but be safe).
  for (const p of await Product.find({}, 'name images ogImage description').lean()) {
    for (const img of p.images || []) tag(toS3Key(img), `Product: ${p.name}`);
    tag(toS3Key(p.ogImage), `Product OG: ${p.name}`);
    for (const k of extractInlineKeys(p.description)) tag(k, `Product description img (${p.name})`);
  }
  for (const u of await User.find(
    {},
    'name slug avatar kyc.gstCertificate kyc.panCard kyc.bankDetails.cancelledCheque',
  ).lean()) {
    tag(toS3Key(u.avatar), `User avatar: ${u.name || u.slug}`);
    if (u.kyc) {
      tag(toS3Key(u.kyc.gstCertificate), `KYC GST: ${u.name || u.slug}`);
      tag(toS3Key(u.kyc.panCard), `KYC PAN: ${u.name || u.slug}`);
      tag(toS3Key(u.kyc.bankDetails?.cancelledCheque), `KYC cheque: ${u.name || u.slug}`);
    }
  }

  const objects = await listProductsFolder();
  if (objects.length === 0) {
    console.log('products/ is empty.');
    await mongoose.disconnect();
    return;
  }

  console.log(`products/  (${objects.length} objects)\n`);
  let totalSize = 0;
  let unreferenced = 0;
  for (const o of objects.sort((a, b) => a.key.localeCompare(b.key))) {
    const label = labels.get(o.key) || '(unreferenced — candidate for cleanup)';
    if (!labels.has(o.key)) unreferenced += 1;
    totalSize += o.size;
    console.log(`  ${o.key}`);
    console.log(`    ${formatBytes(o.size).padStart(8)}  ← ${label}`);
  }
  console.log('\n────────────────────────────');
  console.log(`Total objects   : ${objects.length}`);
  console.log(`Total size      : ${formatBytes(totalSize)}`);
  console.log(`Unreferenced    : ${unreferenced}`);
  console.log('────────────────────────────');

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
