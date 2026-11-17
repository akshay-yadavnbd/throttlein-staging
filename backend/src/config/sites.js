/**
 * Multi-site registry — the single source of truth for which content
 * "sites" this deployment serves.
 *
 * The platform runs two public properties off ONE backend and ONE Next
 * app:
 *   - 'main'   → throttlein.com
 *   - 'seller' → seller.throttlein.com
 *
 * CMS content (Pages, Blog posts, blog categories/tags, redirects) is
 * scoped by a `site` field carrying one of these keys. Everything that
 * predates multi-site support defaults to 'main', so the existing
 * storefront behaves exactly as before.
 *
 * Adding a third property later is a constant change here plus a branch
 * in the storefront proxy — deliberately NOT a boolean, so growth
 * doesn't require a refactor.
 */

const SITES = ['main', 'seller'];
const DEFAULT_SITE = 'main';

/** Permission-key prefix per site. The main site keeps the original,
 *  unprefixed keys ('pages', 'blogs') so existing staff grants keep
 *  working untouched; other sites prefix with the site key. */
function permissionKeyFor(base, site) {
  return !site || site === DEFAULT_SITE ? base : `${site}-${base}`;
}

function isSite(value) {
  return typeof value === 'string' && SITES.includes(value);
}

/** Coerce anything to a valid site key, falling back to 'main'. Use for
 *  lenient contexts (public reads). For strict contexts prefer isSite()
 *  and reject with 400 so typos are loud. */
function normalizeSite(value) {
  return isSite(value) ? value : DEFAULT_SITE;
}

module.exports = { SITES, DEFAULT_SITE, isSite, normalizeSite, permissionKeyFor };
