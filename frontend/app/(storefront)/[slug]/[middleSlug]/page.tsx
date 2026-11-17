import { SITE_URL } from '@/lib/siteUrl';
/**
 * 2-segment dynamic page — `/<parent-cat-slug>/<page-slug>`.
 *
 * Despite the folder being called `[middleSlug]`, this file handles the
 * "middle = page slug" case (no brand in URL). The folder is named
 * generically so its sibling `[middleSlug]/[pageSlug]/page.tsx` (the
 * 3-seg `/<cat>/<brand>/<slug>` variant) can coexist — Next.js requires
 * sibling dynamic segments to share the same parameter name.
 *
 * Flow:
 *   1. Resolve <slug, middleSlug=pageSlug> via /api/pages/resolve.
 *   2. The resolver also requires `filter.brand` to be null on the
 *      matched Page — that's what keeps 2-seg URLs from accidentally
 *      rendering pages meant for the 3-seg shape.
 *   3. If miss → notFound() (renders the global 404 boundary).
 *   4. Otherwise render <DynamicPage page={...} /> with the page's
 *      template (products-list / brands-list / etc.).
 *
 * `generateMetadata` runs the same resolver server-side so SEO meta is
 * correct on first paint and to search engine crawlers.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import DynamicPage from '@/components/pages/DynamicPage';
import { resolvePage } from '@/lib/pageResolver';



type RouteParams = { slug: string; middleSlug: string };

export async function generateMetadata(
  { params }: { params: Promise<RouteParams> }
): Promise<Metadata> {
  const { slug, middleSlug } = await params;
  // 2-seg URL — middleSlug acts as the page slug; no brand in the URL.
  const page = await resolvePage(slug, middleSlug);
  if (!page) return { title: 'Not found' };
  const title = page.seoTitle || `${page.title} · THROTTLEIN`;
  const description = page.seoDescription || undefined;
  const canonical = `${SITE_URL}/${slug}/${middleSlug}`;
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

export default async function ParentChildPage(
  { params }: { params: Promise<RouteParams> }
) {
  const { slug, middleSlug } = await params;
  const page = await resolvePage(slug, middleSlug);
  if (!page) notFound();
  return <DynamicPage page={page} />;
}
