/**
 * Convert EXISTING uploaded images to WebP — report first, convert later.
 *
 * Converts images already stored in S3 (or the local uploads folder) and
 * re-points every database reference at the new .webp file.
 * Needs the `sharp` package (in package.json — run `npm install`).
 *
 * ─── Modes ──────────────────────────────────────────────────────────────
 *
 *   1. REPORT (default) — read-only. Nothing in S3 / disk or MongoDB is
 *      changed. Writes a report of exactly what --apply would do:
 *
 *        node scripts/convertImagesToWebp.js
 *        node scripts/convertImagesToWebp.js --estimate-sizes   # also converts
 *                     # each image IN MEMORY to show real before/after sizes
 *        node scripts/convertImagesToWebp.js --prefix=products/  # limit scope
 *
 *      Output: backend/reports/webp-report-<timestamp>.json  (full detail)
 *              backend/reports/webp-report-<timestamp>.csv   (one row per image)
 *
 *   2. APPLY — converts and updates the database (asks you to type "yes"):
 *
 *        node scripts/convertImagesToWebp.js --apply
 *
 *      For every image in the report:
 *        a. downloads the original, converts it (all formats at
 *           WEBP_QUALITY, default 100),
 *        b. uploads `<same path>.webp` next to it,
 *        c. rewrites every database reference (plain fields, arrays, nested
 *           objects, and URLs inside blog/page HTML) to the new .webp key.
 *      ORIGINALS ARE KEPT, so nothing that still points at them breaks
 *      (cached pages, emails already sent, search engines).
 *      Writes backend/reports/webp-mapping-<timestamp>.json for rollback.
 *
 *   3. ROLLBACK — points the database back at the originals:
 *
 *        node scripts/convertImagesToWebp.js --rollback=reports/webp-mapping-<ts>.json
 *
 *   4. DELETE ORIGINALS — only once you're happy (e.g. a week later):
 *
 *        node scripts/convertImagesToWebp.js --delete-originals
 *
 *      Deletes an original only if its .webp copy exists AND nothing in the
 *      database references the original any more. Run without --yes first to
 *      see the list.
 *
 *   Add --force with --apply to re-convert images whose .webp already exists
 *   (e.g. after changing WEBP_QUALITY) — the old .webp is overwritten.
 *
 *   Add --yes to skip the typed confirmation (CI only).
 *
 * ─── What's included / skipped ─────────────────────────────────────────
 *   Included: EVERY raster image type except SVG — PNG, JPG/JPEG/JPE/JFIF/
 *             PJPEG, GIF, AVIF, TIFF, BMP, HEIC/HEIF, ICO — that the database
 *             actually references (orphans are ignored — see
 *             cleanupOrphanedS3Objects). A format this `sharp` build can't
 *             decode (BMP, ICO, most HEIC) is listed with an error in the
 *             report and left unchanged by --apply; nothing breaks.
 *   Skipped:  private uploads (KYC, return evidence), anything already WebP,
 *             SVG (vector — WebP would rasterise it), PDF/video, and external
 *             URLs (other sites' images).
 *
 *   Static images in frontend/public (called directly from the frontend
 *   code) are handled by the sister script convertStaticImagesToWebp.js.
 *   Not rewritten: PrivateUpload and AdminAuditLog collections (private /
 *             historical records).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const mongoose = require('mongoose');
const {
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const upload = require(path.join(__dirname, '..', 'src', 'middleware', 'upload'));
// ─── Conversion settings (self-contained) ───────────────────────────────
//   ALL raster formats (see IMAGE_EXTS) → WebP at WEBP_QUALITY, default 100
//   (WebP's highest lossy setting). GIF animation is kept.
//   Set WEBP_LOSSLESS_ALL=true to use lossless WebP instead (pixel-identical,
//   larger files). Colour profile is kept and EXIF orientation applied.
let sharp = null;
try {
  sharp = require('sharp');
  sharp.cache(false);
} catch {
  /* checked before converting */
}

function webpQuality() {
  const q = Number(process.env.WEBP_QUALITY);
  return Number.isFinite(q) && q >= 1 && q <= 100 ? Math.round(q) : 100;
}

