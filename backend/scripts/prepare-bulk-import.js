/**
 * prepare-bulk-import.js
 *
 * One-shot prep for a bulk product import sheet:
 *
 *   1. BRANDS — reads the sheet's `brand` column and creates any brand
 *      that doesn't exist in the admin panel yet (case-insensitive match
 *      on name; slug auto-generates via the Brand pre-save hook). Without
 *      this, importBulk fails those rows with `brand "X" not found`.
 *
 *   2. IMAGES — collects every unique http(s) URL from the `images`
 *      column, downloads each into backend/new-products-images/, and
 *      writes a rewritten copy of the sheet (`*-local.xlsx`) whose
 *      `images` cells reference the downloaded FILENAMES instead of the
 *      remote URLs. Drop those files into the bulk-import photo picker
 *      and the importer matches them by basename — no more hotlinking
 *      Shopify's CDN.
 *
 * Usage (from the backend folder):
 *   node scripts/prepare-bulk-import.js ../products-bulk-import.xlsx
 *   node scripts/prepare-bulk-import.js ../products-bulk-import.xlsx --skip-brands
 *   node scripts/prepare-bulk-import.js ../products-bulk-import.xlsx --skip-images
 *
 * Safe to re-run: brands are matched before insert, and already-downloaded
 * files are skipped, so an interrupted run just resumes.
 */
require('../loadEnv');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const Brand = require('../src/modules/catalog/brand.model');

const SHEET_ARG = process.argv[2];
const SKIP_BRANDS = process.argv.includes('--skip-brands');
const SKIP_IMAGES = process.argv.includes('--skip-images');
const OUT_DIR = path.join(__dirname, '..', 'new-products-images');
const CONCURRENCY = 8;

if (!SHEET_ARG) {
  console.error('Usage: node scripts/prepare-bulk-import.js <path-to-xlsx> [--skip-brands] [--skip-images]');
  process.exit(1);
}
const sheetPath = path.resolve(process.cwd(), SHEET_ARG);
if (!fs.existsSync(sheetPath)) {
  console.error(`Sheet not found: ${sheetPath}`);
  process.exit(1);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Stable local filename for a remote URL: slugified basename + an 8-char
 * hash of the full URL (so two different files that share a basename on
 * the CDN can't collide), original extension preserved.
 */
function localNameFor(url) {
  const clean = url.split('?')[0];
  const base = clean.split('/').pop() || 'image';
  const ext = (base.match(/\.(\w+)$/) || [null, 'jpg'])[1].toLowerCase();
  const stem =
    base
      .replace(/\.\w+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'image';
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
  return `${stem}-${hash}.${ext}`;
}

async function downloadOne(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('empty response');
  fs.writeFileSync(dest, buf);
}

(async () => {
  // ── Load the sheet ──────────────────────────────────────────────────
  const wb = XLSX.read(fs.readFileSync(sheetPath), { type: 'buffer' });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() !== 'instructions') || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
  console.log(`Sheet: ${sheetPath} → "${sheetName}" (${rows.length} rows)`);

  // ── 1. Missing brands → admin panel ─────────────────────────────────
  if (!SKIP_BRANDS) {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    const wanted = [...new Set(rows.map((r) => String(r.brand || '').trim()).filter(Boolean))];
    let created = 0;
    for (const name of wanted) {
      const exists = await Brand.findOne({
        name: new RegExp(`^${escapeRegExp(name)}$`, 'i'),
      });
      if (exists) continue;
      await Brand.create({ name }); // slug auto-generates in pre-save
      created += 1;
      console.log(`  + brand created: ${name}`);
    }
    console.log(`Brands: ${wanted.length} in sheet, ${created} newly created.`);
    await mongoose.disconnect();
  }

  // ── 2. Download images + rewrite sheet ──────────────────────────────
  if (!SKIP_IMAGES) {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // unique URL → local filename
    const urlToName = new Map();
    for (const r of rows) {
      for (const ref of String(r.images || '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (/^https?:\/\//i.test(ref) && !urlToName.has(ref)) {
          urlToName.set(ref, localNameFor(ref));
        }
      }
    }
    const jobs = [...urlToName.entries()];
    console.log(`Images: ${jobs.length} unique URLs → ${OUT_DIR}`);

    let done = 0,
      skipped = 0,
      failed = 0;
    const failures = [];
    let cursor = 0;
    async function worker() {
      while (cursor < jobs.length) {
        const [url, name] = jobs[cursor++];
        const dest = path.join(OUT_DIR, name);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
          skipped++;
          continue;
        }
        try {
          await downloadOne(url, dest);
          done++;
          if (done % 50 === 0) console.log(`  ...${done} downloaded`);
        } catch (e) {
          // one retry, then record and move on — a bad URL shouldn't
          // kill the whole batch
          try {
            await downloadOne(url, dest);
            done++;
          } catch (e2) {
            failed++;
            failures.push(`${url} — ${e2.message}`);
          }
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`Downloads: ${done} new, ${skipped} already present, ${failed} failed.`);
    if (failures.length) {
      const failLog = path.join(OUT_DIR, '_failed-downloads.txt');
      fs.writeFileSync(failLog, failures.join('\n'));
      console.log(`Failed URLs written to ${failLog}`);
    }

    // Rewrite images cells: URL → downloaded filename. Cells that were
    // already filenames (or URLs that failed to download) are left as-is
    // so nothing silently disappears from the sheet.
    for (const r of rows) {
      const refs = String(r.images || '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!refs.length) continue;
      r.images = refs
        .map((ref) => {
          const name = urlToName.get(ref);
          if (!name) return ref;
          const dest = path.join(OUT_DIR, name);
          return fs.existsSync(dest) && fs.statSync(dest).size > 0 ? name : ref;
        })
        .join('|');
    }
    const header = Object.keys(rows[0] || {});
    const outWs = XLSX.utils.json_to_sheet(rows, { header });
    const outWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(outWb, outWs, 'Products');
    const outPath = sheetPath.replace(/\.xlsx$/i, '-local.xlsx');
    XLSX.writeFile(outWb, outPath);
    console.log(`Rewritten sheet (filenames instead of URLs): ${outPath}`);
  }

  console.log('Done.');
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
