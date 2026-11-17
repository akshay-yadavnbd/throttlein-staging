/**
 * One-shot seed that populates each "Shop by Bike → <make>" category's
 * `icon` field with a real brand logo, stored as a proper uploaded file
 * (not a data URI).
 *
 * Two ways to source the logos:
 *
 *   1) DOWNLOAD MODE (default) — pulls from the URL map at the top of
 *      this file. Defaults point at Wikimedia Commons; swap any URL
 *      for your own if a default 404s.
 *
 *   2) LOCAL FOLDER MODE — `--from-dir <path>`. Drop pre-downloaded
 *      logo files into a folder (named by brand slug, e.g.
 *      `royal-enfield.svg`, `ktm.png`, `harley-davidson.svg`) and the
 *      script copies them into the backend's uploads/ folder and points
 *      each Category at the new path. Useful when Commons is unreliable
 *      or you have higher-quality logos already (designer exports,
 *      brand press kits, etc.).
 *
 * Usage:
 *   node src/utils/seedBikeLogos.js
 *   node src/utils/seedBikeLogos.js --force                     # overwrite
 *   node src/utils/seedBikeLogos.js --only=KTM,BMW              # subset
 *   node src/utils/seedBikeLogos.js --from-dir ./logos          # local folder
 *   node src/utils/seedBikeLogos.js --from-dir ./logos --force  # both
 *   node src/utils/seedBikeLogos.js --from-dir ./bike-pics --recursive
 *     # ↑ walks the whole Shop-by-Bike subtree (makes AND models),
 *     #   so files like `bullet-350.jpg`, `classic-650.jpg`, etc.
 *     #   populate each bike model's tile image.
 *
 * Or via npm:  `npm run seed:bike-logos`
 *
 * SAFETY: only populates `icon` when it's empty (or starts with
 * `data:` — those are the placeholder wordmarks from the previous
 * seed run and should be replaced). Pre-existing uploaded logos
 * (path starts with `/uploads/`) are never touched unless `--force`.
 */

require('../../config/loadEnv');
const path = require('path');
const mongoose = require('mongoose');
const Category = require('../../modules/catalog/category.model');
const { env } = require('../../config/env');