function createWebpTransformer(ext) {
  // GIF and (animated) WebP/AVIF sequences keep their frames.
  const animated = ext === '.gif';
  const lossless = String(process.env.WEBP_LOSSLESS_ALL || '').toLowerCase() === 'true';
  let pipeline = sharp({ animated });
  if (!animated) pipeline = pipeline.rotate();
  pipeline = pipeline.keepIccProfile();
  return pipeline.webp(
    lossless
      ? // `exact` keeps RGB under fully transparent pixels → bit-for-bit identical.
        { lossless: true, exact: true, effort: 4 }
      : { quality: webpQuality(), alphaQuality: 100, smartSubsample: true, effort: 4 },
  );
}

/** Same name, `.webp` extension. */
function toWebpName(name) {
  const ext = path.extname(name || '');
  return `${ext ? name.slice(0, -ext.length) : name || 'image'}.webp`;
}

// ─── CLI ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : '';
};
const MODE = opt('rollback')
  ? 'rollback'
  : flag('delete-originals')
    ? 'delete-originals'
    : flag('apply')
      ? 'apply'
      : 'report';
const AUTO_YES = flag('yes');
const ESTIMATE = flag('estimate-sizes');
// --force: re-convert even when a .webp from an earlier run already exists
// (e.g. after changing the quality setting). Overwrites that .webp.
const FORCE = flag('force');
const SCOPE = opt('prefix');
const CONCURRENCY = Math.max(1, Number(opt('concurrency')) || 4);

const REPORT_DIR = path.join(__dirname, '..', 'reports');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

// Every raster image extension except SVG (vector) and WebP (the target).
const IMAGE_EXTS = 'png|jpe?g|jpe|jfif|pjpeg|pjp|gif|avif|tiff?|bmp|heic|heif|ico';
const CONVERTIBLE_EXT = new RegExp(`\\.(?:${IMAGE_EXTS})$`, 'i');
const PRIVATE_KEY = /(^|\/)(kyc|return-evidence|evidence)(\/|$)/i;
const SKIP_COLLECTIONS = new Set(['privateuploads', 'adminauditlogs']);

// ─── Storage adapter (S3 in production, local disk in dev) ─────────────
const BUCKET = process.env.S3_BUCKET_NAME;
const s3 = upload.s3Client;
const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');

async function streamToBuffer(body) {
  const chunks = [];
  for await (const c of body) chunks.push(c);
  return Buffer.concat(chunks);
}

const storage = s3
  ? {
      kind: `S3 bucket "${BUCKET}"`,
      async list() {
        const out = new Map(); // key -> size
        let ContinuationToken;
        do {
          const res = await s3.send(
            new ListObjectsV2Command({ Bucket: BUCKET, Prefix: SCOPE || undefined, ContinuationToken }),
          );
          for (const o of res.Contents || []) out.set(o.Key, o.Size || 0);
          ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (ContinuationToken);
        return out;
      },
      async get(key) {
        const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        return streamToBuffer(res.Body);
      },
      async put(key, buf) {
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: buf,
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
      },
      async exists(key) {
        try {
          await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
          return true;
        } catch {
          return false;
        }
      },
      async size(key) {
        try {
          return (await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))).ContentLength || null;
        } catch {
          return null;
        }
      },
      async remove(key) {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      },
    }
  : {
      kind: `local disk (${UPLOAD_DIR})`,
      async list() {
        const out = new Map();
        if (!fs.existsSync(UPLOAD_DIR)) return out;
        for (const name of fs.readdirSync(UPLOAD_DIR)) {
          const p = path.join(UPLOAD_DIR, name);
          const st = fs.statSync(p);
          const key = `/uploads/${name}`;
          if (st.isFile() && (!SCOPE || key.startsWith(SCOPE))) out.set(key, st.size);
        }
        return out;
      },
      fp: (key) => path.join(UPLOAD_DIR, path.basename(key)),
      async get(key) {
        return fs.promises.readFile(this.fp(key));
      },
      async put(key, buf) {
        await fs.promises.writeFile(this.fp(key), buf);
      },
      async exists(key) {
        return fs.existsSync(this.fp(key));
      },
      async size(key) {
        try {
          return fs.statSync(this.fp(key)).size;
        } catch {
          return null;
        }
      },
      async remove(key) {
        await fs.promises.unlink(this.fp(key));
      },
    };

