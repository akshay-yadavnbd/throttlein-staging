import { SITE_URL } from '@/lib/siteUrl';
/**
 * All-products catalogue — `/products`.
 *
 * Server wrapper that emits SEO metadata + delegates rendering to the
 * shared `CategoryPage` in `allProductsMode`. SSR-fetches the first
 * page of products so the grid is in the initial HTML for crawlers.
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import CategoryPage from '@/components/pages/CategoryPage';
import JsonLd from '@/components/seo/JsonLd';
import { API_URL, dataOf } from '@/lib/api';
import { buildStaticPageMetadata } from '@/lib/staticMeta';

export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    route: '/products',
    defaultTitle: 'All Products — Helmets, Gear & Bike Parts · THROTTLEIN',
    defaultDescription:
      'Browse every motorcycle product on THROTTLEIN — helmets, riding gear, jackets, gloves, boots, bike parts, accessories. Filter by brand, size, price, and category.',
  });
}

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
    { '@type': 'ListItem', position: 2, name: 'All Products', item: `${SITE_URL}/products` },
  ],
};

async function fetchInitialProducts() {
  try {
    // Same query the client-side re-fetch uses (see CategoryPage) —
    // limit=96 + sort=newest — so the SSR-hydrated list matches the
    // list the client would fetch on hydration. Without this alignment
    // the page visibly reshuffles when the smaller SSR list is
    // replaced by the larger client list.
    //
    // `cache: 'no-store'` (fully dynamic) — SSR always sees the latest
    // catalogue. A new product created seconds ago shows up on the
    // next request. Prior 5-minute `revalidate` window made the SSR
    // data go stale, so the client re-fetch would add "missing" cards
    // like the Akrapovic exhaust the moment it hydrated, jerking the
    // grid around.
    const r = await fetch(
      `${API_URL}/products?limit=96&sort=newest`,
      { cache: 'no-store' },
    );
    if (!r.ok) return { items: [], total: 0 };
    const d = dataOf(await r.json());
    return {
      items: Array.isArray(d?.items) ? d.items : [],
      total: typeof d?.total === 'number' ? d.total : (d?.items?.length || 0),
    };
  } catch {
    return { items: [], total: 0 };
  }
}

const PAGE_TITLE = 'All Products';
const PAGE_DESCRIPTION =
  'Every motorcycle product on THROTTLEIN, filterable by brand, size, price, and category.';

/** Admin-authored on-page content for /products — Top Content (title +
 *  intro) and Bottom Content (title + rich-text SEO block) saved on the
 *  route's static-meta Page record. Nulls fall back to the defaults. */
async function fetchPageContent() {
  try {
    const r = await fetch(
      `${API_URL}/pages/static-meta?route=${encodeURIComponent('/products')}`,
      { next: { revalidate: 60 } },
    );
    if (!r.ok) return null;
    const d = dataOf(await r.json());
    return d?.override || null;
  } catch {
    return null;
  }
}

export default async function Page() {
  const [initial, content] = await Promise.all([
    fetchInitialProducts(),
    fetchPageContent(),
  ]);
  return (
    <div className="bg-white min-h-full">
      <JsonLd data={breadcrumbJsonLd} />
      <Suspense fallback={<AllProductsSkeleton />}>
        {/* CategoryPage owns the entire chrome on /products — breadcrumb,
            filter sidebar (left), and H1 + subtitle + sort + grid (right
            column). Server page only emits SEO metadata + JSON-LD. */}
        <CategoryPage
          allProductsMode
          titleOverride={content?.contentTitle?.trim() || PAGE_TITLE}
          descriptionOverride={content?.contentDescription?.trim() || PAGE_DESCRIPTION}
          bottomTitle={content?.bottomTitle?.trim() || undefined}
          bottomDescriptionHtml={content?.bottomDescription?.trim() || undefined}
          initialItems={initial.items}
          initialTotal={initial.total}
        />
      </Suspense>
    </div>
  );
}

function AllProductsSkeleton() {
  return (
    <div className="container">
      <div className="grid lg:grid-cols-[260px_minmax(0,1fr)] gap-5 lg:gap-6">
        <div className="h-96 bg-[#f3f4f2] rounded-2xl animate-pulse hidden lg:block" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-square bg-[#f3f4f2] rounded-xl animate-pulse" />
              <div className="mt-3 h-4 w-3/4 rounded bg-[#f3f4f2] animate-pulse" />
              <div className="mt-2 h-4 w-1/3 rounded bg-[#f3f4f2] animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
