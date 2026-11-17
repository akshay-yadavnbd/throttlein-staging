/**
 * Shop by Bike — `/shop-by-bike`.
 *
 * Server wrapper that emits SEO metadata + delegates rendering to the
 * client `<ShoByBikePage>`, which fetches the category tree and shows
 * the bike make/model tile grid.
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/siteUrl';
import ShoByBikePage from '@/components/pages/ShoByBikePage';
import JsonLd from '@/components/seo/JsonLd';
import { buildStaticPageMetadata } from '@/lib/staticMeta';

export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    route: '/shop-by-bike',
    defaultTitle: 'Shop by Bike — Find Parts & Gear for Your Motorcycle · THROTTLEIN',
    defaultDescription:
      'Browse THROTTLEIN by bike make and model to find the helmets, gear, and parts fitted to your motorcycle.',
  });
}

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
    { '@type': 'ListItem', position: 2, name: 'Shop by Bike', item: `${SITE_URL}/shop-by-bike` },
  ],
};

export default function Page() {
  return (
    <div className="bg-white min-h-full">
      <JsonLd data={breadcrumbJsonLd} />
      <Suspense fallback={<ShopByBikeSkeleton />}>
        <ShoByBikePage />
      </Suspense>
    </div>
  );
}

function ShopByBikeSkeleton() {
  return (
    <div className="container py-6 md:py-8">
      <div className="h-4 w-40 rounded bg-[#f3f4f2] animate-pulse mb-3" />
      <div className="h-8 w-56 rounded bg-[#f3f4f2] animate-pulse mb-6" />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-2xl bg-[#f3f4f2] animate-pulse" />
        ))}
      </div>
    </div>
  );
}
