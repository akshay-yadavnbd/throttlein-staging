/**
 * import-for-seller.js
 *
 * Runs the bulk product import ON BEHALF OF a seller, from the command
 * line — no portal login needed. Goes through the real HTTP endpoint
 * (POST /api/products/import) so every rule applies exactly as if the
 * seller ran it from the dashboard: category/brand/bike resolution,
 * variant parsing, S3 uploads, SKU-based upsert, and the "no images →
 * saved as draft" gate.
 *
 * Prerequisites:
 *   1. Backend running locally (this script talks to it over HTTP).
 *   2. scripts/prepare-bulk-import.js already ran, so
 *      backend/new-products-images/ holds the photos and the
 *      *-local.xlsx sheet references them by filename.
 *
 * Usage (from the backend folder):
 *   node scripts/import-for-seller.js revvgearz@gmail.com ../products-bulk-import-local.xlsx
 *
 * Options:
 *   --api=http://localhost:5000/api   override API base
 *   --dir=path/to/images              override image folder
 *   --rows=100                        rows per request (chunking)
 *
 * Chunking is BY ROW, and each request carries exactly the image files
 * its rows reference — so a product's photos always travel in the same
 * request as its row and basename matching can't miss.
 */
require('../loadEnv');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
const User = require('../src/models/User');

const email = process.argv[2];
const sheetArg = process.argv[3];
const opt = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const API = opt('api', `http://localhost:${process.env.PORT || 5000}/api`);
const IMG_DIR = path.resolve(__dirname, '..', opt('dir', 'new-products-images'));
const ROWS_PER_REQ = Number(opt('rows', 100)) || 100;

if (!email || !sheetArg) {
  console.error('Usage: node scripts/import-for-seller.js <seller-email> <path-to-xlsx> [--rows=100]');
  process.exit(1);
}
const sheetPath = path.resolve(process.cwd(), sheetArg);
if (!fs.existsSync(sheetPath)) {
  console.error(`Sheet not found: ${sheetPath}`);
  process.exit(1);
}

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

(async () => {
  // ── Seller lookup + token ───────────────────────────────────────────
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const seller = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (!seller) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }
  if (seller.role !== 'seller' && seller.role !== 'superadmin') {
    console.error(`${email} has role "${seller.role}" — needs seller/superadmin.`);
    process.exit(1);
  }
  if (seller.status !== 'approved' || seller.kyc?.status !== 'approved') {
    console.error(
      `Seller isn't fully approved (status=${seller.status}, kyc=${seller.kyc?.status}) — the import endpoint will refuse.`,
    );
    process.exit(1);
  }
  const token = jwt.sign(
    { id: seller._id.toString(), role: seller.role, email: seller.email },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
  await mongoose.disconnect();
  console.log(`Importing as: ${seller.storeName || seller.name} <${seller.email}>`);

  // ── Pre-flight: is the backend actually up? ─────────────────────────
  try {
    await fetch(`${API}/products?limit=1`);
  } catch (e) {
    console.error(
      `\nCan't reach the backend at ${API} — it doesn't appear to be running.\n` +
        `Start it in another terminal first:\n\n` +
        `    cd backend\n    node server.js\n\n` +
        `then re-run this script. (Override the URL with --api=... if it runs elsewhere.)`,
    );
    process.exit(1);
  }

  // ── Load sheet rows ─────────────────────────────────────────────────
  const wb = XLSX.read(fs.readFileSync(sheetPath), { type: 'buffer' });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() !== 'instructions') || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
  const header = Object.keys(rows[0] || {});
  console.log(`Sheet: ${rows.length} rows | images from: ${IMG_DIR}\n`);

  // filenames a set of rows references (images + colorImages cells),
  // filtered to files that actually exist in IMG_DIR
  function filesFor(chunk) {
    const names = new Set();
    for (const r of chunk) {
      for (const ref of String(r.images || '').split(/[|,]+/)) {
        const f = ref.trim();
        if (f && !/^https?:\/\//i.test(f)) names.add(f);
      }
      for (const part of String(r.colorImages || '').split(';')) {
        const colon = part.indexOf(':');
        if (colon < 0) continue;
        for (const ref of part.slice(colon + 1).split(/[|,]+/)) {
          const f = ref.trim();
          if (f && !/^https?:\/\//i.test(f)) names.add(f);
        }
      }
    }
    return [...names].filter((n) => fs.existsSync(path.join(IMG_DIR, n)));
  }

  const totals = { created: 0, updated: 0, drafted: 0, failed: 0 };
  const failures = [];

  for (let off = 0; off < rows.length; off += ROWS_PER_REQ) {
    const chunk = rows.slice(off, off + ROWS_PER_REQ);
    const files = filesFor(chunk);

    // mini-workbook for just this chunk
    const cwb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(cwb, XLSX.utils.json_to_sheet(chunk, { header }), 'Products');
    const xlsxBuf = XLSX.write(cwb, { type: 'buffer', bookType: 'xlsx' });

    const fd = new FormData();
    fd.append(
      'xlsx',
      new Blob([xlsxBuf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'chunk.xlsx',
    );
    for (const name of files) {
      const ext = (name.match(/\.(\w+)$/) || [])[1]?.toLowerCase() || 'jpg';
      fd.append(
        'images',
        new Blob([fs.readFileSync(path.join(IMG_DIR, name))], {
          type: MIME[ext] || 'image/jpeg',
        }),
        name,
      );
    }

    process.stdout.write(`rows ${off + 1}-${off + chunk.length} (${files.length} photos)... `);
    const res = await fetch(`${API}/products/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log(`HTTP ${res.status}: ${data.message || 'request failed'}`);
      // whole chunk failed — record each row so nothing vanishes silently
      for (const r of chunk) {
        totals.failed += 1;
        failures.push({ name: r.name, error: data.message || `HTTP ${res.status}` });
      }
      continue;
    }
    const s = data.summary || {};
    totals.created += s.created || 0;
    totals.updated += s.updated || 0;
    totals.drafted += s.draftedNoImages || 0;
    totals.failed += s.failed || 0;
    for (const r of data.results || []) {
      if (r.status === 'failed') failures.push({ name: r.name, error: r.error });
    }
    console.log(
      `ok — created ${s.created || 0}, updated ${s.updated || 0}, drafts(no images) ${s.draftedNoImages || 0}, failed ${s.failed || 0}`,
    );
  }

  console.log('\n──────── total ────────');
  console.log(
    `created: ${totals.created}  updated: ${totals.updated}  drafted(no images): ${totals.drafted}  failed: ${totals.failed}`,
  );
  if (failures.length) {
    const logPath = path.join(__dirname, '..', 'new-products-images', '_import-failures.txt');
    fs.writeFileSync(logPath, failures.map((f) => `${f.name} — ${f.error}`).join('\n'));
    console.log(`\nFirst failures:`);
    for (const f of failures.slice(0, 10)) console.log(`  ✗ ${f.name} — ${f.error}`);
    console.log(`Full list: ${logPath}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