// ─── Finding image references inside any stored string ─────────────────
// A "token" is a run of URL-ish characters ending in an image extension:
//   products/123-abc-foo.png
//   /api/files/products/123-abc-foo.png
//   https://bucket.s3.region.amazonaws.com/products/123-abc-foo.png
//   /uploads/uuid-foo.jpg
//   …and the same inside <img src="…"> in blog / page HTML.
// .webp is included so --rollback can find the converted references too;
// only keys present in the map / storage set are ever touched.
const TOKEN_RE = new RegExp(`[^\\s"'()<>,?#\\\\]+\\.(?:${IMAGE_EXTS}|webp)(?![A-Za-z0-9])`, 'gi');

/** Map a token to the storage key it points at (or null). */
function tokenToKey(token) {
  let t = token;
  if (t.startsWith('/uploads/')) return t;
  t = t.replace(/^https?:\/\/[^/]+\//i, ''); // strip any origin
  t = t.replace(/^\/+/, '');
  if (t.startsWith('uploads/')) return `/${t}`; // disk mode, absolute URL
  t = t.replace(/^api\/files\//, '');
  return t || null;
}

const webpKeyFor = (key) => toWebpName(key);

/** Walk any BSON value, calling fn(string, path) for every string. */
function walkStrings(value, fn, p = '') {
  if (typeof value === 'string') return fn(value, p);
  if (Array.isArray(value)) return value.forEach((v, i) => walkStrings(v, fn, `${p}[${i}]`));
  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value) &&
    value._bsontype === undefined
  ) {
    for (const [k, v] of Object.entries(value)) walkStrings(v, fn, p ? `${p}.${k}` : k);
  }
}

/** Return a deep copy of `value` with every mapped key replaced; `changed` counts edits. */
function rewrite(value, map, stats) {
  if (typeof value === 'string') {
    return value.replace(TOKEN_RE, (token) => {
      const key = tokenToKey(token);
      if (!key || !map.has(key)) return token;
      stats.changed++;
      return token.slice(0, token.length - key.length) + map.get(key);
    });
  }
  if (Array.isArray(value)) return value.map((v) => rewrite(v, map, stats));
  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value) &&
    value._bsontype === undefined
  ) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, map, stats);
    return out;
  }
  return value;
}

async function collections() {
  const db = mongoose.connection.db;
  const list = await db.listCollections().toArray();
  return list
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.') && !SKIP_COLLECTIONS.has(n.toLowerCase()))
    .sort();
}

/** Scan the whole database: key -> [{ collection, id, field }] */
async function scanReferences(storedKeys) {
  const refs = new Map();
  const db = mongoose.connection.db;
  for (const name of await collections()) {
    const cursor = db.collection(name).find({});
    for await (const doc of cursor) {
      walkStrings(doc, (s, field) => {
        const m = s.match(TOKEN_RE);
        if (!m) return;
        for (const token of m) {
          const key = tokenToKey(token);
          if (!key || !storedKeys.has(key)) continue;
          if (!refs.has(key)) refs.set(key, []);
          refs.get(key).push({ collection: name, id: String(doc._id), field });
        }
      });
    }
  }
  return refs;
}

async function convert(buf, key) {
  const ext = path.extname(key).toLowerCase();
  const t = createWebpTransformer(ext);
  t.end(buf);
  return t.toBuffer();
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx], idx);
      }
    }),
  );
}

