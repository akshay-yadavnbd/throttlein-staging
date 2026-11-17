import type { Metadata } from 'next';
import { BlogIndexContent } from '@/components/blog/blogRouteShared';
import { buildStaticPageMetadata } from '@/lib/staticMeta';
import { originForSite } from '@/lib/site';
import { BLOG_BASE } from '@/lib/blogUrl';

/**
 * SELLER-property blog index.
 *
 * Public URL:    seller.throttlein.com/seller-blogs
 * Internal path: /seller/blog   (rewritten by proxy.ts)
 *
 * SEO meta is editable from Admin → (switch to Seller) → Pages →
 * "Seller blog", backed by a `site='seller', staticRoute='/blog'`
 * record. The strings below are the fallback when no override exists.
 */

export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    site: 'seller',
    // `route` is the ADMIN LOOKUP KEY (staticRoute on the Page record),
    // not the public URL — it stays '/blog' so the existing override
    // record keeps resolving after the rename.
    route: '/blog',
    // …but the canonical must be the PUBLIC url. Without this override
    // it defaults to origin + route, so the page canonicalised to
    // /blog — a URL that now 301s to /seller-blogs, which makes the
    // canonical point away from the page declaring it.
    canonical: `${originForSite('seller')}${BLOG_BASE.seller}`,
    defaultTitle: 'Seller Blog · THROTTLEIN',
    defaultDescription:
      'Guides, updates and best practices for sellers on THROTTLEIN — listing, pricing, shipping and growing your store.',
    siteName: 'THROTTLEIN Sellers',
  });
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const pageNum = Math.max(1, Number(sp?.page) || 1);
  return <BlogIndexContent site="seller" pageNum={pageNum} />;
}
