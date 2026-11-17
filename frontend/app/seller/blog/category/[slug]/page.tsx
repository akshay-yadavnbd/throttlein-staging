import type { Metadata } from 'next';
import { BlogIndexContent, fetchCategories } from '@/components/blog/blogRouteShared';
import { originForSite } from '@/lib/site';
import { BLOG_BASE } from '@/lib/blogUrl';
import { DEFAULT_OG_IMAGE } from '@/lib/jsonLd';

/**
 * SELLER-property blog category archive.
 *
 * Public URL:    seller.throttlein.com/blog/category/<slug>
 * Internal path: /seller/blog/category/<slug>   (rewritten by proxy.ts)
 *
 * Note this route file must sit ABOVE `[...slug]` in specificity, which
 * Next handles automatically: a static segment ('category') always wins
 * over a catch-all at the same depth.
 */

type RouteProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const categories = await fetchCategories('seller');
  const match = categories.find((c: { slug: string }) => c.slug === slug);
  const name = match?.name || slug;
  const title = `${name} · Seller Blog · THROTTLEIN`;
  const description = `Posts in the ${name} category — guides and updates for THROTTLEIN sellers.`;
  // Public base is /seller-blogs after the rename — a `/blog/...`
  // canonical would point at a URL that 301s away from this page.
  const canonical = `${originForSite('seller')}${BLOG_BASE.seller}/category/${slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      siteName: 'THROTTLEIN Sellers',
      // Category archives have no image of their own — fall back to the
      // site hero so shares aren't bare text. Without this the
      // `summary_large_image` card below declares a format it supplies
      // no image for.
      images: [{ url: DEFAULT_OG_IMAGE }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

export default async function Page({ params, searchParams }: RouteProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const pageNum = Math.max(1, Number(sp?.page) || 1);
  return <BlogIndexContent site="seller" pageNum={pageNum} categorySlug={slug} />;
}
