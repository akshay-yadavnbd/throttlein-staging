import { sitemapIndexResponse } from '@/lib/sitemaps';

/**
 * Main-site sitemap INDEX (`/sitemap.xml`) — lists the per-section
 * sitemap files. Referenced from app/robots.ts. All logic lives in
 * lib/sitemaps.ts.
 *
 * On the seller host, proxy.ts rewrites /sitemap.xml to
 * app/seller/sitemap.xml/route.ts before it ever reaches this file.
 */
export const revalidate = 3600;

export function GET() {
  return sitemapIndexResponse();
}