async function confirm(question) {
  if (AUTO_YES) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(`${question} Type "yes" to continue: `, r));
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Build the plan (shared by report and apply). */
async function buildPlan() {
  console.log(`Storage: ${storage.kind}${SCOPE ? `  (prefix "${SCOPE}")` : ''}`);
  console.log('Listing stored files…');
  const all = await storage.list();
  const candidates = new Map([...all].filter(([k]) => CONVERTIBLE_EXT.test(k) && !PRIVATE_KEY.test(k)));
  console.log(
    `  ${all.size} files total, ${candidates.size} convertible public images (all raster types except SVG/WebP).`,
  );

  console.log('Scanning the database for references…');
  const refs = await scanReferences(candidates);

  const items = [...refs.keys()].sort().map((key) => ({
    key,
    newKey: webpKeyFor(key),
    format: path.extname(key).slice(1).toLowerCase(),
    mode:
      String(process.env.WEBP_LOSSLESS_ALL || '').toLowerCase() === 'true' ? 'lossless' : `quality ${webpQuality()}`,
    originalBytes: candidates.get(key),
    webpBytes: null,
    webpAlreadyExists: all.has(webpKeyFor(key)),
    existingWebpBytes: all.get(webpKeyFor(key)) || null,
    references: refs.get(key),
  }));
  const unreferenced = candidates.size - items.length;
  return { items, unreferenced, totalFiles: all.size, candidates: candidates.size };
}

// ─── Modes ──────────────────────────────────────────────────────────────
async function runReport() {
  const plan = await buildPlan();
  const { items } = plan;

  if (ESTIMATE && items.length) {
    console.log(`Estimating sizes (converting ${items.length} images in memory, nothing is saved)…`);
    let done = 0;
    await pool(items, CONCURRENCY, async (it) => {
      try {
        it.webpBytes = (await convert(await storage.get(it.key), it.key)).length;
      } catch (e) {
        it.error = e.message;
      }
      if (++done % 25 === 0) console.log(`  ${done}/${items.length}`);
    });
  }

  // Per-collection / per-field summary of what the DB rewrite would touch.
  const byCollection = {};
  const docs = new Set();
  for (const it of items) {
    for (const r of it.references) {
      const c = (byCollection[r.collection] ||= { documents: new Set(), references: 0, fields: {} });
      c.documents.add(r.id);
      c.references++;
      const fieldName = r.field.replace(/\[\d+\]/g, '[]');
      c.fields[fieldName] = (c.fields[fieldName] || 0) + 1;
      docs.add(`${r.collection}:${r.id}`);
    }
  }
  const collectionsSummary = Object.fromEntries(
    Object.entries(byCollection).map(([k, v]) => [
      k,
      { documents: v.documents.size, references: v.references, fields: v.fields },
    ]),
  );

  const byFormat = {};
  for (const it of items) {
    const f = (byFormat[it.format] ||= { images: 0, originalBytes: 0, webpBytes: 0 });
    f.images++;
    f.originalBytes += it.originalBytes || 0;
    f.webpBytes += it.webpBytes || 0;
  }
  const totalOrig = items.reduce((a, it) => a + (it.originalBytes || 0), 0);
  const totalWebp = items.reduce((a, it) => a + (it.webpBytes || 0), 0);

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: 'REPORT ONLY — nothing was changed',
    storage: storage.kind,
    prefix: SCOPE || '(all)',
    filesInStorage: plan.totalFiles,
    convertibleImagesInStorage: plan.candidates,
    imagesToConvert: items.length,
    skippedUnreferencedImages: plan.unreferenced,
    webpCopyAlreadyExists: items.filter((i) => i.webpAlreadyExists).length,
    databaseDocumentsToUpdate: docs.size,
    databaseReferencesToRewrite: items.reduce((a, it) => a + it.references.length, 0),
    byFormat,
    byCollection: collectionsSummary,
    sizes: ESTIMATE
      ? {
          originalTotal: kb(totalOrig),
          webpTotal: kb(totalWebp),
          saved: kb(totalOrig - totalWebp),
          savedPercent: totalOrig ? `${(100 - (totalWebp / totalOrig) * 100).toFixed(1)}%` : '0%',
          failedToConvert: items.filter((i) => i.error).length,
        }
      : 'run with --estimate-sizes to see real before/after sizes',
    originalsDeleted: 'NO — originals are kept by --apply',
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, `webp-report-${STAMP}.json`);
  const csvPath = path.join(REPORT_DIR, `webp-report-${STAMP}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify({ summary, images: items }, null, 2));
  const rows = [
    [
      'current file',
      'new file',
      'format',
      'conversion',
      'current size',
      'webp size',
      'webp already exists',
      'db references',
      'used in',
      'error',
    ]
      .map(csvCell)
      .join(','),
  ];
  for (const it of items) {
    const usedIn = [...new Set(it.references.map((r) => `${r.collection}.${r.field.replace(/\[\d+\]/g, '[]')}`))].join(
      '; ',
    );
    rows.push(
      [
        it.key,
        it.newKey,
        it.format,
        it.mode,
        kb(it.originalBytes || 0),
        it.webpBytes == null ? '' : kb(it.webpBytes),
        it.webpAlreadyExists ? 'yes' : 'no',
        it.references.length,
        usedIn,
        it.error || '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  fs.writeFileSync(csvPath, rows.join('\n'));

  console.log('\n══════════ WebP conversion report (nothing changed) ══════════');
  console.log(`Images to convert:            ${summary.imagesToConvert}`);
  for (const [f, v] of Object.entries(byFormat)) {
    console.log(
      `  ${f.padEnd(5)} ${String(v.images).padStart(5)} images  ${kb(v.originalBytes)}${ESTIMATE ? ` → ${kb(v.webpBytes)}` : ''}`,
    );
  }
  console.log(`Skipped (not used anywhere):  ${summary.skippedUnreferencedImages}`);
  console.log(
    `DB documents to update:       ${summary.databaseDocumentsToUpdate}  (${summary.databaseReferencesToRewrite} references)`,
  );
  for (const [c, v] of Object.entries(collectionsSummary)) {
    console.log(`  ${c.padEnd(22)} ${String(v.documents).padStart(5)} docs  → ${Object.keys(v.fields).join(', ')}`);
  }
  if (ESTIMATE)
    console.log(
      `Size: ${summary.sizes.originalTotal} → ${summary.sizes.webpTotal}  (saves ${summary.sizes.saved}, ${summary.sizes.savedPercent})`,
    );
  console.log(`\nFull report:  ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`Spreadsheet:  ${path.relative(process.cwd(), csvPath)}`);
  console.log('To perform this conversion:  node scripts/convertImagesToWebp.js --apply');
}

