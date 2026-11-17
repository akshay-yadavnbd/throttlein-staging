import type { Metadata } from 'next';
import { BlogIndexContent, fetchCategories } from '@/components/blog/blogRouteShared';
import { originForSite } from '@/lib/site';

/**
 * MAIN-site blog category archive — throttlein.com/blog/category/<slug>.
 *
 * Mirror of `app/seller/blog/category/[slug]/page.tsx` with `site="main"`.
 * Both delegate to the same `BlogIndexContent`, so the two archives are
 * the same code with one literal changed.
 *
 * Previously this file carried forked copies of `fetchCategories` and
 * `fetchPosts` (neither sending `?site=`) plus its own inline render of
 * `BlogIndexPage` — see the note in `app/blog/page.tsx` for why that was
 * worth collapsing.
 */

type RouteProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const categories = await fetchCategories('main');
  const match = categories.find((c: { slug: string }) => c.slug === slug);
  const name = match?.name || slug;
  const title = `${name} · Blog · THROTTLEIN`;
  const description = `Posts in the ${name} category — riding tips, gear reviews, and buyer's guides from THROTTLEIN.`;
  // originForSite('main') rather than SITE_URL so both properties derive
  // their canonical the same way.
  const canonical = `${originForSite('main')}/blog/category/${slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      siteName: 'THROTTLEIN',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function Page({ params, searchParams }: RouteProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const pageNum = Math.max(1, Number(sp?.page) || 1);
  return <BlogIndexContent site="main" pageNum={pageNum} categorySlug={slug} />;
}
