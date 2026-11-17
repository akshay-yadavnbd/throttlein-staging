#!/usr/bin/env node
/**
 * Fail if any UI file sets text smaller than 12 px (UX audit T1 / T7).
 *
 * The type scale is six sizes: 12 (badges) · 13 (secondary) · 14 (body) ·
 * 16 · 20 · 28. Tailwind's `text-xs` is the floor. A `text-[9px]` /
 * `text-[10px]` / `text-[11px]` anywhere in admin/ or frontend/ is a
 * regression — the audit found 39 such nodes on one seller screen.
 *
 * Usage:  node scripts/check-type-scale.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APPS = ['admin', 'frontend'];
const SKIP = new Set(['node_modules', '.next', 'out', 'public']);
const BAD = /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g;

const hits = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(abs); continue; }
    if (!/\.(tsx?|jsx?|css)$/.test(entry.name)) continue;
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(BAD);
      if (m) hits.push(`${path.relative(ROOT, abs)}:${i + 1}  ${m.join(' ')}`);
    });
  }
}
for (const app of APPS) {
  const dir = path.join(ROOT, app);
  if (fs.existsSync(dir)) walk(dir);
}

if (hits.length === 0) {
  console.log('✓ no text below 12 px');
  process.exit(0);
}
console.error(`✗ ${hits.length} place(s) set text below 12 px — use text-xs (12 px) or larger:\n`);
console.error(hits.join('\n'));
process.exit(1);