async function rewriteDatabase(map) {
  const db = mongoose.connection.db;
  let docsUpdated = 0,
    refs = 0;
  for (const name of await collections()) {
    const col = db.collection(name);
    for await (const doc of col.find({})) {
      const set = {};
      for (const [field, value] of Object.entries(doc)) {
        if (field === '_id') continue;
        const stats = { changed: 0 };
        const next = rewrite(value, map, stats);
        if (stats.changed) {
          set[field] = next;
          refs += stats.changed;
        }
      }
      if (!Object.keys(set).length) continue;
      try {
        await col.updateOne({ _id: doc._id }, { $set: set });
        docsUpdated++;
      } catch (e) {
        // e.g. Media's unique `key` index when a row for the .webp key
        // already exists — keep the original row rather than fail the run.
        console.warn(`  ! ${name} ${doc._id}: ${e.message}`);
      }
    }
  }
  return { docsUpdated, refs };
}

async function runApply() {
  const { items } = await buildPlan();
  if (!items.length) return console.log('Nothing to convert.');
  console.log(`\nAbout to convert ${items.length} images to WebP and update the database. Originals are kept.`);
  if (!(await confirm('Proceed?'))) return console.log('Aborted — nothing changed.');

  const map = new Map(); // old key -> new key (only successfully converted)
  const results = [];
  let done = 0;
  await pool(items, CONCURRENCY, async (it) => {
    try {
      if (FORCE || !(await storage.exists(it.newKey))) {
        const webp = await convert(await storage.get(it.key), it.key);
        await storage.put(it.newKey, webp);
        it.webpBytes = webp.length;
      } else {
        // Re-using a .webp made by an earlier run — record its real size.
        // (Ask storage directly: with --prefix the .webp isn't in the listing.)
        it.webpBytes = it.existingWebpBytes || (await storage.size(it.newKey));
      }
      map.set(it.key, it.newKey);
      results.push({ key: it.key, newKey: it.newKey, originalBytes: it.originalBytes, webpBytes: it.webpBytes });
    } catch (e) {
      it.failed = e.message;
      console.warn(`  ! ${it.key}: ${e.message}  (left unchanged)`);
    }
    if (++done % 25 === 0) console.log(`  converted ${done}/${items.length}`);
  });

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const mapPath = path.join(REPORT_DIR, `webp-mapping-${STAMP}.json`);
  fs.writeFileSync(
    mapPath,
    JSON.stringify({ createdAt: new Date().toISOString(), storage: storage.kind, items: results }, null, 2),
  );

  console.log('Updating database references…');
  const { docsUpdated, refs } = await rewriteDatabase(map);

  // Keep the Media library rows accurate (type + size).
  const Media = mongoose.connection.db.collection('media');
  for (const r of results) {
    await Media.updateOne(
      { key: r.newKey },
      { $set: { mimeType: 'image/webp', ...(r.webpBytes ? { size: r.webpBytes } : {}) } },
    ).catch(() => {});
  }

  const failed = items.filter((i) => i.failed).length;
  if (failed)
    console.log(`\n${failed} image(s) could not be converted and were left unchanged — see the "!" lines above.`);
  console.log(
    `\nDone. ${map.size}/${items.length} images converted, ${docsUpdated} documents updated (${refs} references).`,
  );
  console.log(`Rollback file: ${path.relative(process.cwd(), mapPath)}`);
  console.log(
    'Originals were kept. Flush the Redis cache / restart the backend so cached API responses pick up the new URLs.',
  );
}

