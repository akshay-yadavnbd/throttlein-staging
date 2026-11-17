/**
 * S3 layout inspector — prints a tree-like view of the bucket so you
 * can verify everything is organised seller-wise after the migration.
 *
 * Sample output:
 *
 *   throttlein/
 *     sellers/
 *       6a290c39942b516839e1dcb9/   (50 objects · 12.3 MB)
 *         products/                  (50)
 *       6a30ed0065994d8b656db126/   (1 object · 145 KB)
 *         kyc/                       (1)
 *     products/                      (0)
 *     brands/                        (3)
 *   ─────────────────────────────────────
 *   Sellers          : 2
 *   Total objects    : 54
 *   Total size       : 13.2 MB
 *
 * Usage
 *   node scripts/inspectS3Layout.js               # summary
 *   node scripts/inspectS3Layout.js --files       # also list every key
 *   node scripts/inspectS3Layout.js --seller=<id> # zoom into one seller
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const upload = require(path.join(__dirname, '..', 'src', 'middleware', 'upload'));
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

const args = process.argv.slice(2);
const SHOW_FILES = args.includes('--files');
const SELLER_ARG = args.find((a) => a.startsWith('--seller='));
const { S3_KEY_PREFIX, toObjectKey, fromObjectKey } = require('../src/utils/s3KeyPrefix');
const SELLER_ID = SELLER_ARG ? SELLER_ARG.split('=')[1] : '';

const BUCKET = process.env.S3_BUCKET_NAME;
const s3 = upload.s3Client;

if (!s3 || !BUCKET) {
  console.error('S3 client is not configured. Aborting.');
  process.exit(1);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function listAll(prefix) {
  const objects = [];
  let ContinuationToken;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        // Scoped to this environment's folder; keys are shown bare.
        Prefix: toObjectKey(prefix || '') || undefined,
        ContinuationToken,
      }),
    );
    for (const o of r.Contents || []) {
      objects.push({ key: fromObjectKey(o.Key), size: o.Size || 0 });
    }
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return objects;
}

(async function main() {
  const prefix = SELLER_ID ? `sellers/${SELLER_ID}/` : '';
  console.log(`Bucket: ${BUCKET}${S3_KEY_PREFIX ? `/${S3_KEY_PREFIX}` : ''}${prefix ? `  (filtered: ${prefix})` : ''}`);

  const objects = await listAll(prefix);
  if (objects.length === 0) {
    console.log('  (empty)');
    return;
  }

  // Bucket the objects by (1) top-level folder and, for sellers/, by
  // seller id, then by the next folder level (products/kyc/etc).
  const tree = {};
  for (const o of objects) {
    const parts = o.key.split('/');
    const top = parts[0]; // e.g. "sellers" or "products"
    const second = parts[1] || '(root)'; // sellerId, or first file name
    const third = parts[2] || '(root)';
    if (!tree[top]) tree[top] = { _total: 0, _size: 0, children: {} };
    tree[top]._total += 1;
    tree[top]._size += o.size;

    if (top === 'sellers') {
      // Group by sellerId → subfolder.
      if (!tree[top].children[second]) {
        tree[top].children[second] = { _total: 0, _size: 0, children: {} };
      }
      tree[top].children[second]._total += 1;
      tree[top].children[second]._size += o.size;
      const sub = parts.length > 2 ? third : '(loose)';
      if (!tree[top].children[second].children[sub]) {
        tree[top].children[second].children[sub] = { _total: 0, _size: 0, keys: [] };
      }
      tree[top].children[second].children[sub]._total += 1;
      tree[top].children[second].children[sub]._size += o.size;
      tree[top].children[second].children[sub].keys.push(o.key);
    } else {
      // Flat prefixes (legacy products/, brands/, …).
      if (!tree[top].children[second]) {
        tree[top].children[second] = { _total: 0, _size: 0, keys: [] };
      }
      tree[top].children[second]._total += 1;
      tree[top].children[second]._size += o.size;
      tree[top].children[second].keys = tree[top].children[second].keys || [];
      tree[top].children[second].keys.push(o.key);
    }
  }

  // ─── Print the tree ─────────────────────────────────────────
  console.log(`\n${BUCKET}/`);
  for (const top of Object.keys(tree).sort()) {
    const node = tree[top];
    console.log(`  ${top}/   (${node._total} objects · ${formatBytes(node._size)})`);

    if (top === 'sellers') {
      for (const sid of Object.keys(node.children).sort()) {
        const s = node.children[sid];
        console.log(`    ${sid}/   (${s._total} · ${formatBytes(s._size)})`);
        for (const sub of Object.keys(s.children).sort()) {
          const x = s.children[sub];
          console.log(`      ${sub}/   (${x._total})`);
          if (SHOW_FILES) {
            for (const k of x.keys.sort()) console.log(`        ${k}`);
          }
        }
      }
    } else {
      // Flat prefix — already grouped by filename (which is noisy);
      // just print the count and optionally the keys.
      const childKeys = Object.keys(node.children);
      console.log(`    (${childKeys.length} unique entries)`);
      if (SHOW_FILES) {
        const allKeys = childKeys.flatMap((c) => node.children[c].keys || []).sort();
        for (const k of allKeys) console.log(`    ${k}`);
      }
    }
  }

  // ─── Summary line ──────────────────────────────────────────
  const totalSellers = tree.sellers ? Object.keys(tree.sellers.children).length : 0;
  const totalObjects = objects.length;
  const totalSize = objects.reduce((a, b) => a + (b.size || 0), 0);
  console.log('─────────────────────────────────────');
  console.log(`Sellers       : ${totalSellers}`);
  console.log(`Total objects : ${totalObjects}`);
  console.log(`Total size    : ${formatBytes(totalSize)}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
