#!/usr/bin/env node
/**
 * Fail if the nude theme has drifted between the two apps.
 *
 * WHY THIS EXISTS
 * `admin/app/themes/nude.css` and `frontend/app/themes/nude.css` must be
 * byte-identical. They are duplicated rather than shared because
 * `.github/workflows/deploy.yml` builds each app with
 * `context: ./<app>` — a file at the repo root simply does not exist in
 * either Docker build context, so `@import "../../shared/…"` would work
 * locally and fail the production build.
 *
 * Duplication without a guard is how this codebase ended up with 23 card
 * recipes and two near-identical RichTextEditors that silently diverged by
 * 36 lines. A comment saying "keep in sync" does not survive contact with
 * a deadline; a failing check does.
 *
 * Usage:
 *   node scripts/check-theme-sync.js
 * Exits 0 when identical, 1 with a diff summary when not.
 *
 * If the two ever NEED to differ, that's a real design decision — split
 * the shared part into a third file both import from within their own app
 * directory, rather than letting them drift.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

/**
 * Every pair that must stay byte-identical between the two apps.
 *
 * The theme AND the shared v3 component library are both duplicated for the
 * same Docker-context reason. That's nine components plus a barrel file, so
 * the guard matters more here than it did for one CSS file: these are the
 * pieces every redesigned page will import, and a silent divergence would
 * mean the admin and seller dashboards drift apart exactly as the audit
 * found `RichTextEditor` (36 lines apart) and `OrderTrackerVertical`
 * (248 lines apart) had already done.
 */
const UI_COMPONENTS = [
  'AppShell.tsx',
  'DataTable.tsx',
  'FilterTabs.tsx',
  'FormField.tsx',
  'IconButton.tsx',
  'PageHeader.tsx',
  'RowActions.tsx',
  'RowActions.module.css',
  'SectionTabs.tsx',
  'StatCard.tsx',
  'States.tsx',
  'StatusChip.tsx',
  'TablePagination.tsx',
  'index.ts',
];

/** Each entry is [adminPath, frontendPath, label]. */
const PAIRS = [
  ['admin/lib/useOrderPolling.ts', 'frontend/lib/useOrderPolling.ts', 'lib/useOrderPolling.ts'],
  ['admin/lib/listCache.ts', 'frontend/lib/listCache.ts', 'lib/listCache.ts'],
  ['admin/lib/dates.ts', 'frontend/lib/dates.ts', 'lib/dates.ts'],
  ['admin/app/themes/nude.css', 'frontend/app/themes/nude.css', 'nude theme'],
  // Order status derivation. Four views (seller list/detail, admin
  // list/detail) each had their own inline copy of "is this parcel
  // actually shipped?" and disagreed about the same order. One rule,
  // mirrored, guarded here.
  [
    'admin/lib/orderStatusDisplay.ts',
    'frontend/lib/orderStatusDisplay.ts',
    'lib/orderStatusDisplay.ts',
  ],
  ...UI_COMPONENTS.map((f) => [
    `admin/components/ui/${f}`,
    `frontend/components/ui/${f}`,
    `ui/${f}`,
  ]),
];

const read = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.error(`✗ missing: ${rel}`);
    process.exit(1);
  }
  // Normalise line endings before hashing: the repo has core.autocrlf
  // behaviour that rewrites LF to CRLF on checkout (git warned about this
  // on these very files), so a raw byte comparison would report false
  // drift depending on which machine checked out last.
  return fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
};

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

let failures = 0;

for (const [adminPath, frontendPath, label] of PAIRS) {
  const a = read(adminPath);
  const b = read(frontendPath);

  if (a === b) {
    console.log(`✓ ${label.padEnd(22)} in sync (sha256:${hash(a)}, ${a.split('\n').length} lines)`);
    continue;
  }

  failures++;
  console.error(`\n✗ ${label} has DRIFTED between apps`);
  console.error(`    ${adminPath}     sha256:${hash(a)}  ${a.split('\n').length} lines`);
  console.error(`    ${frontendPath}  sha256:${hash(b)}  ${b.split('\n').length} lines`);

  // Show the first few differing lines so the fix is obvious.
  const la = a.split('\n');
  const lb = b.split('\n');
  let shown = 0;
  for (let i = 0; i < Math.max(la.length, lb.length) && shown < 5; i++) {
    if (la[i] !== lb[i]) {
      console.error(`    line ${i + 1}:`);
      console.error(`      admin:    ${JSON.stringify(la[i] ?? '<absent>')}`);
      console.error(`      frontend: ${JSON.stringify(lb[i] ?? '<absent>')}`);
      shown++;
    }
  }
}

if (failures === 0) {
  console.log(`\nAll ${PAIRS.length} shared files in sync.`);
  process.exit(0);
}

console.error(
  `\n${failures} of ${PAIRS.length} shared file(s) drifted.` +
    '\nFix: copy the intended version over the other, then re-run.',
);
process.exit(1);
