import { SITE_URL } from '@/lib/siteUrl';
/**
 * 3-segment dynamic page — `/<cat>/<brand>/<page-slug>`.
 *
 * Used when an admin pins both Category and Brand on a Page. Example:
 *   /helmets-and-accessories/ls2/ls2-helmet-in-noida
 *
 * Strict matching: the resolver requires `filter.brand` on the Page to
 * equal the brand named by `middleSlug`. The sibling 2-seg route
 * (`[middleSlug]/page.tsx`) only resolves pages WITHOUT a brand, so the
 * two URL shapes don't shadow each other.
 *
 * `middleSlug` is the brand slug in this route — the folder name stays
 * generic because Next.js requires sibling dynamic segments under the
 * same parent to share their parameter name.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import DynamicPage from '@/components/pages/DynamicPage';
import { resolvePage } from '@/lib/pageResolver';



type RouteParams = { slug: string; middleSlug: string; pageSlug: string };

export async function generateMetadata(
  { params }: { params: Promise<RouteParams> }
): Promise<Metadata> {
  const { slug, middleSlug, pageSlug } = await params;
  // middleSlug is the brand in the 3-seg URL shape.
  const page = await resolvePage(slug, pageSlug, middleSlug);
  if (!page) return { title: 'Not found' };
  const title = page.seoTitle || `${page.title} · THROTTLEIN`;
  const description = page.seoDescription || undefined;
  const canonical = `${SITE_URL}/${slug}/${middleSlug}/${pageSlug}`;
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
      ...(page.ogImage ? { images: [{ url: page.ogImage }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(page.ogImage ? { images: [page.ogImage] } : {}),
    },
  };
}

export default async function CategoryBrandPage(
  { params }: { params: Promise<RouteParams> }
) {
  const { slug, middleSlug, pageSlug } = await params;
  const page = await resolvePage(slug, pageSlug, middleSlug);
  if (!page) notFound();
  return <DynamicPage page={page} />;
}
