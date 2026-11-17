/**
 * The auto-discovered static-page manifest, so the admin Pages list can
 * include any `page.tsx` added to the storefront without an admin change.
 * Cached in-process for 30s. The seller property's hard-coded routes are
 * app screens, not editable surfaces, so it gets an empty manifest.
 */
const { discoverStaticPages } = require('../../utils/discoverStaticPages');

const TTL_MS = 30_000;
let cache = null;
let cachedAt = 0;

function manifest(site) {
  if (site !== 'main') return { items: [], cachedAtMs: Date.now() };
  const now = Date.now();
  if (!cache || now - cachedAt > TTL_MS) {
    cache = discoverStaticPages();
    cachedAt = now;
  }
  return { items: cache, cachedAtMs: cachedAt };
}

module.exports = { manifest };
