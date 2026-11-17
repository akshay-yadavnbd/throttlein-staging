/**
 * Convert STATIC frontend images (frontend/public) to WebP — report first,
 * convert later. Sister script of convertImagesToWebp.js (which handles
 * uploaded images in S3 / backend/uploads).
 *
 * "Static" = files in frontend/public that the code calls by path, e.g.
 *   <img src="/images/figma/promo-mobile-1.jpg">
 *   bg-[url('/about/hero-banner.jpg')]
 *   `/images/figma-sell/sell-${i + 1}.png`          (template paths too)
 * plus the same paths stored in MongoDB (promo blocks, seller CTA, CMS HTML).
 *
 * ─── Modes ──────────────────────────────────────────────────────────────
 *
 *   1. REPORT (default) — read-only. Nothing on disk or in MongoDB changes:
 *
 *        node scripts/convertStaticImagesToWebp.js
 *        node scripts/convertStaticImagesToWebp.js --estimate-sizes
 *        node scripts/convertStaticImagesToWebp.js --prefix=/images/figma/
 *
 *      Output: backend/reports/static-webp-report-<ts>.json / .csv
 *
 *   2. APPLY — asks you to type "yes":
 *
 *        node scripts/convertStaticImagesToWebp.js --apply
 *
 *        a. writes `<same name>.webp` next to every image in frontend/public,
 *        b. rewrites the paths in the frontend / admin code and in the
 *           backend's seed + model defaults,
 *        c. rewrites the same paths stored in MongoDB (skip with --skip-db).
 *      ORIGINALS ARE KEPT. Writes backend/reports/static-webp-mapping-<ts>.json.
 *      Commit the code changes with the new .webp files.
 *
 *   3. ROLLBACK — points code + database back at the originals:
 *
 *        node scripts/convertStaticImagesToWebp.js --rollback=reports/static-webp-mapping-<ts>.json
 *
 *   4. DELETE ORIGINALS — only once you're happy (e.g. a week after deploy):
 *
 *        node scripts/convertStaticImagesToWebp.js --delete-originals
 *
 *      Deletes an original only if its .webp exists AND nothing references
 *      it any more — no code file anywhere in the repo (emails and SEO files
 *      included), no file in public/, no template path, no database string.
 *
 *   --force       with --apply: re-convert even if the .webp already exists
 *   --skip-db     with --apply / --rollback: leave MongoDB alone
 *   --yes         skip the typed confirmation (CI only)
 *
 * ─── What's converted ─────────────────────────────────────────────────
 *   Every raster image in frontend/public — PNG, JPG/JPEG, GIF, AVIF, TIFF,
 *   BMP, HEIC/HEIF, ICO … — EXCEPT SVG (vector; WebP would rasterise it)
 *   and files that are already WebP. Formats this `sharp` build can't
 *   decode are reported with an error and left alone.
 *
 * ─── Where paths are NOT rewritten (image stays PNG/JPG there) ──────────
 *   - Favicons / app icons / OG + Twitter share-image generators
 *   - app/layout.tsx  — Open Graph / Twitter share image (WhatsApp, LinkedIn
 *     and some crawlers don't show WebP previews)
 *   - Structured data (lib/jsonLd.ts, lib/structuredData.ts, the CMS page
 *     route) — the logo / image Google reads
 *   - backend/src/controllers etc. — email templates (Outlook doesn't
 *     render WebP). Only backend/src/models and backend/src/utils are
 *     rewritten (seed data + schema defaults).
 *   Those references keep working because originals are kept, and they
 *   protect their originals from --delete-originals.
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let sharp = null;
try {
  sharp = require('sharp');
  sharp.cache(false);
} catch {
  /* checked before converting */
}
let mongoose = null;
try {
  mongoose = require('mongoose');
} catch {
  /* DB step is optional */
}

// ─── Paths ──────────────────────────────────────────────────────────────
const REPO = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(REPO, 'frontend', 'public');
const REPORT_DIR = path.join(__dirname, '..', 'reports');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');

