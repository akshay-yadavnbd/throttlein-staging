import { sitemapSectionResponse } from '@/lib/sitemaps';

/** `/sitemap-categories.xml` — see lib/sitemaps.ts for what goes in it. */
export const revalidate = 3600;

export function GET() {
  return sitemapSectionResponse('categories');
}
