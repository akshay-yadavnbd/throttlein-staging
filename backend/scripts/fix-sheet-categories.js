/**
 * fix-sheet-categories.js
 *
 * Reconciles a bulk-import sheet's `category` column with the admin
 * catalog. Most import failures are just naming drift ("RIDING PANTS"
 * vs "Riding Pants", "Riding Boots/Shoes" vs "Riding Boots"), so:
 *
 *   1. Loads every admin category (excluding the Shop by Bike tree —
 *      products can't attach there).
 *   2. Matches each distinct sheet category: exact (case-insensitive)
 *      → normalized (letters+digits only) → normalized singular/plural.
 *   3. Prints the mapping table: matched names, unmatched names, and
 *      rows with a BLANK category (those you must fill by hand).
 *
 * Flags:
 *   --apply            rewrite matched cells to the admin's canonical
 *                      name, in place (a .bak copy is written first)
 *   --create-missing   create unmatched names as new TOP-LEVEL active
 *                      categories, so the import can proceed
 *
 * Typical run:
 *   node scripts/fix-sheet-categories.js ../products-bulk-import-local.xlsx
 *   node scripts/fix-sheet-categories.js ../products-bulk-import-local.xlsx --apply --create-missing
 * then re-run the import (upserts by SKU — already-imported rows just update).
 */
require('../loadEnv');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const Category = require('../src/modules/catalog/category.model');

const sheetArg = process.argv[2];
const APPLY = process.argv.includes('--apply');
const CREATE = process.argv.includes('--create-missing');

if (!sheetArg) {
  console.error('Usage: node scripts/fix-sheet-categories.js <path-to-xlsx> [--apply] [--create-missing]');
  process.exit(1);
}
const sheetPath = path.resolve(process.cwd(), sheetArg);
if (!fs.existsSync(sheetPath)) {
  console.error(`Sheet not found: ${sheetPath}`);
  process.exit(1);
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
const dePlural = (s) => s.replace(/s$/, '');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  // Admin categories, minus the Shop by Bike tree
  const all = await Category.find({}).select('name parent').lean();
  const byId = new Map(all.map((c) => [String(c._id), c]));
  const sbbRoot = all.find((c) => c.parent === null && c.name === 'Shop by Bike');
  const inBikeTree = (c) => {
    let cur = c;
    while (cur) {
      if (sbbRoot && String(cur._id) === String(sbbRoot._id)) return true;
      cur = cur.parent ? byId.get(String(cur.parent)) : null;
    }
    return false;
  };
  const cats = all.filter((c) => !inBikeTree(c));
  const exact = new Map(cats.map((c) => [c.name.toLowerCase(), c.name]));
  const normed = new Map(cats.map((c) => [norm(c.name), c.name]));
  const normedSingular = new Map(cats.map((c) => [dePlural(norm(c.name)), c.name]));

  function match(sheetName) {
    const lower = sheetName.toLowerCase();
    if (exact.has(lower)) return exact.get(lower);
    const n = norm(sheetName);
    if (normed.has(n)) return normed.get(n);
    const ns = dePlural(n);
    if (normedSingular.has(ns)) return normedSingular.get(ns);
    return null;
  }

  // Sheet
  const wb = XLSX.read(fs.readFileSync(sheetPath), { type: 'buffer' });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() !== 'instructions') || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
  const header = Object.keys(rows[0] || {});

  const distinct = [...new Set(rows.map((r) => String(r.category || '').trim()).filter(Boolean))];
  const mapping = new Map(); // sheet name → admin name
  const unmatched = [];
  for (const name of distinct) {
    const hit = match(name);
    if (hit) mapping.set(name, hit);
    else unmatched.push(name);
  }

  console.log(`Admin categories (outside Shop by Bike): ${cats.length}`);
  console.log(`Sheet categories: ${distinct.length} distinct\n`);
  console.log('── matched ─────────────────────────────');
  for (const [from, to] of mapping) {
    console.log(from === to ? `  = ${from}` : `  ~ ${from}  →  ${to}`);
  }
  console.log('\n── NOT in admin ────────────────────────');
  unmatched.forEach((n) => console.log(`  ✗ ${n}`));
  if (!unmatched.length) console.log('  (none)');

  const blankRows = rows.map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => !String(r.category || '').trim());
  if (blankRows.length) {
    console.log('\n── BLANK category (fill these by hand) ─');
    blankRows.forEach(({ r, line }) => console.log(`  row ${line}: ${r.name}`));
  }

  // Create the unmatched ones as top-level categories
  if (CREATE && unmatched.length) {
    console.log('\nCreating missing categories (top-level, active):');
    for (const name of unmatched) {
      await Category.create({ name, parent: null, isActive: true });
      mapping.set(name, name);
      console.log(`  + ${name}`);
    }
  }

  // Rewrite the sheet with canonical admin names
  if (APPLY) {
    let changed = 0;
    for (const r of rows) {
      const cur = String(r.category || '').trim();
      const to = mapping.get(cur);
      if (to && to !== cur) {
        r.category = to;
        changed++;
      }
    }
    fs.copyFileSync(sheetPath, sheetPath.replace(/\.xlsx$/i, '.bak.xlsx'));
    const outWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(outWb, XLSX.utils.json_to_sheet(rows, { header }), 'Products');
    XLSX.writeFile(outWb, sheetPath);
    console.log(`\nSheet updated in place (${changed} cells renamed). Backup: *.bak.xlsx`);
  } else if (mapping.size || unmatched.length) {
    console.log(
      '\nDry run — re-run with --apply to rewrite the sheet' +
        (unmatched.length ? ' and --create-missing to add the ✗ ones to admin.' : '.'),
    );
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