// Code whose image paths ARE rewritten.
const REWRITE_DIRS = [
  'frontend/app',
  'frontend/components',
  'frontend/lib',
  'admin/app',
  'admin/components',
  'admin/lib',
  'admin/src',
  'backend/src/models',
  'backend/src/utils',
].map((d) => path.join(REPO, d));

// Inside those dirs, files whose references stay on the original image.
const KEEP_FILE_RE = new RegExp(
  [
    '^frontend/app/layout\\.tsx$', // OG / Twitter image
    '(^|/)(opengraph-image|twitter-image|icon|apple-icon)[^/]*$', // share-image / icon generators
    '^frontend/lib/(jsonLd|structuredData)\\.ts$', // structured data for Google
    '^frontend/app/\\(storefront\\)/page/\\[slug\\]/page\\.tsx$', // CMS page JSON-LD logo
  ].join('|'),
);

// Everything scanned (read-only) before deleting an original.
const SCAN_ALL_DIRS = ['frontend', 'admin', 'backend/src', 'backend/scripts'].map((d) => path.join(REPO, d));
const SKIP_DIR_NAMES = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage', 'reports', 'uploads']);
const CODE_EXT = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|json|md|mdx|html?|xml|txt|webmanifest|ya?ml)$/i;

// ─── Image types ───────────────────────────────────────────────────────
const IMAGE_EXTS = 'png|jpe?g|jpe|jfif|pjpeg|pjp|gif|avif|tiff?|bmp|heic|heif|ico';
const CONVERTIBLE_EXT = new RegExp(`\\.(?:${IMAGE_EXTS})$`, 'i');
const ICON_NAME = /^(favicon|apple-touch-icon|android-chrome|mstile|safari-pinned-tab|icon|apple-icon)([-.]|$)/i;

// A path token: optional origin + "/a/b/c.ext". The lookbehind stops
// "frontend/public/images/x.png" (a disk path) from matching "/images/x.png".
const PATH_RE = new RegExp(
  `(?<![A-Za-z0-9_\\-.%/:@])(https?://[A-Za-z0-9.\\-:]+)?(/[A-Za-z0-9_\\-./%@+~]+\\.(?:${IMAGE_EXTS}|webp))(?![A-Za-z0-9])`,
  'gi',
);
// A template-literal path: "/images/sell-${i + 1}.png"
const DYNAMIC_RE = new RegExp(
  `(?<![A-Za-z0-9_\\-.%/:@])(/[A-Za-z0-9_\\-./]*\\$\\{[^}\`]+\\}[A-Za-z0-9_\\-./]*(?:\\$\\{[^}\`]+\\}[A-Za-z0-9_\\-./]*)*\\.(?:${IMAGE_EXTS}|webp))(?![A-Za-z0-9])`,
  'gi',
);

// Hosts that serve frontend/public. Absolute URLs on any other host
// (S3, CDNs, YouTube thumbnails…) are never touched.
const SITE_HOSTS = new Set(
  [
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SELLER_URL,
    process.env.NEXT_PUBLIC_SELLER_URL,
    'https://throttlein.com',
    'https://www.throttlein.com',
    'https://seller.throttlein.com',
    'http://localhost:3000',
  ]
    .filter(Boolean)
    .map((u) => {
      try {
        return new URL(u).host.toLowerCase();
      } catch {
        return '';
      }
    })
    .filter(Boolean),
);

// ─── CLI ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : '';
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
const FORCE = flag('force');
const SKIP_DB = flag('skip-db');
const SCOPE = opt('prefix');
const CONCURRENCY = Math.max(1, Number(opt('concurrency')) || 4);
const SKIP_COLLECTIONS = new Set(['privateuploads', 'adminauditlogs']);

// ─── Conversion (same settings as convertImagesToWebp.js) ───────────────
function webpQuality() {
  const q = Number(process.env.WEBP_QUALITY);
  return Number.isFinite(q) && q >= 1 && q <= 100 ? Math.round(q) : 100;
}
const LOSSLESS = String(process.env.WEBP_LOSSLESS_ALL || '').toLowerCase() === 'true';

