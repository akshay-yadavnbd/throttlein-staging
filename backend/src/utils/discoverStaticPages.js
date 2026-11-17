/**
 * Auto-discover static storefront pages by walking the frontend app dir.
 *
 * Returns the list of public, static, non-dynamic page routes that the
 * admin Pages list should surface. Run at request time so newly-added
 * page.tsx files appear in admin without any code change.
 *
 * Skipped on purpose:
 *   - Dynamic segments  → folders containing `[…]` (e.g. `[slug]`)
 *   - Route groups      → `(group)` folders are unwrapped (recurse, but
 *                          don't add the parens to the route path)
 *   - API routes        → anything inside `app/api/`
 *   - Auth-gated dirs   → `app/account/`, `app/dashboard/`
 *   - Other properties  → `app/seller/**` is the seller subdomain's
 *                          implementation, not a main-site route. It has
 *                          its own manifest in the admin
 *                          (lib/sellerStaticPages.ts).
 *   - Non-page files    → only `page.tsx|ts|jsx|js` counts
 *   - Diagnostic files  → not-found, opengraph-image, robots, sitemap
 *   - The home route `/` → handled by a dedicated `type='home'` Page
 *                          record, so we never want it to appear as a
 *                          static-meta row in the admin Pages list
 *
 * Title derivation: takes the last path segment, replaces dashes with
 * spaces, and title-cases the first letter. `/shop-by-bike` becomes
 * "Shop by bike". Admin can override with a friendlier label via the
 * /api/admin/static-pages?overrides=… mechanism (or by editing the
 * matching Page record's title field).
 */
const fs = require('fs');
const path = require('path');

const PAGE_FILES = new Set(['page.tsx', 'page.ts', 'page.jsx', 'page.js']);
const EXCLUDED_TOP_LEVEL = new Set([
  'api',
  'account',
  'dashboard',
  // 'seller' is excluded WHOLESALE, including its root.
  //
  // `app/seller/**` is the internal implementation of a DIFFERENT public
  // property: `proxy.ts` rewrites seller.throttlein.com onto it, and
  // throttlein.com/seller 301s over there. So none of these are
  // main-site routes, and listing them here would put the seller
  // domain's pages on the Throttlein site's Pages screen — with an "SEO
  // override" badge pointing at a record the page no longer reads.
  //
  // The seller property has its own manifest instead:
  // admin/lib/sellerStaticPages.ts, surfaced when the admin's site
  // switcher is set to Seller.
  'seller',
  // Pages with no SEO surface — keep them out of the admin list so
  // marketers aren't tempted to set meta on something that isn't crawled.
  'forgot-password',
  'reset-password',
]);

// Route-level exclusions for subtrees whose ROOT is public but whose
// children are auth flows with no SEO surface. (Currently empty — the
// seller subtree that used to need this is excluded at the top level
// above. Kept because the mechanism is still wired up in walk().)
const EXCLUDED_ROUTE_PREFIXES = [];

function isDynamicSegment(name) {
  return name.startsWith('[') && name.endsWith(']');
}

function isRouteGroup(name) {
  return name.startsWith('(') && name.endsWith(')');
}

/** Convert a slug like "shop-by-bike" to "Shop by bike". */
function deriveTitle(route) {
  if (route === '/') return 'Home page';
  const seg = route.split('/').filter(Boolean).pop() || '';
  const spaced = seg.replace(/[-_]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function walk(dir, routePrefix, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // dir missing — bail quietly
  }

  // First pass: does this dir contain a page file?
  for (const ent of entries) {
    if (ent.isFile() && PAGE_FILES.has(ent.name)) {
      const route = routePrefix || '/';
      if (!EXCLUDED_ROUTE_PREFIXES.some((p) => route.startsWith(p))) {
        out.add(route);
      }
      break;
    }
  }

  // Second pass: descend into child folders.
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (isDynamicSegment(ent.name)) continue; // dynamic — skip subtree
    if (routePrefix === '' && EXCLUDED_TOP_LEVEL.has(ent.name)) continue;
    const childRoute = isRouteGroup(ent.name)
      ? routePrefix // route groups don't affect the URL path
      : `${routePrefix}/${ent.name}`;
    walk(path.join(dir, ent.name), childRoute, out);
  }
}

/**
 * Discover all public static page routes. `appDir` defaults to the
 * frontend's app directory relative to the backend folder.
 *
 *   Routes returned sorted alphabetically with `/` first.
 *   Each entry: { route, title, description, autoDiscovered: true }
 */
function discoverStaticPages(appDir) {
  const target = appDir || path.resolve(__dirname, '..', '..', '..', 'frontend', 'app');
  const routes = new Set();
  walk(target, '', routes);

  // Drop the home route — it lives as a dedicated `type='home'` Page
  // record in the DB and is rendered as its own row at the top of
  // the admin Pages list. Including it here would create a duplicate.
  routes.delete('/');

  const list = Array.from(routes).sort((a, b) => a.localeCompare(b));

  return list.map((route) => ({
    route,
    title: deriveTitle(route),
    autoDiscovered: true,
  }));
}

module.exports = { discoverStaticPages };
