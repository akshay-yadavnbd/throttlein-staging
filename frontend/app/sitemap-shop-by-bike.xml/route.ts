import { sitemapSectionResponse } from '@/lib/sitemaps';

/** `/sitemap-shop-by-bike.xml` — see lib/sitemaps.ts for what goes in it. */
export const revalidate = 3600;

export function GET() {
  return sitemapSectionResponse('shop-by-bike');
}
