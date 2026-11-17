/**
 * Literal path redirects — the single source of truth.
 *
 * WHY THIS FILE EXISTS
 * These pairs are consumed by two very different things:
 *
 *   1. `next.config.js` `redirects()`, which serves the 308 at runtime.
 *   2. The generated SEO files (`lib/sitemaps.ts`, `app/llms.txt`,
 *      `app/seller/*`), which must never ADVERTISE a URL that redirects.
 *
 * They used to live only in (1). The result was that `chain-lube-cleaner`
 * — a category still active in the database — got listed in llms.txt at a
 * URL that immediately 308s to `/chain-lubricants`. Search engines treat
 * a redirecting sitemap entry as a soft error, and a model reading
 * llms.txt has no reason to follow the hop at all.
 *
 * Keeping one table and resolving through it means a category that drifts
 * out of sync can't be advertised at a dead URL again.
 *
 * SCOPE: literal paths only. The parameterised rules (`/c/:slug`,
 * `/page/:slug`, `/sell/guide/:slug`) stay in next.config.js — they're
 * patterns, and nothing generates URLs in those shapes.
 *
 * Plain CommonJS on purpose: next.config.js is CJS and must `require` it,
 * while the TypeScript route handlers import it (tsconfig has
 * `allowJs: true`). One file, both worlds, no duplicated table.
 */

/**
 * Retired category slugs → the restructured taxonomy. See
 * backend/scripts/restructure-categories.js. Most of the old categories
 * were emptied and deactivated; their URLs redirect to the new canonical
 * category pages to preserve bookmarks and SEO equity.
 */
const RETIRED_CATEGORY_REDIRECTS = [
  { source: '/helmets-and-accessories', destination: '/helmets' },
  { source: '/bags-and-backpacks', destination: '/luggage-touring' },
  { source: '/bags', destination: '/luggage-touring' },
  { source: '/luggage', destination: '/luggage-touring' },
  { source: '/jackets', destination: '/riding-jackets' },
  { source: '/riding-jacket', destination: '/riding-jackets' },
  { source: '/gloves', destination: '/riding-gloves' },
  { source: '/boots', destination: '/riding-boots' },
  { source: '/riding-boots-shoes', destination: '/riding-boots' },
  { source: '/riding-denims', destination: '/riding-jeans' },
  { source: '/rain-liner-jackets', destination: '/rain-jackets' },
  { source: '/rider-protection', destination: '/protection-gear' },
  { source: '/exhaust', destination: '/exhaust-systems' },
  { source: '/air-filter', destination: '/air-filters' },
  { source: '/chain-sprocket', destination: '/chains-sprockets' },
  { source: '/chain-lube-cleaner', destination: '/chain-lubricants' },
  { source: '/bluetooth', destination: '/intercom-systems' },
  { source: '/navigation', destination: '/mobile-navigation' },
  { source: '/rider-tech', destination: '/mobile-navigation' },
  { source: '/headlight', destination: '/headlight-upgrades' },
  { source: '/auxiliary-light', destination: '/auxiliary-lights' },
  { source: '/back-pack', destination: '/backpacks' },
  { source: '/trail-pack', destination: '/backpacks' },
  { source: '/lights', destination: '/lighting' },
];

/**
 * "&"-slug variants. The frontend briefly generated links with "&"
 * mapped to "and" while the backend strips it, so these catch anything
 * cached, bookmarked or indexed in the wrong form.
 */
const AMPERSAND_VARIANT_REDIRECTS = [
  { source: '/mobile-and-navigation', destination: '/mobile-navigation' },
  { source: '/luggage-and-touring', destination: '/luggage-touring' },
  { source: '/camping-and-travel', destination: '/camping-travel' },
  { source: '/chains-and-sprockets', destination: '/chains-sprockets' },
  { source: '/polish-and-wax', destination: '/polish-wax' },
  { source: '/fluid-guards-and-caps', destination: '/fluid-guards-caps' },
  { source: '/carrier-and-back-rack', destination: '/carrier-back-rack' },
];

/**
 * Old umbrella / nav categories with no single successor — sent to the
 * closest sensible destination.
 *
 * NOTE: `/riding-gears` is a real page again (the Riding Gear
 * collection), so it must NOT appear here.
 */
const UMBRELLA_REDIRECTS = [
  { source: '/performance-accessories', destination: '/performance-parts' },
  { source: '/bike-safety', destination: '/security' },
  // /sell was renamed to /seller.
  { source: '/sell', destination: '/seller' },
];

const LITERAL_REDIRECTS = [
  ...RETIRED_CATEGORY_REDIRECTS,
  ...AMPERSAND_VARIANT_REDIRECTS,
  ...UMBRELLA_REDIRECTS,
];

const DESTINATION_BY_SOURCE = new Map(
  LITERAL_REDIRECTS.map((r) => [r.source, r.destination]),
);

/**
 * Follow a path to where it actually ends up.
 *
 * Chains are followed (a source whose destination is itself a source),
 * capped at 5 hops so a table that accidentally loops degrades to
 * "return what you were given" rather than hanging the request.
 *
 * Returns the path unchanged when nothing matches, which is the common
 * case — callers can apply it unconditionally.
 */
function resolveLegacyPath(path) {
  let current = String(path || '');
  for (let hops = 0; hops < 5; hops++) {
    const next = DESTINATION_BY_SOURCE.get(current);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

/** True if this exact path is a redirect source (i.e. must not be advertised). */
function isLegacyPath(path) {
  return DESTINATION_BY_SOURCE.has(String(path || ''));
}

module.exports = {
  LITERAL_REDIRECTS,
  DESTINATION_BY_SOURCE,
  resolveLegacyPath,
  isLegacyPath,
};
