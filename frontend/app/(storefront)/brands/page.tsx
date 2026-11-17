import { SITE_URL } from '@/lib/siteUrl';
import { API_URL, dataOf } from '@/lib/api';
import type { Metadata } from 'next';
import BrandsIndexPage from '@/components/pages/BrandsIndexPage';
import JsonLd from '@/components/seo/JsonLd';
import { buildStaticPageMetadata } from '@/lib/staticMeta';

// Admin can override at /pages → Brands index via Edit meta.
export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    route: '/brands',
    defaultTitle: 'Brands · THROTTLEIN',
    defaultDescription:
      'Browse every motorcycle brand on THROTTLEIN — helmets, jackets, lights, luggage, accessories. From global names to homegrown specialists.',
  });
}

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
    { '@type': 'ListItem', position: 2, name: 'Brands', item: `${SITE_URL}/brands` },
  ],
};

async function fetchBrands() {
  try {
    // withProducts=1 — the index only lists brands with ≥1 active product.
    const r = await fetch(`${API_URL}/brands?active=1&withProducts=1`, { next: { revalidate: 300 } });
    if (!r.ok) return [];
    const d = dataOf(await r.json());
    return Array.isArray(d?.items) ? d.items : [];
  } catch {
    return [];
  }
}

export default async function Page() {
  const brands = await fetchBrands();

  // ItemList JSON-LD — exposes the full brand catalogue to Google's
  // structured-data parser. `url` lets crawlers follow each brand page.
  const itemListJsonLd =
    brands.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'THROTTLEIN brands',
          numberOfItems: brands.length,
          itemListElement: brands.map((b: { name: string; slug?: string }, i: number) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: b.name,
            url: `${SITE_URL}/brands/${b.slug || ''}`,
          })),
        }
      : null;

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      {itemListJsonLd && <JsonLd data={itemListJsonLd} />}
      <BrandsIndexPage initialBrands={brands} />
    </>
  );
}
