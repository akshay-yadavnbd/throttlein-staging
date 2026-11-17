/**
 * Main-site sitemaps — split into a sitemap INDEX plus one file per section.
 *
 *   /sitemap.xml                → <sitemapindex> listing the files below
 *   /sitemap-pages.xml          → home, /products, /brands, /blog, /shop-by-bike, about,
 *                                 contact, faqs, admin dynamic + prose pages
 *   /sitemap-categories.xml     → every active category (minus the Shop-by-Bike subtree)
 *   /sitemap-products.xml       → every active product detail page
 *   /sitemap-blog.xml           → every published main-site post
 *   /sitemap-brands.xml         → every active brand
 *   /sitemap-shop-by-bike.xml   → the bike make/model categories under Shop by Bike
 *
 * Each file is a route handler under app/<name>/route.ts that calls into
 * this module. This used to be a single `app/sitemap.ts`; Next's
 * convention file can't produce an index with custom file names, so the
 * logic moved here unchanged and is now split by section.
 *
 * The seller property has its own sitemap (app/seller/sitemap.xml/route.ts,
 * reached via the rewrite in proxy.ts) and is not affected by this file.
 *
 * Errors from the backend (e.g. dev API down) degrade gracefully — we
 * still emit the static entries instead of failing the whole sitemap.
 */

import { API_URL, dataOf } from '@/lib/api';
import { SITE_URL } from '@/lib/siteUrl';
import { resolveLegacyPath } from '@/lib/legacyRedirects';

export type SitemapSection =
  | 'pages'
  | 'categories'
  | 'products'
  | 'blog'
  | 'brands'
  | 'shop-by-bike';

/** Order here is the order the index lists them in. */
export const SITEMAP_SECTIONS: SitemapSection[] = [
  'pages',
  'categories',
  'products',
  'blog',
  'brands',
  'shop-by-bike',
];

type SitemapEntry = {
  url: string;
  lastModified?: Date;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
};

/** Paths deliberately kept out of every sitemap. */
const EXCLUDED_PATHS = new Set<string>([
  '/blog/ecommerce-marketplace/best-marketplace-to-sell-bike-accessories-in-india',
  '/blog/seller-guide/how-to-become-a-seller-on-throttlein-and-reach-riders-who-are-already-buying',
  '/mobile-holders/mobile-holders',
]);

/** Slug of the category whose subtree powers /shop-by-bike. */
const SHOP_BY_BIKE_SLUG = 'shop-by-bike';

/** Safety cap on product pagination (PRODUCT_PAGE_SIZE × this). */
const PRODUCT_PAGE_SIZE = 500;
const PRODUCT_MAX_PAGES = 100;

/** Coerce any timestamp-ish value into a Date for `lastModified`. */
function toDate(v?: string | number | Date): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Walk a category tree, returning every active node's slug that has
 *  products. `hasProducts` comes from `/categories?hasProducts=1` and is
 *  true when the node OR any descendant has a visible product (active,
 *  approved seller; bike nodes count via the product's `bike` field).
 *  Only an explicit `false` excludes, so an older API without the flag
 *  still lists everything rather than nothing. */
function flattenCategorySlugs(nodes: any[]): string[] {
  const out: string[] = [];
  const visit = (n: any) => {
    if (!n) return;
    if (n.isActive !== false && n.hasProducts !== false && n.slug) out.push(n.slug);
    (n.children || []).forEach(visit);
  };
  (nodes || []).forEach(visit);
  return out;
}

/** Find a node anywhere in the category tree by slug. */
function findCategoryNode(nodes: any[], slug: string): any | null {
  for (const n of nodes || []) {
    if (n?.slug === slug) return n;
    const hit = findCategoryNode(n?.children || [], slug);
    if (hit) return hit;
  }
  return null;
}

/** Build the blog post's URL — mirrors the storefront's blog routing. */
function blogUrlFor(post: any): string {
  const chain = (post?.categoryChain || [])
    .map((c: any) => c?.slug)
    .filter(Boolean);
  const slug = post?.slug;
  if (!slug) return '';
  return chain.length > 0
    ? `${SITE_URL}/blog/${chain.join('/')}/${slug}`
    : `${SITE_URL}/blog/${slug}`;
}

/** Build the admin-managed dynamic page URL.
 *  - New-style top-level pages (no parentCategory) live at /<slug>.
 *  - Legacy pages keep their /<cat>/<slug> (or /<cat>/<brand>/<slug>)
 *    shape so their indexed URLs stay valid. */
function dynamicPageUrl(p: any): string | null {
  if (!p?.slug) return null;
  const catSlug = p?.parentCategory?.slug;
  if (!catSlug) return `${SITE_URL}/${p.slug}`;
  const brandSlug = p?.filter?.brand?.slug;
  return brandSlug
    ? `${SITE_URL}/${catSlug}/${brandSlug}/${p.slug}`
    : `${SITE_URL}/${catSlug}/${p.slug}`;
}

async function safeFetchJson(url: string): Promise<any> {
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return dataOf(await res.json());
  } catch {
    return null;
  }
}

