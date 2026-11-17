/**
 * Admin modules registry — single source of truth for the admin panel's
 * sidebar AND the staff permission grid.
 *
 * Adding a new module:
 *   1. Add an entry below with a unique `key` (the permission string).
 *   2. The sidebar picks it up automatically via AdminShell's NAV.
 *   3. The Staff page checkbox grid picks it up automatically.
 *   4. Apply `requirePermission('<your-key>')` on the backend routes
 *      that the new module touches — that's the only manual wiring
 *      step left, and it's inherent (the route has to be gated by
 *      someone deciding which key applies).
 *
 * Dashboard isn't listed here — it's always accessible to anyone in
 * the admin panel and lives hard-coded at the top of the sidebar.
 *
 * `iconKey` is resolved to an actual icon component inside
 * AdminShell.tsx so this file stays plain TS (no JSX) and is safe to
 * import from anywhere — including non-React contexts down the line.
 */

/** Icon identifiers — must match the keys of the icon registry in
 *  `AdminShell.tsx`. Keep this list in sync when adding new icons. */
export type IconKey =
  | 'users'
  | 'shield'
  | 'clipboard-check'
  | 'refund'
  | 'customers'
  | 'bike'
  | 'folder-tree'
  | 'tag'
  | 'file-text'
  | 'book-open'
  | 'quote'
  | 'image'
  | 'orders'
  | 'server'
  | 'bell'
  | 'payout';

/** Badge endpoints — special cases where the sidebar polls for a count
 *  next to the label (pending KYC submissions, pending brand requests).
 *  The string maps to a hard-coded fetcher inside AdminShell. */
export type BadgeKind = 'kyc' | 'brand-requests';

/**
 * Sidebar groups (UX audit A3). Fourteen flat entries put Cache Inspector
 * beside Orders; three labelled groups say what kind of work each entry
 * is. Order within a group is registry order.
 *   operate   — the daily queues: orders, sellers, refunds, customers
 *   content   — what the storefront shows: catalogue, pages, blogs, media
 *   settings  — who can do what, and tools you rarely need
 */
export type NavGroup = 'operate' | 'content' | 'settings';
export const NAV_GROUPS: { id: NavGroup; label: string }[] = [
  { id: 'operate',  label: 'Operate' },
  { id: 'content',  label: 'Catalogue & content' },
  { id: 'settings', label: 'Settings' },
];

export type AdminModule = {
  /** Permission key. Stored on User.permissions[] and checked by the
   *  backend `requirePermission(...)` middleware. Must be unique. */
  key: string;
  /** Human-readable label rendered in the sidebar AND in the Staff
   *  permission grid. */
  label: string;
  /** Sidebar URL — also used by the page-level guard in AdminShell to
   *  decide which module a given pathname belongs to. */
  href: string;
  /** Identifier for the sidebar icon component. */
  iconKey: IconKey;
  /** Sidebar group (UX audit A3). Defaults to 'operate'. */
  group?: NavGroup;
  /** Optional sub-items in a fold-out menu (e.g. the Blogs section).
   *  Visibility per child is derived from MAIN_ONLY_PATHS /
   *  SELLER_ONLY_PATHS by href, so a child only appears on the sites
   *  where its route is actually reachable. */
  children?: { href: string; label: string }[];
  /** When true, `children` do NOT render as a sidebar submenu — the
   *  module's pages present them as in-page tabs instead (see
   *  components/OrdersTabs.tsx). The sidebar shows one leaf entry, active
   *  for the parent href OR any child href; the children stay in the
   *  registry so the shell's active-tab header can still name them
   *  ("Orders · COD remittance") and deep links keep resolving. */
  childrenAsTabs?: boolean;
  /** When true, the module renders NO sidebar entry but stays registered
   *  — its permission key remains grantable in the Staff grid and the
   *  URL guard still enforces it. Used when another module's in-page
   *  tabs are the intended way in (e.g. KYC reviews under Sellers). */
  hiddenInSidebar?: boolean;
  /** When set, the sidebar renders a live count badge next to the
   *  label. The fetcher is hard-coded in AdminShell. */
  badge?: BadgeKind;
  /** When true, the module is visible ONLY to the superadmin — never to
   *  staff, regardless of their `permissions[]` array. Used for module
   *  surfaces where the permission grid should NOT expose a checkbox
   *  (e.g. the Cache Inspector, where Redis surgery is superadmin-only
   *  by design). Modules flagged this way are also filtered out of the
   *  Staff permission grid. */
  superadminOnly?: boolean;
  /** When true, this module's DATA is per-site: the same screens show
   *  different records depending on the sidebar's site switcher, and
   *  the effective permission key gains a site prefix —
   *    main   → `<key>`          e.g. 'pages'
   *    seller → `seller-<key>`   e.g. 'seller-pages'
   *  The main site keeps the unprefixed key deliberately, so staff
   *  grants that predate multi-site keep working untouched.
   *
   *  Use `permKeyFor(module, site)` rather than reading `.key` directly
   *  anywhere access is being decided. */
  siteScoped?: boolean;
};

