/**
 * One-shot seed that populates `Category.icon` for every Shop-by-Bike child
 * category (Royal Enfield, Yamaha, KTM, Bajaj, etc.) with a styled
 * text-wordmark SVG stored as a data URI.
 *
 * Why a data URI?
 *  - No file uploads required (no S3, no /uploads serving, no broken paths).
 *  - The SVG is self-contained and renders instantly on the storefront.
 *  - Admin can still upload a real logo later — that overwrites this default.
 *
 * SAFETY: only populates `icon` when it's empty. Pre-existing uploaded
 * icons (admin-set real logos) are never touched. Pass `--force` to
 * overwrite everything.
 *
 * Usage:
 *   node src/utils/seedBikeIcons.js
 *   node src/utils/seedBikeIcons.js --force
 *
 * Or via the npm script: `npm run seed:bike-icons`
 */

require('../../config/loadEnv');
const mongoose = require('mongoose');
const Category = require('../../modules/catalog/category.model');
const { env } = require('../../config/env');

const FORCE = process.argv.includes('--force');

/**
 * Per-make styling overrides. If a make has a recognizable brand color
 * we set it here so the badge feels closer to the real brand identity
 * without using a copyrighted logo. Default is brand-black on cream.
 */
const STYLE = {
  'Royal Enfield': { bg: '#7F1D1D', fg: '#FFFFFF' }, // deep maroon
  Yamaha: { bg: '#1E3A8A', fg: '#FFFFFF' }, // royal blue
  KTM: { bg: '#EA580C', fg: '#FFFFFF' }, // KTM orange
  Bajaj: { bg: '#1E40AF', fg: '#FFFFFF' }, // electric blue
  Honda: { bg: '#DC2626', fg: '#FFFFFF' }, // red
  Suzuki: { bg: '#0E7490', fg: '#FFFFFF' }, // suzuki teal-blue
  Hero: { bg: '#B91C1C', fg: '#FFFFFF' }, // red
  BMW: { bg: '#0EA5E9', fg: '#FFFFFF' }, // bmw blue
  Kawasaki: { bg: '#16A34A', fg: '#FFFFFF' }, // kawasaki green
  Triumph: { bg: '#1F2937', fg: '#FFFFFF' }, // dark grey
  TVS: { bg: '#1E40AF', fg: '#FFFFFF' }, // blue
  Ather: { bg: '#0F172A', fg: '#FFFFFF' }, // navy
  Ola: { bg: '#000000', fg: '#FFFFFF' }, // black
  'Harley Davidson': { bg: '#000000', fg: '#FFB300' }, // black + orange
  Benelli: { bg: '#16A34A', fg: '#FFFFFF' }, // green
  Ducati: { bg: '#DC2626', fg: '#FFFFFF' }, // ducati red
  Aprilia: { bg: '#7C3AED', fg: '#FFFFFF' }, // purple
};

const DEFAULT_STYLE = { bg: '#141414', fg: '#FFFFFF' };

/** Build an SVG data URI for a make name. */
function buildSvg(name) {
  const { bg, fg } = STYLE[name] || DEFAULT_STYLE;
  // Auto-size text to fit. Long names → 2 lines, short names → 1 line big.
  const words = name.split(/\s+/).filter(Boolean);
  const useTwoLines = words.length > 1 && name.length > 8;
  const fontSize = useTwoLines ? 22 : Math.min(40, Math.floor(180 / Math.max(name.length, 4)));

  const text = useTwoLines
    ? `<text x="100" y="92" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="${fg}" text-anchor="middle" letter-spacing="2">${escapeXml(words[0].toUpperCase())}</text>
       <text x="100" y="120" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="${fg}" text-anchor="middle" letter-spacing="2">${escapeXml(words.slice(1).join(' ').toUpperCase())}</text>`
    : `<text x="100" y="115" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="800" font-size="${fontSize}" fill="${fg}" text-anchor="middle" letter-spacing="3">${escapeXml(name.toUpperCase())}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
    <rect width="200" height="200" rx="100" ry="100" fill="${bg}"/>
    ${text}
  </svg>`;

  // Encode to a data URI. Use encodeURIComponent for safety with special chars.
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\n\s+/g, ' ').trim())}`;
}

function escapeXml(s) {
  return s.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;',
      })[c],
  );
}

async function run() {
  const mongoUri = env.MONGODB_URI || env.MONGO_URI;
  if (!mongoUri) {
    console.error('Missing MONGODB_URI (or MONGO_URI) in .env');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);

  // Find "Shop by Bike" root then its direct children (the makes).
  const root = await Category.findOne({ parent: null, name: 'Shop by Bike' });
  if (!root) {
    console.error('Could not find a top-level "Shop by Bike" category.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const makes = await Category.find({ parent: root._id });
  console.log(`Found ${makes.length} bike makes under "${root.name}".`);

  let updated = 0;
  let skipped = 0;
  for (const m of makes) {
    if (m.icon && !FORCE) {
      skipped++;
      continue;
    }
    m.icon = buildSvg(m.name);
    await m.save();
    console.log(` ✓ ${m.name.padEnd(20)} — icon set`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} skipped (already had an icon).`);
  if (skipped > 0 && !FORCE) {
    console.log('Pass --force to overwrite existing icons.');
  }
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
