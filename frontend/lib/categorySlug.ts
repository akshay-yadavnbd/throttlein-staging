/**
 * Helpers for converting between human category names and URL slugs.
 *
 *   "Helmets"       <-> "helmets"
 *   "Bike Safety"   <-> "bike-safety"
 *   "Royal Enfield" <-> "royal-enfield"
 *
 * The backend filters products by the *name* (case-sensitive in some
 * places), so when we receive a slug from the URL we convert it back to
 * its title-cased name before calling the API.
 */

export function nameToSlug(name: string): string {
  // MUST mirror the backend Category model's slugify() exactly —
  // notably it does NOT map "&" to "and", it just strips it like any
  // other symbol ("Mobile & Navigation" → "mobile-navigation").
  // The old "&"→"and" mapping here generated links like
  // /mobile-and-navigation that 404'd against the real DB slug.
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function slugToName(slug: string): string {
  return (slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Convenience — root-level `/<slug>` for a given category name. */
export function categoryHref(name: string): string {
  return `/${nameToSlug(name)}`;
}
