import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { API_URL, dataOf } from '@/lib/api';
import { SITE_URL } from '@/lib/siteUrl';
import { SELLER_ORIGIN } from '@/lib/sellerUrl';
import SellerGuideDetailPage from '@/components/pages/SellerGuideDetailPage';

/**
 * /seller/guide/<slug> — server-rendered guide detail.
 *
 * Resolves the guide server-side so crawlers see the real content +
 * SEO meta (metaTitle / metaDescription / ogImage) instead of a
 * skeleton. Also fetches up to 3 OTHER active guides so the detail
 * page's "More guides" block at the bottom has something to show.
 *
 * 404s when the slug is unknown OR when the guide is inactive (we
 * fetch via ?active=1 indirectly by 404ing on isActive === false).
 */

type RouteProps = { params: Promise<{ slug: string }> };

/** Convert a stored image key/path into an absolute URL suitable
 *  for Open Graph previews. Mirrors the helper in the blog catch-all
 *  route so the two SEO paths behave identically. */
function absoluteImageUrl(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${SITE_URL}${raw}`;
  const apiOrigin = API_URL.replace(/\/api$/, '');
  return `${apiOrigin}/api/files/${raw}`;
}

async function fetchGuide(slug: string) {
  try {
    const res = await fetch(
      `${API_URL}/seller-guides/${encodeURIComponent(slug)}`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    const data = dataOf(await res.json());
    const guide = data?.guide || null;
    // Don't surface inactive guides on the storefront — admins use the
    // active toggle as a soft-delete.
    if (guide && guide.isActive === false) return null;
    return guide;
  } catch {
    return null;
  }
}

/** Fetch up to 3 OTHER active guides for the "More guides" strip.
 *  Filters out the currently-viewed guide by id. */
async function fetchRelated(currentId: string | null) {
  try {
    const res = await fetch(
      `${API_URL}/seller-guides?active=1`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return [];
    const data = dataOf(await res.json());
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    return items
      .filter((g) => g && g._id !== currentId)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = await fetchGuide(slug);
  if (!guide) return {};

  const title =
    (guide.metaTitle?.trim()) ||
    `${guide.title} · Seller Guide · THROTTLEIN`;
  const description =
    (guide.metaDescription?.trim()) ||
    guide.shortDescription ||
    undefined;
  const ogImage =
    absoluteImageUrl(guide.ogImage) ||
    absoluteImageUrl(guide.image);
  // Canonical home of the guides is the seller subdomain in production
  // (throttlein.com/seller/guide/* 301s there); dev falls back to the
  // main-domain path.
  const canonical = SELLER_ORIGIN
    ? `${SELLER_ORIGIN}/guide/${guide.slug}`
    : `${SITE_URL}/seller/guide/${guide.slug}`;

  const meta: Metadata = {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title,
      description,
      url: canonical,
      siteName: 'THROTTLEIN',
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };

  return meta;
}

export default async function Page({ params }: RouteProps) {
  const { slug } = await params;
  const guide = await fetchGuide(slug);
  if (!guide) notFound();
  const related = await fetchRelated(guide._id);
  return <SellerGuideDetailPage guide={guide} related={related} />;
}
