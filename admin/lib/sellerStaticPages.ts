import type { StaticPageEntry } from './staticPages';

/**
 * Static-route manifest for the SELLER property
 * (seller.throttlein.com) — the counterpart to `STATIC_PAGES`, which
 * covers throttlein.com.
 *
 * These are hard-coded Next routes, not CMS records, so they can't be
 * created or deleted from the panel — but their SEO meta IS editable
 * via a `type='static-meta'` Page scoped to `site='seller'`.
 *
 * Each entry is a row in the All pages table, and each row's Edit
 * meta / Set meta opens the standard per-page static-meta editor —
 * exactly like the main site's static rows and like the dynamic/prose
 * rows' own editors. (Settled after several iterations that routed
 * these rows to the /pages/sell hub instead; every variant of that
 * read as "Edit took me to the wrong page". /pages/sell now manages
 * only the Seller Guide section, which has no row here.)
 *
 * WHICH ROUTES BELONG HERE
 * Only paths that (a) exist on the seller host and (b) have an SEO
 * surface worth editing. `frontend/proxy.ts` → handleSellerHosts() is
 * the authority on what resolves there:
 *
 *   /            → app/seller/page.tsx          ✓ listed
 *   /login       → app/seller/login             ✓ listed (noindex, but
 *                                                 the title still shows
 *                                                 in tabs + shares)
 *   /register    → app/seller/register          ✓ listed
 *   /blog        → app/seller/blog              ✓ listed
 *   /guide/<x>   → app/seller/guide/[slug]      ✗ per-guide meta lives
 *                                                 on the SellerGuide
 *                                                 record itself
 *   /verify/<t>  → app/seller/verify/[token]    ✗ transactional
 *   /dashboard/* → app/dashboard/**             ✗ authenticated
 *   /blog/**     → post + category routes       ✗ meta comes from the
 *                                                 post/category record
 *
 * Add an entry here when a new top-level seller-host page ships, and
 * make its `generateMetadata` call `buildStaticPageMetadata({ site:
 * 'seller', route: '<path>' })` — the row is inert until it does.
 */
export const SELLER_STATIC_PAGES: StaticPageEntry[] = [
  {
    // The seller landing page. The route key is '/' — the path on the
    // seller HOST. Internally Next serves it from /seller, and the main
    // site's own '/seller' route 301s here, but the CMS key is the
    // public path on this property.
    //
    // No editHref: the row opens the generic static-meta editor like
    // its siblings. The guide cards + section heading on this page are
    // the one thing a meta editor can't hold — they're managed on the
    // "Seller home" tab (/pages/sell).
    route: '/',
    title: 'Seller home',
    description: 'Landing page SEO — guide cards live in the Seller home tab',
  },
  {
    route: '/sell-online',
    title: 'Sell Online',
    description: 'Long-form seller onboarding guide — SEO meta only',
  },
  {
    route: '/blog',
    title: 'Seller blog',
    description: 'Article index for the seller property',
  },
  {
    route: '/register',
    title: 'Seller signup',
    description: 'Account creation form',
  },
  {
    route: '/login',
    title: 'Seller login',
    description: 'Auth landing (noindex — title only)',
  },
];