/** Site keys, duplicated from `lib/site.ts` to keep this file free of
 *  imports (it's imported from `site.ts`, so importing back would be a
 *  cycle). Keep the two lists in sync. */
const SITE_KEYS = ['main', 'seller'] as const;
type SiteKeyLocal = (typeof SITE_KEYS)[number];

/**
 * Effective permission key for a module on a given site.
 *
 * Non-scoped modules ignore the site entirely — there's one Orders
 * module, one Sellers module, and so on.
 */
export function permKeyFor(m: AdminModule, site: SiteKeyLocal): string {
  if (!m.siteScoped || site === 'main') return m.key;
  return `${site}-${m.key}`;
}

/**
 * Admin routes that exist ONLY for the main site, even though they live
 * under a site-scoped module's URL prefix.
 *
 * The `pages` module is site-scoped, but most of its sub-editors drive
 * main-site homepage furniture — hero banners, promo blocks, FAQs, the
 * Sell funnel, home SEO. Those models carry no `site` field and their
 * backend routes are gated on the unprefixed `pages` key.
 *
 * Without this list the URL guard in AdminShell would resolve
 * `/pages/home` to `seller-pages` while the switcher is on Seller,
 * producing two bad outcomes: a seller-only editor walks into a screen
 * where every request 403s, and a superadmin edits MAIN-site banners
 * while the sidebar says "Seller".
 *
 * Prefix match — `/pages/home` also covers `/pages/home/banners`.
 * Remove an entry here the moment its model gains a `site` field.
 */
export const MAIN_ONLY_PATHS: string[] = [
  '/pages/home',
  '/pages/home-seo',
  '/pages/faqs',
  '/pages/promo-blocks',
  // NOT listed: '/pages/static-meta'. That editor is genuinely
  // site-scoped — the Page record it writes carries a `site`, the
  // backend scopes reads and writes by it, and the seller property has
  // its own static routes to attach SEO overrides to (see
  // lib/sellerStaticPages.ts). Blocking it on the seller site would
  // make those rows unopenable.
  //
  // NOT listed either: '/pages/sell'. That one is the opposite —
  // seller-only. See SELLER_ONLY_PATHS below.
];

/**
 * Admin routes that exist ONLY for the seller property.
 *
 * `/pages/sell` is the "Become a seller" editor: the seller landing
 * page's SEO panel plus the Seller Guide cards and their section
 * heading. Everything it touches lives on seller.throttlein.com.
 *
 * It needs its own guard, not just absence from MAIN_ONLY_PATHS,
 * because its SEO panel targets `staticRoute: '/'`. Opened while the
 * switcher is on the main site that would resolve to the MAIN site's
 * root — which is the homepage record — and let someone overwrite
 * throttlein.com's homepage meta from a screen labelled "Become a
 * seller".
 */
export const SELLER_ONLY_PATHS: string[] = [
  '/pages/sell',
];

