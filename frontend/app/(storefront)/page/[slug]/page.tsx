import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ProsePage from '@/components/pages/ProsePage';
import JsonLd from '@/components/seo/JsonLd';
import { API_URL, dataOf } from '@/lib/api';
import { SITE_URL } from '@/lib/siteUrl';

/**
 * Prose route — `/page/<slug>` (previously `/p/<slug>`).
 *
 * Promoted from a thin client passthrough to a full server component
 * so the title, description, and body land in the initial HTML
 * (View Source / crawlers). The page body is the entire SEO surface
 * of these long-form prose pages, so SSR is essential.
 */

type RouteProps = { params: Promise<{ slug: string }> };

type Page = {
  _id: string;
  slug: string;
  title: string;
  body?: string;
  seoTitle?: string;
  seoDescription?: string;
  isPublished?: boolean;
  updatedAt?: string;
  createdAt?: string;
};

/** Server-side fetch helper. 60-second ISR cache so admin edits surface
 *  without forcing a full rebuild. Returns null on 404 / failure so the
 *  page can fall through to next/navigation's notFound(). */
async function fetchProsePage(slug: string): Promise<Page | null> {
  try {
    const res = await fetch(`${API_URL}/pages/${encodeURIComponent(slug)}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = dataOf(await res.json());
    return data?.page || null;
  } catch {
    return null;
  }
}

/** Strip HTML for plain-text description / OG fallback. */
function stripHtml(s?: string): string {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await fetchProsePage(slug);
  if (!page) return {};

  const title = (page.seoTitle?.trim()) || page.title || 'THROTTLEIN';
  const description =
    (page.seoDescription?.trim()) ||
    stripHtml(page.body).slice(0, 160) ||
    undefined;
  const canonical = `${SITE_URL}/page/${page.slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title,
      description,
      url: canonical,
      siteName: 'THROTTLEIN',
      locale: 'en_IN',
      modifiedTime: page.updatedAt || undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function Page(props: RouteProps) {
  const { slug } = await props.params;
  const page = await fetchProsePage(slug);
  if (!page) notFound();

  // WebPage / Article JSON-LD — gives Google the page hierarchy + dates
  // so it can position the page in the SERP correctly.
  const articleJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    ...(stripHtml(page.body)
      ? { description: stripHtml(page.body).slice(0, 200) }
      : {}),
    url: `${SITE_URL}/page/${page.slug}`,
    ...(page.updatedAt ? { dateModified: page.updatedAt } : {}),
    ...(page.createdAt ? { datePublished: page.createdAt } : {}),
    inLanguage: 'en-IN',
    publisher: {
      '@type': 'Organization',
      name: 'THROTTLEIN',
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/images/throttlein-logo.png`,
      },
    },
  };

  return (
    <>
      <JsonLd data={articleJsonLd} />
      {/* Pass the SSR-fetched page down so the H1 (title) and body
          are present in the initial HTML. */}
      <ProsePage {...(props as any)} initialPage={page} />
    </>
  );
}
