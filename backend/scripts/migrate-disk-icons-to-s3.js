/**
 * migrate-disk-icons-to-s3.js
 *
 * Move Category icons that still point at LOCAL DISK paths
 * (`/uploads/<file>.png`) into the S3 bucket, and rewrite the DB value
 * to the bare S3 key — the same format every admin upload stores.
 *
 * WHY
 * The helmet-type icons (helmet-type-full-face.png and friends) were
 * placed straight into backend/uploads/ and their `/uploads/...` paths
 * written into Category.icon, bypassing the S3 upload pipeline. Dev
 * serves them from disk so everything looked fine locally — but
 * backend/uploads/ is gitignored, so production never had the files and
 * the "Types of <X> to sell" tiles rendered broken images
 * (api.throttlein.com/uploads/helmet-type-full-face.png → 404).
 *
 * WHAT IT DOES
 *   1. Finds every Category whose icon starts with `/uploads/`.
 *   2. Uploads the corresponding local file to S3 under `categories/`
 *      (public prefix, 1-year immutable cache — same settings as the
 *      multer-s3 pipeline).
 *   3. Updates Category.icon to the bare S3 key.
 *
 * Skips (with a report line) any record whose file is missing on disk.
 * DRY RUN by default; --apply to execute.
 *
 *   node scripts/migrate-disk-icons-to-s3.js           # report only
 *   node scripts/migrate-disk-icons-to-s3.js --apply   # upload + rewrite
 *
 * Requires S3 env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
 * AWS_REGION / S3_BUCKET_NAME) — refuses to run without it, since
 * rewriting the DB to keys nothing can serve would be strictly worse.
 */
require('../loadEnv');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const Category = require('../src/modules/catalog/category.model');

const APPLY = process.argv.includes('--apply');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function makeKey(filename) {
  const ext = path.extname(filename).toLowerCase();
  const safeBase = path
    .basename(filename, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40);
  const rand = Math.random().toString(36).slice(2, 8);
  // `categories/` — a public prefix covered by the bucket's public-read
  // policy (see the note in upload.js publicFilesBase()).
  return `categories/${Date.now()}-${rand}-${safeBase}${ext}`;
}

async function main() {
  const hasS3 = Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION &&
    process.env.S3_BUCKET_NAME,
  );
  if (!hasS3) {
    console.error(
      'S3 is not configured (AWS_* / S3_BUCKET_NAME missing). ' +
        'Run this where the production S3 credentials are available.',
    );
    process.exit(1);
  }

  const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  const cats = await Category.find({ icon: /^\/uploads\// }).select('name slug icon');
  console.log(`${cats.length} categor${cats.length === 1 ? 'y' : 'ies'} with disk-path icons\n`);

  let migrated = 0;
  let missing = 0;

  for (const cat of cats) {
    const filename = path.basename(cat.icon);
    const localPath = path.join(UPLOAD_DIR, filename);

    if (!fs.existsSync(localPath)) {
      console.log(`  MISSING  ${cat.name} (${cat.slug}) — ${cat.icon} not on disk, skipped`);
      missing += 1;
      continue;
    }

    const key = makeKey(filename);
    console.log(`  ${APPLY ? 'MIGRATE' : 'would migrate'}  ${cat.name} (${cat.slug})`);
    console.log(`           ${cat.icon} → ${key}`);

    if (APPLY) {
      const ext = path.extname(filename).toLowerCase();
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: require('../src/utils/s3KeyPrefix').toObjectKey(key),
          Body: fs.readFileSync(localPath),
          ContentType: CONTENT_TYPES[ext] || 'application/octet-stream',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      // Direct update — Category.icon's setter would keep a bare key
      // as-is, but bypassing the save hooks also avoids the image-
      // cleanup middleware trying to "delete" the old disk path.
      await Category.updateOne({ _id: cat._id }, { $set: { icon: key } });
      migrated += 1;
    }
  }

  console.log(
    `\n${APPLY ? 'Migrated' : 'Would migrate'} ${APPLY ? migrated : cats.length - missing}, ` +
      `missing on disk ${missing}.` +
      (APPLY ? '' : '  Run with --apply to execute.'),
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