/** True when `pathname` is a seller-property-only admin route. */
export function isSellerOnlyPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return SELLER_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/** True when `pathname` is a main-site-only admin route. */
export function isMainOnlyPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return MAIN_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export const MODULES: AdminModule[] = [
  {
    key: 'orders',
    label: 'Orders',
    href: '/orders',
    iconKey: 'orders',
    children: [
      { href: '/orders', label: 'All orders' },
      { href: '/orders/checkout-failures', label: 'Checkout failures' },
      // "Shipping errors" (UX audit X3) — a slice that never reached the
      // courier. The route keeps its historical name.
      { href: '/orders/failed-pushes', label: 'Shipping errors' },
      // COD remittance ('/shiprocket/cod-remittance') PARKED, not deleted:
      // Shiprocket's API 404s the endpoint it reads, so the tab could only
      // show an error. Page + backend route remain; restore this child and
      // the OrdersTabs entry if Shiprocket enables it for this account.
    ],
    // In-page tabs (OrdersTabs), not a sidebar submenu — per product
    // decision the sidebar shows a single "Orders" entry.
    childrenAsTabs: true,
  },
  {
    key: 'sellers',
    label: 'Sellers',
    href: '/sellers',
    iconKey: 'users',
    children: [
      { href: '/sellers', label: 'All sellers' },
      { href: '/kyc-pending', label: 'KYC reviews' },
    ],
    // In-page tabs (ModuleTabs), single "Sellers" sidebar entry — same
    // treatment as Orders/Pages/Blogs, per product decision. NOTE: the
    // KYC tab is offered to anyone who can see Sellers; a staffer with
    // 'sellers' but not 'kyc' is still bounced from /kyc-pending by the
    // URL guard (the kyc module below stays in the nav for that guard,
    // it's just hidden from the sidebar).
    childrenAsTabs: true,
  },
  {
    key: 'kyc',
    label: 'KYC reviews',
    href: '/kyc-pending',
    iconKey: 'shield',
    badge: 'kyc',
    // Reachable via the Sellers page's KYC tab, per product decision.
    // The module REGISTRATION stays: it carries the 'kyc' permission for
    // the Staff grid and the URL guard — only the sidebar entry goes.
    hiddenInSidebar: true,
  },
  {
    key: 'brand-requests',
    label: 'Brand requests',
    href: '/brand-requests',
    iconKey: 'clipboard-check',
    badge: 'brand-requests',
    // Reachable via the Catalogue tabs (see the brands module) — the
    // registration stays for its permission + the URL guard.
    hiddenInSidebar: true,
  },
  {
    key: 'refunds',
    label: 'Refunds',
    href: '/refunds',
    iconKey: 'refund',
  },
  {
    // Weekly seller payouts: delivered parcels minus courier + gateway
    // charges; admin records the bank transfer here.
    key: 'settlements',
    label: 'Settlements',
    href: '/settlements',
    iconKey: 'payout',
  },
  {
    key: 'customers',
    label: 'Customers',
    href: '/customers',
    iconKey: 'customers',
    childrenAsTabs: true,
    children: [
      { href: '/customers', label: 'All customers' },
      { href: '/customers/carts', label: 'Customer carts' },
    ],
  },
  {
    key: 'shop-by-bike',
    label: 'Shop by Bike',
    href: '/shop-by-bike',
    iconKey: 'bike',
    // Reachable via the Catalogue tabs (see the brands module).
    hiddenInSidebar: true,
  },
  {
    key: 'categories',
    label: 'Categories',
    href: '/categories',
    iconKey: 'folder-tree',
    // Reachable via the Catalogue tabs (see the brands module).
    hiddenInSidebar: true,
  },
  {
    // HOST of the merged Catalogue section, per product decision: one
    // sidebar entry whose in-page tabs carry Brands, Categories, Shop by
    // Bike and Brand requests (their modules above/below are registered
    // but hiddenInSidebar — permissions and the URL guard still apply
    // per module). NOTE: the tabs are offered to anyone who can see this
    // entry ('brands' permission); a staffer lacking e.g. 'categories'
    // is bounced by the URL guard when they click that tab.
    key: 'brands',
    label: 'Catalogue',
    href: '/brands',
    iconKey: 'tag',
    group: 'content',
    children: [
      { href: '/brands', label: 'Brands' },
      { href: '/categories', label: 'Categories' },
      { href: '/shop-by-bike', label: 'Shop by Bike' },
      { href: '/brand-requests', label: 'Brand requests' },
    ],
    childrenAsTabs: true,
  },
  {
    key: 'pages',
    label: 'Pages',
    href: '/pages',
    iconKey: 'file-text',
    group: 'content',
    // Per-site: 'pages' on throttlein.com, 'seller-pages' on the seller
    // subdomain. The homepage-furniture editors nested under /pages
    // (Home SEO, banners, promo blocks, FAQs, Sell page) remain
    // main-site-only for now — see docs/MULTI_SITE_CMS_PLAN.md §7.
    siteScoped: true,
    // Sub-menu reveals the redirects manager underneath the main
    // Pages listing. Per-section editors (Promo Blocks, Home SEO,
    // Hero Promo Banner, Hero banners, Trending, Seller CTA) are
    // intentionally NOT exposed in the sidebar — they're reached
    // from the Home page editor at /pages/home so the sidebar
    // stays focused on top-level admin surfaces.
    children: [
      { href: '/pages',           label: 'All pages' },
      // Seller-only: the landing-page editor (SEO + guide cards). Shown
      // only on the seller site via SELLER_ONLY_PATHS. It was previously
      // reachable ONLY by finding the "Seller home" row in the Pages
      // table, which made the seller property's richest editor
      // effectively hidden.
      { href: '/pages/sell',      label: 'Seller home' },
      { href: '/pages/redirects', label: '301 Redirection' },
    ],
    // In-page tabs (ModuleTabs), single "Pages" sidebar entry — same
    // treatment as Orders, per product decision.
    childrenAsTabs: true,
  },
  {
    // Seller success stories — the quote cards on the Sell Online page
    // and every seller-category landing page. Genuinely site-scoped:
    // the Testimonial model carries a `site`, and the backend scopes
    // both reads and writes by it, so the sidebar switcher selects which
    // property's testimonials you're editing. That's why this needs no
    // MAIN_ONLY_PATHS / SELLER_ONLY_PATHS entry.
    key: 'testimonials',
    label: 'Testimonials',
    href: '/testimonials',
    iconKey: 'quote',
    group: 'content',
    siteScoped: true,
  },
  {
    key: 'blogs',
    label: 'Blogs',
    href: '/blogs',
    iconKey: 'book-open',
    group: 'content',
    // Per-site: 'blogs' / 'seller-blogs'. Posts, categories and tags are
    // scoped; the author roster is shared across both properties.
    siteScoped: true,
    children: [
      { href: '/blogs',            label: 'All Blogs' },
      // '/blogs/new' is deliberately NOT a tab: creating a post is an
      // action, not a section to browse, and as a tab it sat between
      // "All Blogs" and "Categories" as though it were one. It's now the
      // primary CTA beside the search field on /blogs. The route needs no
      // registry entry to stay reachable — the URL guard keys off the
      // module href, same as '/pages/new'. Only cost is the shell header
      // reading "Blogs" rather than "Blogs · Create New" there.
      { href: '/blogs/categories', label: 'Categories' },
      { href: '/blogs/tags',       label: 'Tags' },
      { href: '/blogs/authors',    label: 'Authors' },
    ],
    // In-page tabs (ModuleTabs), single "Blogs" sidebar entry — same
    // treatment as Orders, per product decision.
    childrenAsTabs: true,
  },
  {
    key: 'staff',
    label: 'Staff',
    href: '/staff',
    iconKey: 'users',
    group: 'settings',
  },
  {
    key: 'media',
    label: 'Media',
    href: '/media',
    iconKey: 'image',
    group: 'content',
  },
  {
    // Security — master access key management. Superadmin only, same
    // pattern as Cache Inspector: the backend routes under
    // /api/admin/security/* are gated with `requireRole('superadmin')`
    // rather than `requirePermission`, and `superadminOnly` keeps it out
    // of the Staff permission grid so no checkbox can ever grant it.
    key: 'security',
    label: 'Security',
    href: '/security',
    iconKey: 'shield',
    superadminOnly: true,
    group: 'settings',
  },
  {
    // Notifications — which internal addresses get copies of order,
    // return/refund and signup/KYC mail. superadminOnly for the same
    // reason as Security: adding an address puts a copy of every order
    // (customer names, totals, delivery areas) in an inbox, so it must
    // not be grantable through the staff permission grid.
    key: 'notifications',
    label: 'Notifications',
    href: '/notifications',
    iconKey: 'bell',
    superadminOnly: true,
    group: 'settings',
  },
  {
    // Cache Inspector — Redis observability page. Superadmin only; the
    // backend endpoints under /api/admin/redis/* are gated with
    // `requireRole('superadmin')` (not `requirePermission`). This module
    // is filtered out of the Staff permission grid so no checkbox can
    // accidentally grant access.
    key: 'cache',
    label: 'Cache inspector',
    href: '/cache',
    iconKey: 'server',
    superadminOnly: true,
    // A developer tool; lives last under Settings, not beside Orders.
    group: 'settings',
  },
];

