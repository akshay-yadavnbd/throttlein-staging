import { sitemapSectionResponse } from '@/lib/sitemaps';

/** `/sitemap-pages.xml` — see lib/sitemaps.ts for what goes in it. */
export const revalidate = 3600;

export function GET() {
  return sitemapSectionResponse('pages');
}
