/**
 * Server-side helper for resolving admin-managed Pages by their public URL.
 *
 * Used by the catch-all dynamic-page routes:
 *   /app/[parentSlug]/[pageSlug]/page.tsx  → resolves with both args
 *   /app/locations/[slug]/page.tsx         → resolves with slug only
 *
 * Hits the backend's /api/pages/resolve endpoint (see pageController.js).
 * Returns the populated Page document (parentCategory, filter.category,
 * filter.brand are populated to {name, slug, logo}) — or null on miss.
 *
 * Stays a server-only module so we can call notFound() from the route
 * page and still have generateMetadata read the same record.
 */

// Backend origin — `API_URL` env mirrors the client lib so both ends agree.
// Defaults to the dev backend when nothing is set.
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

import type { SiteKey } from './site';
import { dataOf } from './api';

export type ResolvedPage = {
  _id: string;
  site?: SiteKey;
  slug: string;
  title: string;
  type: 'home' | 'prose' | 'dynamic' | 'static-meta';
  /** Must stay in step with `VALID_TEMPLATES` in
   *  backend/src/controllers/pageController.js and the `template` enum in
   *  backend/src/models/Page.js. 'seller-category' is the seller
   *  property's landing-page template, served at /sell-online/<slug>. */
  template?: 'products-list' | 'brands-list' | 'categories-list' | 'seller-category' | 'seller-category-2';
  body?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogImage?: string;
  // On-page content — Top Content replaces the heading + intro line;
  // Bottom Content (title + rich-text HTML) renders after the grid.
  contentTitle?: string;
  contentDescription?: string;
  bottomTitle?: string;
  bottomDescription?: string;
  isPublished: boolean;
  parentCategory?: { _id: string; name: string; slug: string } | null;
  filter?: {
    category?: { _id: string; name: string; slug: string } | null;
    brand?: { _id: string; name: string; slug: string; logo?: string } | null;
    // Multi-select variants — `category`/`brand` above stay the primary
    // single picks (URL-driving); these arrays hold the full selection
    // when the admin aggregates several categories/brands on one page.
    categories?: { _id: string; name: string; slug: string }[];
    brands?: { _id: string; name: string; slug: string; logo?: string }[];
    product?: string | null;
    locationLevel?: 'city' | 'state' | 'country' | '';
    locationValue?: string;
  };
  updatedAt?: string;
};

/**
 * Resolve a Page by parent-category slug + page slug. Pass parentSlug='' (or
 * undefined) to look up a parent-less page in the /locations/<slug> namespace.
 *
 * Optional `brandSlug` narrows further to the /cat/brand/page 3-segment
 * URL shape — pages with filter.brand matching show up; everything else
 * returns null so the 2-seg and 3-seg URLs don't shadow each other.
 *
 * `no-store` is set so the storefront always reflects the latest admin
 * edits — we can swap to ISR (`next: { revalidate: 60 }`) later if traffic
 * justifies the cache hit.
 */
export async function resolvePage(
  parentSlug: string | undefined,
  slug: string,
  brandSlug?: string,
  /** Which property to resolve against. Defaults to the main site so
   *  every existing call site keeps its current behaviour. */
  site: SiteKey = 'main'
): Promise<ResolvedPage | null> {
  if (!slug) return null;
  const params = new URLSearchParams();
  if (parentSlug) params.set('parent', parentSlug);
  if (brandSlug) params.set('brand', brandSlug);
  params.set('slug', slug);
  params.set('site', site);
  try {
    const res = await fetch(`${API}/pages/resolve?${params.toString()}`, {
      cache: 'no-store',
      /**
       * Node's `fetch` has NO default timeout. Without this, a backend
       * that is slow rather than down doesn't produce a caught error — it
       * hangs the render until the platform gateway gives up, which the
       * visitor sees as a spinning tab and then a raw 504, with no error
       * boundary and nothing in the logs to attribute it to.
       *
       * This call is the most exposed one on the property: `no-store`, so
       * every request hits the API, and `resolve()` runs it twice per
       * request (generateMetadata + the page body). 8s is comfortably
       * above a healthy p99 while still failing fast enough to render the
       * 404 rather than time the whole request out.
       */
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = dataOf(await res.json());
    return (json.page as ResolvedPage) || null;
  } catch {
    // Includes the TimeoutError from the signal above.
    return null;
  }
}