async function convert(file) {
  const animated = /\.gif$/i.test(file);
  let p = sharp(file, { animated });
  if (!animated) p = p.rotate();
  return p
    .keepIccProfile()
    .webp(
      LOSSLESS
        ? { lossless: true, exact: true, effort: 4 }
        : { quality: webpQuality(), alphaQuality: 100, smartSubsample: true, effort: 4 },
    )
    .toBuffer();
}

// ─── Helpers ────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const urlPathOf = (file) => `/${path.relative(PUBLIC_DIR, file).split(path.sep).join('/')}`;
const fileOf = (urlPath) => path.join(PUBLIC_DIR, ...decodeURI(urlPath).split('/').filter(Boolean));
const swapExt = (p, ext) => `${p.slice(0, p.length - path.extname(p).length)}${ext}`;
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  const a = await new Promise((r) => rl.question(`${question} Type "yes" to continue: `, r));
  rl.close();
  return a.trim().toLowerCase() === 'yes';
}

/** Is this matched token one we may touch? (relative, or one of our hosts) */
const ownHost = (origin) => !origin || SITE_HOSTS.has(new URL(origin).host.toLowerCase());

/** Replace every path token found in `map` (oldPath → newPath). */
function rewriteText(text, map, stats) {
  return text.replace(PATH_RE, (m, origin, p) => {
    if (!map.has(p) || !ownHost(origin)) return m;
    stats.changed++;
    return `${origin || ''}${map.get(p)}`;
  });
}

/** Template-literal paths: rewrite the extension when EVERY public file the
 *  pattern can match was converted by a plain extension swap. */
function dynamicMatches(pattern, allPublicPaths) {
  const re = new RegExp(
    `^${pattern
      .split(/\$\{[^}]+\}/)
      .map(escRe)
      .join('[^/]+')}$`,
    'i',
  );
  return allPublicPaths.filter((p) => re.test(p));
}

// ─── Plan ───────────────────────────────────────────────────────────────
function buildPlan() {
  const files = walk(PUBLIC_DIR);
  const allPublicPaths = files.map(urlPathOf);
  const existing = new Set(allPublicPaths.map((p) => p.toLowerCase()));

  const images = files
    .filter((f) => CONVERTIBLE_EXT.test(f))
    .map((f) => ({ file: f, path: urlPathOf(f) }))
    .filter((i) => !SCOPE || i.path.startsWith(SCOPE))
    .sort((a, b) => a.path.localeCompare(b.path));

  // Target names. "cta-bg.png" and "cta-bg.jpg" in the same folder can't
  // both become "cta-bg.webp" — the second gets "cta-bg-jpg.webp".
  const taken = new Map(); // lowercased target → source path
  for (const img of images) {
    let target = swapExt(img.path, '.webp');
    if (taken.has(target.toLowerCase())) {
      target = swapExt(img.path, `-${path.extname(img.path).slice(1).toLowerCase()}.webp`);
    }
    taken.set(target.toLowerCase(), img.path);
    img.newPath = target;
    img.plainSwap = target === swapExt(img.path, '.webp');
    img.icon = ICON_NAME.test(path.basename(img.path));
    img.bytes = fs.statSync(img.file).size;
    img.webpExists = existing.has(target.toLowerCase());
    img.refs = []; // code refs that will be rewritten
    img.keptRefs = []; // code refs left on the original (keep-list / emails)
    img.dbRefs = [];
  }
  // Icons stay as they are (browsers / OS expect .ico/.png names).
  const items = images.filter((i) => !i.icon);
  return { items, icons: images.filter((i) => i.icon), allPublicPaths };
}