const FORCE = process.argv.includes('--force');
const RECURSIVE = process.argv.includes('--recursive');
// --from-wiki: look up each category on Wikipedia and pull the article's
// infobox image. Best paired with --recursive so it can fill bike-model
// tiles for which Wikipedia has a CC-licensed photo. Coverage is partial
// (only popular models have articles), and CC-BY-SA images technically
// require attribution somewhere on the site, so for a production launch
// you'll want to replace with manufacturer press-kit photos.
const FROM_WIKI = process.argv.includes('--from-wiki');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '')
  .replace('--only=', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// --from-dir <path> mode — accept the next argv after the flag, OR the
// `--from-dir=<path>` style.
const FROM_DIR = (() => {
  const eq = process.argv.find((a) => a.startsWith('--from-dir='));
  if (eq) return eq.replace('--from-dir=', '');
  const idx = process.argv.indexOf('--from-dir');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
})();

/**
 * Brand name → source logo URL.
 *
 * Names must match the Category.name under "Shop by Bike" exactly
 * (case-sensitive). To find what your DB has, run:
 *
 *   mongo > db.categories.find({ parent: <shopByBikeId> }, { name: 1 })
 *
 * The defaults below use Wikimedia Commons' `Special:FilePath/<filename>`
 * endpoint, which is a stable redirect that doesn't depend on the
 * content-hash subdirectory (those break whenever Commons re-files
 * an image). Swap any URL for one you trust if a default 404s.
 */
const COMMONS = (filename) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;

const SOURCES = {
  'Royal Enfield': COMMONS('Royal Enfield Logo.svg'),
  Yamaha: COMMONS('Yamaha Motor Company.svg'),
  KTM: COMMONS('KTM-Sportmotorcycle AG logo.svg'),
  Bajaj: COMMONS('Bajaj Auto Logo.svg'),
  Honda: COMMONS('Honda Logo.svg'),
  Suzuki: COMMONS('Suzuki logo 2.svg'),
  Hero: COMMONS('Hero MotoCorp Logo.svg'),
  BMW: COMMONS('BMW.svg'),
  Kawasaki: COMMONS('Kawasaki Heavy Industries Logo.svg'),
  Triumph: COMMONS('Triumph Logo.svg'),
  TVS: COMMONS('TVS Motor Company Logo.svg'),
  'Harley Davidson': COMMONS('Harley-Davidson.svg'),
  'Harley-Davidson': COMMONS('Harley-Davidson.svg'),
  Ducati: COMMONS('Ducati red logo.PNG'),
  Aprilia: COMMONS('Aprilia-logo.svg'),
  Benelli: COMMONS('Benelli logo.svg'),
  Jawa: COMMONS('Jawa Moto logo.svg'),
  Ather: COMMONS('Ather Energy logo.svg'),
  'Ola Electric': COMMONS('Ola Electric Logo.svg'),
  Ola: COMMONS('Ola Electric Logo.svg'),
  Yezdi: COMMONS('Yezdi logo.svg'),
};

const {
  SLEEP_MS,
  sleep,
  slugify,
  copyTo,
  scanLocalDir,
  fetchWikipediaImage,
  downloadTo,
} = require('./bike-logo-files');

async function run() {
  const mongoUri = env.MONGODB_URI || env.MONGO_URI;
  if (!mongoUri) {
    console.error('Missing MONGODB_URI (or MONGO_URI) in .env');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);

  const root = await Category.findOne({ parent: null, name: 'Shop by Bike' });
  if (!root) {
    console.error('Could not find a top-level "Shop by Bike" category.');
    await mongoose.disconnect();
    process.exit(1);
  }

  // Default = direct children of Shop by Bike (the makes).
  // --recursive = walk the whole subtree (makes + every model under
  // every make), so a single seed pass can populate tile images for
  // every level at once.
  let makes;
  if (RECURSIVE) {
    // Iterative BFS rather than a recursive function. Returns
    // everything below `root` but not `root` itself.
    const collected = [];
    let frontier = [root._id];
    while (frontier.length) {
      const layer = await Category.find({ parent: { $in: frontier } });
      collected.push(...layer);
      frontier = layer.map((c) => c._id);
    }
    makes = collected;
    console.log(`Found ${makes.length} categories under "${root.name}" (recursive).\n`);
  } else {
    makes = await Category.find({ parent: root._id });
    console.log(`Found ${makes.length} bike makes under "${root.name}".\n`);
  }

  // If --from-dir was passed, scan it once up front. Local files take
  // precedence over URL downloads.
  let localMap = null;
  if (FROM_DIR) {
    localMap = scanLocalDir(FROM_DIR);
    const localCount = Object.keys(localMap).length;
    console.log(`Local mode: scanned "${FROM_DIR}" — found ${localCount} candidate files.\n`);
  }

  // Build a _id → category map so model-level entries can find their
  // parent make's name when constructing Wikipedia titles like
  // "Royal Enfield Bullet 350" (model `name` alone is just "Bullet 350").
  const byId = new Map();
  for (const c of makes) byId.set(c._id.toString(), c);

  if (FROM_WIKI) {
    console.log(`Wiki mode: querying Wikipedia for each category's infobox image.\n`);
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let isFirstNet = true;
  for (const m of makes) {
    if (ONLY.length && !ONLY.includes(m.name)) continue;

    const slug = slugify(m.name);
    const localPath = localMap ? localMap[slug] : null;
    const mapUrl = SOURCES[m.name];

    // Treat existing data: URIs as placeholders ready to be replaced.
    // /uploads/ paths are real uploaded logos and we leave them alone
    // unless --force was passed.
    const isPlaceholder = !m.icon || m.icon.startsWith('data:');
    const isRealUpload = m.icon && m.icon.startsWith('/uploads/');

    if (!isPlaceholder && !FORCE) {
      console.log(` -  ${m.name.padEnd(28)} already has an image — skipping (use --force to overwrite)`);
      skipped++;
      continue;
    }

    // Extra guard: --from-wiki should NEVER overwrite a real uploaded
    // file, even with --force. Wikipedia's "main article image" for a
    // brand is often a building / founder / etymology photo — not the
    // logo — so this protects us from silently destroying good uploads.
    // To replace a real upload with a Wikipedia image, the user can
    // explicitly use --from-dir with a downloaded file instead.
    if (FROM_WIKI && isRealUpload) {
      console.log(` -  ${m.name.padEnd(28)} has a real uploaded file — refusing to overwrite from Wikipedia`);
      skipped++;
      continue;
    }

    // Resolve a URL via Wikipedia if --from-wiki and we don't have a
    // local file. Local files always win; otherwise try Wikipedia first
    // for variety (real photos > brand logos for model tiles), then
    // fall back to the URL_MAP if Wikipedia has nothing.
    let wikiUrl = null;
    if (FROM_WIKI && !localPath) {
      // Build candidate article titles. For a model, the most useful
      // is "<make> <model>"; the bare "<model>" is a fallback.
      const parent = byId.get(m.parent?.toString());
      const candidates = [];
      if (parent && parent.name && parent.name !== m.name) {
        candidates.push(`${parent.name} ${m.name}`);
      }
      candidates.push(m.name);

      for (const title of candidates) {
        if (!isFirstNet) await sleep(SLEEP_MS);
        isFirstNet = false;
        wikiUrl = await fetchWikipediaImage(title);
        if (wikiUrl) {
          console.log(`    ↪ "${title}" → matched Wikipedia article`);
          break;
        }
      }
    }

    const url = wikiUrl || mapUrl;
    if (!localPath && !url) {
      // Soft skip — common for models without Wikipedia coverage. The
      // designed placeholder will render in the storefront instead.
      console.log(` -  ${m.name.padEnd(28)} no source (no local, no wiki, no URL map) — skipping`);
      skipped++;
      continue;
    }

    try {
      let newPath;
      if (localPath) {
        // Local file copy — instant, no rate limiting needed.
        newPath = await copyTo(m.name, localPath);
        console.log(` ✓  ${m.name.padEnd(28)} → ${newPath}   (copied from ${path.basename(localPath)})`);
      } else {
        // Throttle network downloads — Wikimedia asks for ~1 req/sec.
        if (!isFirstNet) await sleep(SLEEP_MS);
        isFirstNet = false;
        newPath = await downloadTo(m.name, url);
        console.log(` ✓  ${m.name.padEnd(28)} → ${newPath}`);
      }
      m.icon = newPath;
      await m.save();
      ok++;
    } catch (e) {
      console.log(` ✗  ${m.name.padEnd(28)} failed: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${ok} downloaded, ${skipped} skipped, ${failed} failed.`);
  if (FROM_WIKI) {
    console.log(
      'Note: images from Wikipedia are CC-licensed (typically CC-BY-SA),' +
        ' which means real-world use needs attribution somewhere on the site.' +
        ' Replace with manufacturer press-kit photos before a production launch.',
    );
  }
  await mongoose.disconnect();
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