/** Map permission key → module entry. Handy for the page-level guard
 *  in AdminShell and the chip rendering in the Staff list. */
export const MODULES_BY_KEY: Record<string, AdminModule> = Object.fromEntries(
  MODULES.map((m) => [m.key, m])
);

/** Modules that appear in the Staff permission grid — i.e. everything
 *  except entries flagged `superadminOnly`. Use this instead of `MODULES`
 *  when computing the set of assignable permissions or the "admin"
 *  preset (grant-everything) so superadmin-only surfaces never get
 *  exposed as a staff checkbox. */
export const STAFF_ASSIGNABLE_MODULES: AdminModule[] = MODULES.filter(
  (m) => !m.superadminOnly
);

/**
 * Every permission key a staff user could hold — site-scoped modules
 * contribute one key PER SITE ('pages' and 'seller-pages'), the rest
 * contribute one.
 *
 * This is what the "admin" preset on the Staff page grants, and what
 * `deriveRoleFromPermissions` compares against to decide whether a
 * staffer effectively has everything.
 */
export const ALL_PERMISSION_KEYS: string[] = STAFF_ASSIGNABLE_MODULES.flatMap(
  (m) => (m.siteScoped ? SITE_KEYS.map((s) => permKeyFor(m, s)) : [m.key])
);

