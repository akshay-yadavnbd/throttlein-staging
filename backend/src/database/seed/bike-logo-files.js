/** File helpers for seedBikeLogos.js: slugs, extensions, copying from --from-dir, Wikipedia lookups and polite downloads into the uploads folder. */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { env } = require('../../config/env');

/** Delay between downloads so we stay under Wikimedia's bot threshold.
 *  Their docs ask for ~1 req/sec from anonymous scripts; we use 1500ms
 *  to be polite. */
const SLEEP_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UPLOAD_DIR = path.join(__dirname, '..', '..', env.UPLOAD_DIR || 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** Make a filesystem-safe filename slug from a brand name. */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** Pick a sensible file extension from a URL or content-type. */
function extFor(url, contentType) {
  const lower = (url || '').toLowerCase().split('?')[0];
  if (lower.endsWith('.svg')) return '.svg';
  if (lower.endsWith('.png')) return '.png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return '.jpg';
  if (lower.endsWith('.webp')) return '.webp';
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('svg')) return '.svg';
  if (ct.includes('png')) return '.png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('webp')) return '.webp';
  return '.img';
}

/** Copy a file from anywhere on disk into the uploads dir. Resolves to
 *  the public `/uploads/<filename>` path. Used by --from-dir mode. */
function copyTo(name, srcPath) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(srcPath).toLowerCase() || '.img';
    const filename = `bike-logo-${slugify(name)}-${Date.now()}${ext}`;
    const outPath = path.join(UPLOAD_DIR, filename);
    fs.copyFile(srcPath, outPath, (err) => {
      if (err) return reject(err);
      resolve(`/uploads/${filename}`);
    });
  });
}

/** Common filename suffixes we strip when matching, so files like
 *  `triumph-logo.jpg`, `jawa-motorcycles.avif` resolve to the brand
 *  slugs `triumph` and `jawa`. */
const SUFFIXES_TO_STRIP = [
  '-logo',
  '-logos',
  '-mark',
  '-wordmark',
  '-motorcycle',
  '-motorcycles',
  '-motors',
  '-motor',
  '-bikes',
  '-bike',
  '-india',
  '-official',
];

/** Common misspellings → canonical brand slug. Add to this map when a
 *  file uses a typo you want the script to recognize. */
const ALIASES = {
  'harley-devidson': 'harley-davidson',
  harleydevidson: 'harley-davidson',
  harleydavidson: 'harley-davidson',
  royalenfield: 'royal-enfield',
  'ola-electric': 'ola',
};

/** Scan the --from-dir folder once and build a `brandSlug → fullPath` map.
 *  Filenames match flexibly: case-insensitive, separator-flexible, with
 *  common suffixes stripped, and known typos remapped via ALIASES. */
function scanLocalDir(dirPath) {
  const map = {};
  if (!fs.existsSync(dirPath)) {
    // Auto-create instead of crashing — the common workflow is
    // "make the folder, drop logos in, rerun". This makes the first
    // run a useful step (it creates the folder) rather than an error.
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created empty folder ${dirPath}.`);
    console.log('Drop logo files in (named by slug, e.g. royal-enfield.svg) then rerun.');
    return map;
  }
  const entries = fs.readdirSync(dirPath);
  for (const entry of entries) {
    const full = path.join(dirPath, entry);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(entry).toLowerCase();
    if (!['.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(ext)) continue;
    const base = path.basename(entry, ext);
    const fileSlug = slugify(base);

    // Register the exact slug.
    map[fileSlug] = full;

    // Also register the slug with each known suffix stripped, so
    // `triumph-logo` → `triumph`, `jawa-motorcycles` → `jawa`, etc.
    for (const sfx of SUFFIXES_TO_STRIP) {
      if (fileSlug.endsWith(sfx) && fileSlug.length > sfx.length) {
        map[fileSlug.slice(0, -sfx.length)] = full;
      }
    }

    // Apply known typo aliases.
    if (ALIASES[fileSlug]) {
      map[ALIASES[fileSlug]] = full;
    }
  }
  return map;
}

/** Query the MediaWiki API for the lead image of a Wikipedia article.
 *  Resolves to the image URL, or null if the article has no main image
 *  (or doesn't exist). Used by --from-wiki mode to grab the infobox
 *  photo for a bike model like "Royal Enfield Bullet 350". */
function fetchWikipediaImage(title) {
  return new Promise((resolve) => {
    const apiUrl =
      'https://en.wikipedia.org/w/api.php?action=query' +
      '&prop=pageimages&piprop=original&format=json&redirects=1' +
      `&titles=${encodeURIComponent(title)}`;
    const u = new URL(apiUrl);
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'throttlein-seed/1.0 (admin@throttlein.local)' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const pages = json?.query?.pages || {};
            for (const id of Object.keys(pages)) {
              const src = pages[id]?.original?.source;
              if (src) return resolve(src);
            }
            resolve(null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => req.destroy());
  });
}

/** Download a URL, following redirects, into the uploads dir. Resolves to
 *  the public `/uploads/<filename>` path. */
function downloadTo(name, url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https:') ? https : http;
    const u = new URL(url);
    const req = lib.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        // Wikimedia and most CDNs reject requests without a UA.
        headers: { 'User-Agent': 'throttlein-seed/1.0 (admin@throttlein.local)' },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(downloadTo(name, next, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`${res.statusCode} ${res.statusMessage} for ${url}`));
        }
        const ext = extFor(url, res.headers['content-type']);
        const filename = `bike-logo-${slugify(name)}-${Date.now()}${ext}`;
        const outPath = path.join(UPLOAD_DIR, filename);
        const sink = fs.createWriteStream(outPath);
        res.pipe(sink);
        sink.on('finish', () => sink.close(() => resolve(`/uploads/${filename}`)));
        sink.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

module.exports = { SLEEP_MS, sleep, slugify, copyTo, scanLocalDir, fetchWikipediaImage, downloadTo };