/** Every active product detail page — `/product/<slug>` (matches the
 *  canonical in app/(storefront)/product/[slug]/page.tsx). Paginated so
 *  a growing catalogue doesn't need one huge response. */
async function fetchProductEntries(now: Date): Promise<SitemapEntry[]> {
  const out: SitemapEntry[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= PRODUCT_MAX_PAGES; page++) {
    const data = await safeFetchJson(
      `${API_URL}/products?limit=${PRODUCT_PAGE_SIZE}&page=${page}&sort=newest`,
    );
    const items: any[] = data?.items || [];
    for (const p of items) {
      if (!p?.slug || seen.has(p.slug)) continue;
      seen.add(p.slug);
      out.push({
        url: `${SITE_URL}/product/${p.slug}`,
        lastModified: toDate(p.updatedAt) || toDate(p.createdAt) || now,
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
    const pages = Number(data?.pages) || 0;
    if (items.length === 0 || page >= pages) break;
  }
  return out;
}

/**
 * Build every section's entries.
 *
 * Built together (rather than per section) so the cross-section
 * de-duplication and the derived `lastmod` of the hand-coded listing
 * routes behave exactly as they did in the single-file sitemap.
 * Products are only fetched when asked for — they're the one expensive
 * source and never collide with any other section's URLs.
 */
async function buildSections(
  opts: { includeProducts: boolean },
): Promise<Record<SitemapSection, SitemapEntry[]>> {
  const now = new Date();

  /* ─── Static routes ──────────────────────────────────────────────
   * `lastModified: now` values are PLACEHOLDERS — recomputed (or
   * dropped) further down by `datedStatic`. Each is tagged with the
   * section file it belongs to. */
  const staticEntries: Array<{ section: SitemapSection; entry: SitemapEntry }> = [
    { section: 'pages',        entry: { url: `${SITE_URL}/`,             lastModified: now, changeFrequency: 'daily',   priority: 1.0 } },
    { section: 'pages',        entry: { url: `${SITE_URL}/products`,     lastModified: now, changeFrequency: 'daily',   priority: 0.9 } },
    { section: 'pages',        entry: { url: `${SITE_URL}/brands`,       lastModified: now, changeFrequency: 'weekly',  priority: 0.7 } },
    { section: 'pages',        entry: { url: `${SITE_URL}/shop-by-bike`, lastModified: now, changeFrequency: 'weekly',  priority: 0.6 } },
    { section: 'pages',        entry: { url: `${SITE_URL}/blog`,         lastModified: now, changeFrequency: 'daily',   priority: 0.7 } },
    { section: 'pages',        entry: { url: `${SITE_URL}/about`,        lastModified: now, changeFrequency: 'monthly', priority: 0.5 } },
    { section: 'pages',        entry: { url: `${SITE_URL}/contact`,      lastModified: now, changeFrequency: 'monthly', priority: 0.5 } },
    { section: 'pages',        entry: { url: `${SITE_URL}/faqs`,         lastModified: now, changeFrequency: 'monthly', priority: 0.5 } },
    // NOT listed: the seller property's origin — a sitemap may only list
    // URLs on its own host. The seller host has its own sitemap.
  ];

  // ─── Brands ────────────────────────────────────────────────────
  const brandEntries: SitemapEntry[] = [];
  // `withProducts=1` drops brands with no active products — the same
  // filter the /brands index page uses.
  const brandsData = await safeFetchJson(`${API_URL}/brands?active=1&withProducts=1`);
  for (const b of brandsData?.items || brandsData?.brands || []) {
    if (!b?.slug) continue;
    brandEntries.push({
      url: `${SITE_URL}/brands/${b.slug}`,
      lastModified: toDate(b.updatedAt) || now,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }

  // ─── Categories (split: regular vs Shop-by-Bike subtree) ──────
  // Slugs are resolved through the shared redirect table before being
  // emitted, so a category whose URL is 308'd away isn't listed under
  // its retired slug (Search Console treats redirecting entries as soft
  // errors). Two retired slugs can collapse onto one URL, hence dedupe.
  const categoryEntries: SitemapEntry[] = [];
  const bikeEntries: SitemapEntry[] = [];
  // `hasProducts=1` annotates each node so empty categories (and bike
  // makes/models with nothing fitted) are left out — see flattenCategorySlugs.
  const catsData = await safeFetchJson(`${API_URL}/categories?hasProducts=1`);
  const tree: any[] = catsData?.tree || [];
  const catUpdatedBySlug = new Map<string, string | undefined>();
  const collectCatDates = (nodes: any[]) => {
    for (const n of nodes || []) {
      if (n?.slug) catUpdatedBySlug.set(String(n.slug), n.updatedAt);
      if (Array.isArray(n?.children)) collectCatDates(n.children);
    }
  };
  collectCatDates(tree);

  // Everything under the Shop-by-Bike node (bike makes and models) goes
  // to its own file. The node itself is the hand-coded /shop-by-bike.
  const bikeNode = findCategoryNode(tree, SHOP_BY_BIKE_SLUG);
  const bikeSlugs = new Set<string>([
    SHOP_BY_BIKE_SLUG,
    ...flattenCategorySlugs(bikeNode?.children || []),
  ]);

  const seenCategoryUrls = new Set<string>();
  for (const slug of flattenCategorySlugs(tree)) {
    const url = `${SITE_URL}${resolveLegacyPath(`/${slug}`)}`;
    if (seenCategoryUrls.has(url)) continue;
    seenCategoryUrls.add(url);
    (bikeSlugs.has(slug) ? bikeEntries : categoryEntries).push({
      url,
      lastModified: toDate(catUpdatedBySlug.get(slug)) || now,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }

  // ─── Blog posts ────────────────────────────────────────────────
  // `site=main` is REQUIRED: without it the API also returns seller
  // posts, which would be emitted here under URLs that 404.
  const blogEntries: SitemapEntry[] = [];
  const blogData = await safeFetchJson(`${API_URL}/blog?limit=500&site=main`);
  for (const post of blogData?.items || blogData?.posts || []) {
    const url = blogUrlFor(post);
    if (!url) continue;
    blogEntries.push({
      // `contentUpdatedAt` first — `updatedAt` moves on every write,
      // including the view counter, so it's only a last resort.
      url,
      lastModified:
        toDate(post.contentUpdatedAt) ||
        toDate(post.publishedAt) ||
        toDate(post.updatedAt) ||
        now,
      changeFrequency: 'monthly',
      priority: 0.6,
    });
  }

  // ─── Admin-managed dynamic pages ──────────────────────────────
  const dynamicEntries: SitemapEntry[] = [];
  const pagesData = await safeFetchJson(`${API_URL}/pages?type=dynamic&site=main`);
  for (const p of pagesData?.items || []) {
    const url = dynamicPageUrl(p);
    if (!url) continue;
    dynamicEntries.push({
      url,
      lastModified: toDate(p.updatedAt) || now,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }

  // ─── Prose pages — root-level `/<slug>` ───────────────────────
  const proseEntries: SitemapEntry[] = [];
  const prosePagesData = await safeFetchJson(`${API_URL}/pages?type=prose&site=main`);
  for (const p of prosePagesData?.items || []) {
    if (!p?.slug) continue;
    proseEntries.push({
      url: `${SITE_URL}/${p.slug}`,
      lastModified: toDate(p.updatedAt) || now,
      changeFrequency: 'monthly',
      priority: 0.4,
    });
  }

  // ─── Products (only when needed) ──────────────────────────────
  const productEntries = opts.includeProducts ? await fetchProductEntries(now) : [];

  /* ── Real `lastmod` for the hand-coded routes ────────────────────
   * 1. The admin's static-meta record for that exact route, if any.
   * 2. For listing pages, the newest date among the things they list.
   * Anything with neither gets NO lastmod (valid and truthful) rather
   * than an always-"now" value crawlers learn to ignore. */
  const metaData = await safeFetchJson(`${API_URL}/pages?type=static-meta&site=main`);
  const metaByRoute = new Map<string, string | undefined>();
  for (const p of metaData?.items || []) {
    const route = String(p?.staticRoute || '').trim();
    if (route) metaByRoute.set(route.replace(/\/+$/, '') || '/', p.updatedAt);
  }

  const newestOf = (entries: SitemapEntry[]): Date | undefined => {
    let best: Date | undefined;
    for (const e of entries) {
      const d = e.lastModified ? new Date(e.lastModified) : null;
      if (d && !Number.isNaN(d.getTime()) && (!best || d > best)) best = d;
    }
    return best;
  };
  const newestBlog = newestOf(blogEntries);
  const newestBrand = newestOf(brandEntries);
  const newestCategory = newestOf([...categoryEntries, ...bikeEntries]);
  const newestAnywhere = newestOf([
    ...blogEntries, ...brandEntries, ...categoryEntries, ...bikeEntries,
    ...dynamicEntries, ...proseEntries,
  ]);

  const derivedFor = (url: string): Date | undefined => {
    const path = url.replace(SITE_URL, '').replace(/\/+$/, '') || '/';
    const fromMeta = toDate(metaByRoute.get(path));
    let fromContent: Date | undefined;
    switch (path) {
      case '/':              fromContent = newestAnywhere; break;
      case '/blog':          fromContent = newestBlog; break;
      case '/brands':        fromContent = newestBrand; break;
      case '/products':
      case '/shop-by-bike':  fromContent = newestCategory; break;
      default:               fromContent = undefined;
    }
    if (fromMeta && fromContent) return fromMeta > fromContent ? fromMeta : fromContent;
    return fromMeta || fromContent;
  };

  const datedStatic = staticEntries.map(({ section, entry }) => {
    const derived = derivedFor(entry.url);
    const { lastModified, ...rest } = entry;
    return { section, entry: derived ? { ...rest, lastModified: derived } : rest };
  });

  /* ── Global de-duplication + exclusions ──────────────────────────
   * Same order as the old single sitemap, so the first writer still
   * wins (e.g. the hand-coded /shop-by-bike beats its category row). */
  const tag = (section: SitemapSection, list: SitemapEntry[]) =>
    list.map((entry) => ({ section, entry }));
  const all = [
    ...datedStatic,
    ...tag('brands', brandEntries),
    ...tag('categories', categoryEntries),
    ...tag('shop-by-bike', bikeEntries),
    ...tag('blog', blogEntries),
    ...tag('pages', dynamicEntries),
    ...tag('pages', proseEntries),
    ...tag('products', productEntries),
  ];

  const out: Record<SitemapSection, SitemapEntry[]> = {
    pages: [], categories: [], products: [], blog: [], brands: [], 'shop-by-bike': [],
  };
  const seen = new Set<string>();
  for (const { section, entry } of all) {
    // Normalise trailing slashes so `/x` and `/x/` can't both survive.
    const key = String(entry.url).replace(/\/+$/, '') || '/';
    if (EXCLUDED_PATHS.has(key.replace(SITE_URL, '') || '/')) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out[section].push(entry);
  }
  return out;
}

/* ─── XML output ──────────────────────────────────────────────────── */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlsetXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const parts = [`    <loc>${xmlEscape(e.url)}</loc>`];
      if (e.lastModified) parts.push(`    <lastmod>${e.lastModified.toISOString()}</lastmod>`);
      if (e.changeFrequency) parts.push(`    <changefreq>${e.changeFrequency}</changefreq>`);
      if (e.priority !== undefined) parts.push(`    <priority>${e.priority.toFixed(1)}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function xmlResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  });
}

/** Public URL of one section's sitemap file. */
export function sitemapUrlFor(section: SitemapSection): string {
  return `${SITE_URL}/sitemap-${section}.xml`;
}

/** Response for `/sitemap-<section>.xml`. */
export async function sitemapSectionResponse(section: SitemapSection): Promise<Response> {
  const sections = await buildSections({ includeProducts: section === 'products' });
  return xmlResponse(urlsetXml(sections[section]));
}

/** Response for `/sitemap.xml` — the sitemap index. Each child's
 *  `lastmod` is the newest entry inside it (omitted when unknown). */
export async function sitemapIndexResponse(): Promise<Response> {
  const sections = await buildSections({ includeProducts: true });
  const items = SITEMAP_SECTIONS.map((section) => {
    let newest: Date | undefined;
    for (const e of sections[section]) {
      if (e.lastModified && (!newest || e.lastModified > newest)) newest = e.lastModified;
    }
    const parts = [`    <loc>${xmlEscape(sitemapUrlFor(section))}</loc>`];
    if (newest) parts.push(`    <lastmod>${newest.toISOString()}</lastmod>`);
    return `  <sitemap>\n${parts.join('\n')}\n  </sitemap>`;
  }).join('\n');
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`,
  );
}
