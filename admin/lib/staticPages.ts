/**
 * Static-route manifest — hard-coded storefront URLs that an admin can
 * override SEO meta for. Each entry maps a URL to a friendly title.
 * The admin Pages list synthesises a row for every entry below; clicking
 * Edit opens the SEO-meta editor backed by a Page record with
 * `type='static-meta'` and `staticRoute=<path>`.
 *
 * When the storefront's `generateMetadata` for one of these routes runs,
 * it first checks for an override Page; missing ones fall back to the
 * in-code defaults.
 *
 * Add new routes here when devs ship new storefront pages so the
 * marketing team can fill in their SEO copy.
 */
export type StaticPageEntry = {
  /** Storefront route (path). Used as the staticRoute key on the Page. */
  route: string;
  /** Human label shown in the admin Pages list. */
  title: string;
  /** Optional short description shown below the title in the list. */
  description?: string;
  /** Optional admin URL to route to when the row is clicked instead
   *  of the default static-meta editor. Used when a page has a
   *  dedicated CMS surface (e.g. FAQs → /pages/faqs). */
  editHref?: string;
  /**
   * Does the storefront route actually RENDER the on-page content
   * overrides (contentTitle / contentDescription / bottomTitle /
   * bottomDescription)?
   *
   * Only `/products` reads them today — it passes them to CategoryPage
   * as title/description/bottom-block overrides. Every other static
   * route ignores those fields completely.
   *
   * Without this flag the editor showed "Top Content" and "Bottom
   * Content" on every route, so an admin could write intro copy for
   * /about, save it, and never see it appear anywhere. The editor now
   * hides those sections unless the route opts in here — if you wire a
   * new route to read the fields, set this to true at the same time.
   */
  supportsContent?: boolean;
};

export const STATIC_PAGES: StaticPageEntry[] = [
  // NOTE: `/` is NOT in this list. The home page is managed as a
  // dedicated Page record with type='home' (system row at the top of
  // the Pages list). Adding `/` here would render a duplicate row.
  // The only route wired to render the on-page content overrides —
  // see `supportsContent` on StaticPageEntry.
  { route: '/products',     title: 'All products',   description: 'Catalogue index', supportsContent: true },
  { route: '/brands',       title: 'Brands index',   description: 'List of all brands' },
  { route: '/categories',   title: 'Categories index', description: 'Top-level category tabs' },
  { route: '/shop-by-bike', title: 'Shop by bike',   description: 'Bike-make picker' },
  // NOTE: '/seller' is deliberately NOT listed.
  //
  // That page is the SELLER PROPERTY's home page — it renders at
  // seller.throttlein.com/, and throttlein.com/seller merely 301s
  // there. It's listed on the Seller site's Pages screen instead, as
  // "Seller home" at route '/' (see lib/sellerStaticPages.ts), and
  // `frontend/app/seller/page.tsx` reads its override from the
  // seller-scoped record.
  //
  // Leaving it here would show the same page on both sites' lists, with
  // the Throttlein copy silently no longer being read by anything.
  { route: '/about',        title: 'About Us',       description: 'Company story and mission' },
  { route: '/contact',      title: 'Contact Us',     description: 'Support form + quick contact card' },
  { route: '/faqs',         title: 'FAQs',           description: 'Frequently asked questions', editHref: '/pages/faqs' },
  { route: '/blog',         title: 'Blog',           description: 'Article index' },
  { route: '/cart',         title: 'Cart',           description: 'Customer cart' },
  { route: '/login',        title: 'Login / Signup', description: 'Auth landing' },
];

export function findStaticPage(route: string): StaticPageEntry | undefined {
  return STATIC_PAGES.find((p) => p.route === route);
}