async function runRollback() {
  const file = path.resolve(process.cwd(), opt('rollback'));
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = new Map(data.items.map((i) => [i.newKey, i.key]));
  console.log(`Rolling back ${map.size} images (database will point at the originals again).`);
  if (!(await confirm('Proceed?'))) return console.log('Aborted — nothing changed.');
  const { docsUpdated, refs } = await rewriteDatabase(map);
  // Restore the Media library rows' type / size as well.
  const MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.jpe': 'image/jpeg',
    '.jfif': 'image/jpeg',
    '.pjpeg': 'image/jpeg',
    '.pjp': 'image/jpeg',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.bmp': 'image/bmp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.ico': 'image/x-icon',
  };
  const Media = mongoose.connection.db.collection('media');
  for (const i of data.items) {
    const mimeType = MIME[path.extname(i.key).toLowerCase()];
    if (mimeType) {
      await Media.updateOne(
        { key: i.key },
        { $set: { mimeType, ...(i.originalBytes ? { size: i.originalBytes } : {}) } },
      ).catch(() => {});
    }
  }
  console.log(`Done. ${docsUpdated} documents updated (${refs} references). The .webp files were left in storage.`);
}

async function runDeleteOriginals() {
  const all = await storage.list();
  const originals = [...all.keys()].filter(
    (k) => CONVERTIBLE_EXT.test(k) && !PRIVATE_KEY.test(k) && all.has(webpKeyFor(k)),
  );
  const stillUsed = await scanReferences(new Set(originals));
  const deletable = originals.filter((k) => !stillUsed.has(k));
  console.log(
    `${originals.length} originals have a .webp copy; ${stillUsed.size} are still referenced (kept); ${deletable.length} can be deleted.`,
  );
  deletable.slice(0, 50).forEach((k) => console.log(`  - ${k}`));
  if (deletable.length > 50) console.log(`  … and ${deletable.length - 50} more`);
  if (!deletable.length) return;
  if (!(await confirm(`Permanently delete these ${deletable.length} original files?`)))
    return console.log('Aborted — nothing deleted.');
  let n = 0;
  await pool(deletable, CONCURRENCY, async (k) => {
    try {
      await storage.remove(k);
      n++;
    } catch (e) {
      console.warn(`  ! ${k}: ${e.message}`);
    }
  });
  console.log(`Deleted ${n} originals.`);
}

(async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set in backend/.env');
    // Converting needs `sharp`. Stop up front instead of skipping every image.
    if (MODE === 'apply' || ESTIMATE) {
      try {
        require('sharp');
      } catch {
        throw new Error('`sharp` is not installed. Run `npm install` in the backend folder, then try again.');
      }
    }
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log(`MongoDB: ${mongoose.connection.name}  |  mode: ${MODE.toUpperCase()}`);
    if (MODE === 'report') await runReport();
    else if (MODE === 'apply') await runApply();
    else if (MODE === 'rollback') await runRollback();
    else await runDeleteOriginals();
  } catch (e) {
    console.error('Failed:', e.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
})();