/**
 * Modules that make up a SITE's dashboard — the ones whose data belongs
 * to one property.
 *
 * Everything else (Orders, Sellers, KYC, Refunds, Customers, Brands,
 * Categories, Staff, Media, Cache) is marketplace-wide: there is one
 * order book and one seller roster across both domains. Those modules
 * are shown only while the switcher is on the main site, so "switch to
 * Seller" gives a genuinely separate dashboard rather than the same
 * sidebar with two screens quietly rewired underneath.
 */
export const SITE_MODULES: AdminModule[] = MODULES.filter((m) => m.siteScoped);

/** True when this module should appear in the sidebar for `site`. */
export function moduleVisibleOnSite(m: AdminModule, site: SiteKeyLocal): boolean {
  return site === 'main' || !!m.siteScoped;
}

/**
 * True when `pathname` belongs to a marketplace-wide module, i.e. one
 * that is hidden while a non-main site is selected.
 *
 * Used by the URL guard so typing /orders with the switcher on Seller
 * doesn't land on a screen the sidebar is deliberately not offering.
 * Longest-prefix match, because `/pages` and `/pages/redirects` must
 * both resolve to the `pages` module rather than the first one whose
 * href happens to be a prefix.
 */
export function isPlatformOnlyPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const match = [...MODULES]
    .filter((m) => pathname === m.href || pathname.startsWith(`${m.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match ? !match.siteScoped : false;
}

/** Reverse lookup: permission key → { module, site }. Used to render
 *  human-readable chips ("Pages · Seller") in the staff list. */
export const MODULE_BY_PERMISSION: Record<
  string,
  { module: AdminModule; site: SiteKeyLocal }
> = Object.fromEntries(
  STAFF_ASSIGNABLE_MODULES.flatMap((m) =>
    (m.siteScoped ? SITE_KEYS : (['main'] as const)).map((s) => [
      permKeyFor(m, s),
      { module: m, site: s },
    ])
  )
);