/** Find references in code: which files would change, which are kept. */
function scanCode(items, allPublicPaths) {
  const byPath = new Map(items.map((i) => [i.path, i]));
  const rewriteFiles = new Set(
    REWRITE_DIRS.flatMap((d) => walk(d)).filter((f) => CODE_EXT.test(f) && !KEEP_FILE_RE.test(rel(f))),
  );
  const dynamic = [];
  for (const f of SCAN_ALL_DIRS.flatMap((d) => walk(d))) {
    if (!CODE_EXT.test(f) || (f.startsWith(PUBLIC_DIR + path.sep) && !/\.(json|webmanifest|xml|txt|html?)$/i.test(f)))
      continue;
    if (path.resolve(f) === path.resolve(__filename)) continue;
    const text = fs.readFileSync(f, 'utf8');
    const willRewrite = rewriteFiles.has(f);
    let m;
    PATH_RE.lastIndex = 0;
    while ((m = PATH_RE.exec(text))) {
      const it = byPath.get(m[2]);
      if (!it || !ownHost(m[1])) continue;
      const line = text.slice(0, m.index).split('\n').length;
      (willRewrite ? it.refs : it.keptRefs).push(`${rel(f)}:${line}`);
    }
    DYNAMIC_RE.lastIndex = 0;
    while ((m = DYNAMIC_RE.exec(text))) {
      const pattern = m[1];
      const matched = dynamicMatches(pattern, allPublicPaths);
      const convertible = matched.length > 0 && matched.every((p) => byPath.get(p)?.plainSwap);
      dynamic.push({
        file: rel(f),
        line: text.slice(0, m.index).split('\n').length,
        pattern,
        matches: matched,
        willRewrite: willRewrite && convertible && !/\.webp$/i.test(pattern),
        absFile: f,
      });
    }
  }
  return { rewriteFiles, dynamic };
}

/** Scan MongoDB strings for public paths (relative, or on our own hosts). */
async function scanDb(items, apply) {
  if (SKIP_DB || !mongoose || !process.env.MONGO_URI) return { skipped: true };
  const map = new Map(items.map((i) => [i.path, i]));
  const db = mongoose.connection.db;
  const names = (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.') && !SKIP_COLLECTIONS.has(n.toLowerCase()));
  let docsUpdated = 0,
    refs = 0;
  const pathMap = new Map(items.map((i) => [i.path, i.newPath]));
  for (const name of names) {
    const col = db.collection(name);
    for await (const doc of col.find({})) {
      const set = {};
      for (const [field, value] of Object.entries(doc)) {
        if (field === '_id') continue;
        const stats = { changed: 0 };
        const next = deepMap(value, (s) => {
          PATH_RE.lastIndex = 0;
          let m;
          while ((m = PATH_RE.exec(s))) {
            const it = map.get(m[2]);
            if (it && ownHost(m[1])) it.dbRefs.push(`${name}:${doc._id}.${field}`);
          }
          return apply ? rewriteText(s, pathMap, stats) : s;
        });
        if (stats.changed) {
          set[field] = next;
          refs += stats.changed;
        }
      }
      if (apply && Object.keys(set).length) {
        try {
          await col.updateOne({ _id: doc._id }, { $set: set });
          docsUpdated++;
        } catch (e) {
          console.warn(`  ! ${name} ${doc._id}: ${e.message}`);
        }
      }
    }
  }
  return { skipped: false, docsUpdated, refs };
}

function deepMap(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => deepMap(x, fn));
  if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) && v._bsontype === undefined) {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = deepMap(x, fn);
    return o;
  }
  return v;
}

async function connectDb() {
  if (SKIP_DB) return console.log('Database: skipped (--skip-db)');
  if (!mongoose || !process.env.MONGO_URI)
    return console.log('Database: MONGO_URI not set — skipping the database step.');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`Database: ${mongoose.connection.name}`);
}

/** Rewrite code files. Returns [{ file, from, to, count }] for rollback. */
function rewriteCode(items, scan, map) {
  const edits = [];
  const byFile = new Map();
  for (const d of scan.dynamic.filter((x) => x.willRewrite)) {
    if (!byFile.has(d.absFile)) byFile.set(d.absFile, []);
    byFile.get(d.absFile).push(d);
  }
  for (const f of scan.rewriteFiles) {
    const before = fs.readFileSync(f, 'utf8');
    const stats = { changed: 0 };
    let after = rewriteText(before, map, stats);
    for (const d of byFile.get(f) || []) {
      const to = swapExt(d.pattern, '.webp');
      const n = after.split(d.pattern).length - 1;
      if (n) {
        after = after.split(d.pattern).join(to);
        stats.changed += n;
        edits.push({ file: rel(f), from: d.pattern, to, count: n });
      }
    }
    if (after !== before) {
      fs.writeFileSync(f, after);
      edits.push({ file: rel(f), count: stats.changed, paths: true });
    }
  }
  return edits;
}

