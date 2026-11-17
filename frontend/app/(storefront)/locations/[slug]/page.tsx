import { SITE_URL } from '@/lib/siteUrl';
/**
 * Dynamic page namespace for parent-less pages — `/locations/<slug>`.
 *
 * Used by admin-created pages that aren't nested under a category
 * (e.g. "Riders in Bangalore" without picking a parent category).
 * Same resolve + render flow as the [parentSlug]/[pageSlug] route,
 * minus the parent-slug part.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import DynamicPage from '@/components/pages/DynamicPage';
import { resolvePage } from '@/lib/pageResolver';



type RouteParams = { slug: string };

export async function generateMetadata(
  { params }: { params: Promise<RouteParams> }
): Promise<Metadata> {
  const { slug } = await params;
  const page = await resolvePage(undefined, slug);
  if (!page) return { title: 'Not found' };
  const title = page.seoTitle || `${page.title} · THROTTLEIN`;
  const description = page.seoDescription || undefined;
  const canonical = `${SITE_URL}/locations/${slug}`;
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

export default async function LocationPage(
  { params }: { params: Promise<RouteParams> }
) {
  const { slug } = await params;
  const page = await resolvePage(undefined, slug);
  if (!page) notFound();
  return <DynamicPage page={page} />;
}