// ─── Modes ──────────────────────────────────────────────────────────────
async function runReport() {
  const { items, icons, allPublicPaths } = buildPlan();
  console.log(
    `frontend/public: ${items.length} images to convert${icons.length ? `, ${icons.length} icons left as-is` : ''}.`,
  );
  const scan = scanCode(items, allPublicPaths);
  await connectDb();
  const db = await scanDb(items, false);

  if (ESTIMATE && items.length) {
    if (!sharp) throw new Error('`sharp` is not installed. Run `npm install` in the backend folder.');
    console.log(`Estimating sizes (converting ${items.length} images in memory)…`);
    await pool(items, CONCURRENCY, async (it) => {
      try {
        it.webpBytes = (await convert(it.file)).length;
      } catch (e) {
        it.error = e.message;
      }
    });
  }

  const totalOrig = items.reduce((a, i) => a + i.bytes, 0);
  const totalWebp = items.reduce((a, i) => a + (i.webpBytes || 0), 0);
  const summary = {
    generatedAt: new Date().toISOString(),
    mode: 'REPORT ONLY — nothing was changed',
    imagesToConvert: items.length,
    iconsLeftAsIs: icons.map((i) => i.path),
    renamedToAvoidClash: items.filter((i) => !i.plainSwap).map((i) => `${i.path} → ${i.newPath}`),
    codeFilesToChange: new Set(items.flatMap((i) => i.refs.map((r) => r.split(':')[0]))).size,
    codeReferencesToRewrite: items.reduce((a, i) => a + i.refs.length, 0),
    codeReferencesKeptOnOriginal: items.reduce((a, i) => a + i.keptRefs.length, 0),
    templatePaths: scan.dynamic.map(({ absFile: _abs, ...d }) => d),
    unreferencedImages: items.filter((i) => !i.refs.length && !i.keptRefs.length && !i.dbRefs.length).length,
    database: db.skipped ? 'skipped' : { referencesToRewrite: items.reduce((a, i) => a + i.dbRefs.length, 0) },
    sizes: ESTIMATE
      ? {
          original: kb(totalOrig),
          webp: kb(totalWebp),
          saved: kb(totalOrig - totalWebp),
          savedPercent: totalOrig ? `${(100 - (totalWebp / totalOrig) * 100).toFixed(1)}%` : '0%',
          failed: items.filter((i) => i.error).length,
        }
      : 'run with --estimate-sizes to see real before/after sizes',
    originalsDeleted: 'NO — originals are kept by --apply',
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, `static-webp-report-${STAMP}.json`);
  const csvPath = path.join(REPORT_DIR, `static-webp-report-${STAMP}.csv`);
  const images = items.map(({ file: _file, ...i }) => i);
  fs.writeFileSync(jsonPath, JSON.stringify({ summary, images }, null, 2));
  const rows = [
    ['current file', 'new file', 'size', 'webp size', 'code refs (rewritten)', 'code refs (kept)', 'db refs', 'error']
      .map(csvCell)
      .join(','),
  ];
  for (const i of items) {
    rows.push(
      [
        i.path,
        i.newPath,
        kb(i.bytes),
        i.webpBytes == null ? '' : kb(i.webpBytes),
        i.refs.join(' | '),
        i.keptRefs.join(' | '),
        i.dbRefs.length,
        i.error || '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  fs.writeFileSync(csvPath, rows.join('\n'));

  console.log('\n══════ Static image WebP report (nothing changed) ══════');
  console.log(`Images to convert:              ${summary.imagesToConvert}`);
  console.log(
    `Code files to change:           ${summary.codeFilesToChange}  (${summary.codeReferencesToRewrite} references)`,
  );
  console.log(`References kept on original:    ${summary.codeReferencesKeptOnOriginal}  (share images, SEO, emails)`);
  console.log(
    `Template paths found:           ${scan.dynamic.length}  (${scan.dynamic.filter((d) => d.willRewrite).length} will be rewritten)`,
  );
  if (!db.skipped) console.log(`Database references to rewrite: ${summary.database.referencesToRewrite}`);
  if (summary.renamedToAvoidClash.length)
    console.log(`Renamed to avoid a name clash:  ${summary.renamedToAvoidClash.join(', ')}`);
  if (ESTIMATE)
    console.log(
      `Size: ${summary.sizes.original} → ${summary.sizes.webp}  (saves ${summary.sizes.saved}, ${summary.sizes.savedPercent})`,
    );
  console.log(`\nFull report:  ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`Spreadsheet:  ${path.relative(process.cwd(), csvPath)}`);
  console.log('To perform this conversion:  node scripts/convertStaticImagesToWebp.js --apply');
}

async function runApply() {
  if (!sharp) throw new Error('`sharp` is not installed. Run `npm install` in the backend folder.');
  const { items, allPublicPaths } = buildPlan();
  if (!items.length) return console.log('Nothing to convert.');
  console.log(
    `About to convert ${items.length} images in frontend/public to WebP and update code${SKIP_DB ? '' : ' + database'} references. Originals are kept.`,
  );
  if (!(await confirm('Proceed?'))) return console.log('Aborted — nothing changed.');

  const converted = [];
  let done = 0;
  await pool(items, CONCURRENCY, async (it) => {
    try {
      const out = fileOf(it.newPath);
      if (FORCE || !fs.existsSync(out)) {
        const buf = await convert(it.file);
        fs.writeFileSync(out, buf);
        it.webpBytes = buf.length;
      } else {
        it.webpBytes = fs.statSync(out).size;
      }
      converted.push(it);
    } catch (e) {
      it.failed = e.message;
      console.warn(`  ! ${it.path}: ${e.message}  (left unchanged)`);
    }
    if (++done % 25 === 0) console.log(`  converted ${done}/${items.length}`);
  });

  // Only successfully converted images get their references rewritten.
  const ok = converted;
  const map = new Map(ok.map((i) => [i.path, i.newPath]));
  const scan = scanCode(ok, allPublicPaths);
  // A template path is rewritten only if every file it can match converted.
  for (const d of scan.dynamic) d.willRewrite = d.willRewrite && d.matches.every((p) => map.has(p));
  console.log('Updating code references…');
  const edits = rewriteCode(ok, scan, map);

  await connectDb();
  const db = await scanDb(ok, true);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const mapPath = path.join(REPORT_DIR, `static-webp-mapping-${STAMP}.json`);
  fs.writeFileSync(
    mapPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        items: ok.map((i) => ({ path: i.path, newPath: i.newPath, originalBytes: i.bytes, webpBytes: i.webpBytes })),
        codeEdits: edits,
        database: !db.skipped,
      },
      null,
      2,
    ),
  );

  const failed = items.length - ok.length;
  const files = new Set(edits.map((e) => e.file));
  console.log(
    `\nDone. ${ok.length}/${items.length} images converted${failed ? ` (${failed} failed — see "!" lines)` : ''}.`,
  );
  console.log(
    `Code: ${files.size} files updated.${db.skipped ? '' : `  Database: ${db.docsUpdated} documents (${db.refs} references).`}`,
  );
  const before = ok.reduce((a, i) => a + i.bytes, 0);
  const after = ok.reduce((a, i) => a + (i.webpBytes || 0), 0);
  console.log(`Size: ${kb(before)} → ${kb(after)}`);
  console.log(`Rollback file: ${path.relative(process.cwd(), mapPath)}`);
  console.log('Originals were kept. Commit the new .webp files with the code changes, then redeploy the frontend.');
  if (!db.skipped)
    console.log('Flush the Redis cache / restart the backend so cached API responses pick up the new paths.');
}

async function runRollback() {
  const data = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), opt('rollback')), 'utf8'));
  const back = new Map(data.items.map((i) => [i.newPath, i.path]));
  console.log(
    `Rolling back ${back.size} images (code${data.database && !SKIP_DB ? ' + database' : ''} will point at the originals again).`,
  );
  if (!(await confirm('Proceed?'))) return console.log('Aborted — nothing changed.');

  let filesChanged = 0;
  const files = new Set((data.codeEdits || []).map((e) => e.file));
  for (const f of files) {
    const abs = path.join(REPO, f);
    if (!fs.existsSync(abs)) continue;
    const before = fs.readFileSync(abs, 'utf8');
    let after = rewriteText(before, back, { changed: 0 });
    for (const e of (data.codeEdits || []).filter((x) => x.file === f && x.from)) {
      after = after.split(e.to).join(e.from);
    }
    if (after !== before) {
      fs.writeFileSync(abs, after);
      filesChanged++;
    }
  }
  let dbMsg = '';
  if (data.database && !SKIP_DB) {
    await connectDb();
    const fake = [...back].map(([newPath, p]) => ({ path: newPath, newPath: p, dbRefs: [] }));
    const db = await scanDb(fake, true);
    if (!db.skipped) dbMsg = `  Database: ${db.docsUpdated} documents (${db.refs} references).`;
  }
  console.log(`Done. ${filesChanged} code files restored.${dbMsg} The .webp files were left in frontend/public.`);
}

async function runDeleteOriginals() {
  const files = walk(PUBLIC_DIR);
  const all = new Set(files.map(urlPathOf));
  const originals = files
    .map(urlPathOf)
    .filter(
      (p) =>
        CONVERTIBLE_EXT.test(p) &&
        !ICON_NAME.test(path.basename(p)) &&
        (all.has(swapExt(p, '.webp')) || all.has(swapExt(p, `-${path.extname(p).slice(1).toLowerCase()}.webp`))),
    );
  const items = originals.map((p) => ({ path: p, newPath: '', plainSwap: true, refs: [], keptRefs: [], dbRefs: [] }));
  const scan = scanCode(items, [...all]);
  await connectDb();
  await scanDb(items, false);
  // Template paths that still point at original extensions protect what they match.
  const dynProtected = new Set(scan.dynamic.filter((d) => !/\.webp$/i.test(d.pattern)).flatMap((d) => d.matches));
  const deletable = items.filter(
    (i) => !i.refs.length && !i.keptRefs.length && !i.dbRefs.length && !dynProtected.has(i.path),
  );
  console.log(
    `${items.length} originals have a .webp copy; ${items.length - deletable.length} are still referenced (kept); ${deletable.length} can be deleted.`,
  );
  deletable.slice(0, 50).forEach((i) => console.log(`  - ${i.path}`));
  if (deletable.length > 50) console.log(`  … and ${deletable.length - 50} more`);
  if (!deletable.length) return;
  if (!(await confirm(`Permanently delete these ${deletable.length} files from frontend/public?`)))
    return console.log('Aborted — nothing deleted.');
  for (const i of deletable) {
    try {
      fs.unlinkSync(fileOf(i.path));
    } catch (e) {
      console.warn(`  ! ${i.path}: ${e.message}`);
    }
  }
  console.log(`Deleted ${deletable.length} originals. Commit the deletions.`);
}

async function main() {
  try {
    if (!fs.existsSync(PUBLIC_DIR)) throw new Error(`frontend/public not found at ${PUBLIC_DIR}`);
    console.log(`Mode: ${MODE.toUpperCase()}  |  public: ${rel(PUBLIC_DIR)}${SCOPE ? `  (prefix "${SCOPE}")` : ''}`);
    if (MODE === 'report') await runReport();
    else if (MODE === 'apply') await runApply();
    else if (MODE === 'rollback') await runRollback();
    else await runDeleteOriginals();
  } catch (e) {
    console.error('Failed:', e.message);
    process.exitCode = 1;
  } finally {
    if (mongoose && mongoose.connection.readyState) await mongoose.disconnect().catch(() => {});
  }
}

if (require.main === module) main();

module.exports = { PATH_RE, DYNAMIC_RE, rewriteText, dynamicMatches, KEEP_FILE_RE };
