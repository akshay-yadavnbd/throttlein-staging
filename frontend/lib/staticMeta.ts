import type { Metadata } from 'next';
import { API_URL, dataOf } from '@/lib/api';
import { originForSite, type SiteKey } from '@/lib/site';
import { DEFAULT_OG_IMAGE } from '@/lib/jsonLd';

/**
 * Shared SEO-metadata builder for static storefront pages.
 *
 * Every static page (/, /about, /sell, /brands, /cart, /login, /blog,
 * /products, /signin, /signup, /register, etc.) should call this from
 * its `generateMetadata()` so admin Pages → SEO override actually
 * reaches the rendered HTML.
 *
 * Flow:
 *   1. Fetch `/api/pages/static-meta?route=<route>` (ISR-cached 60s).
 *   2. If an override Page exists and is published, overlay its
 *      seoTitle / seoDescription / ogImage on top of the caller's
 *      hardcoded defaults.
 *   3. If no override exists or the backend is down, return the
 *      hardcoded defaults — so the page still has sane meta even on
 *      a fresh DB or during a backend outage.
 *
 * The returned object covers `<title>`, `<meta name="description">`,
 * canonical, Open Graph, and Twitter card. Page files only need to
 * supply the route + a couple of strings:
 *
 *   export async function generateMetadata() {
 *     return buildStaticPageMetadata({
 *       route: '/sell',
 *       defaultTitle: 'Become a Seller — THROTTLEIN',
 *       defaultDescription: '…',
 *     });
 *   }
 */
export type StaticMetaOpts = {
  /** The storefront pathname, e.g. `/about`. Must start with `/`. */
  route: string;
  /** Title used when the admin hasn't set an override. */
  defaultTitle: string;
  /** Description used when the admin hasn't set an override. */
  defaultDescription: string;
  /** Optional OG image fallback (absolute URL). */
  defaultOgImage?: string;
  /** Which property this route belongs to. Scopes the override lookup
   *  AND the default canonical origin. Defaults to 'main', so every
   *  main-site caller can keep omitting it.
   *
   *  Passing the wrong value here is the quiet way to break a page:
   *  a seller route left on 'main' will read the OTHER site's override
   *  record and canonicalise to a throttlein.com URL that 404s. */
  site?: SiteKey;
  /** Optional canonical URL override (defaults to the site's origin +
   *  route). */
  canonical?: string;
  /** Optional siteName for Open Graph (defaults to 'THROTTLEIN'). */
  siteName?: string;
  /** When true, the page is excluded from Google's index. Used for
   *  account/cart-style pages that have no SEO surface. */
  noindex?: boolean;
};

type AdminOverride = {
  seoTitle?: string;
  seoDescription?: string;
  ogImage?: string;
  title?: string; // internal title — never used for SEO
};

export async function buildStaticPageMetadata(
  opts: StaticMetaOpts,
): Promise<Metadata> {
  const {
    route,
    defaultTitle,
    defaultDescription,
    /**
     * Falls back to the site-wide hero rather than nothing.
     *
     * This defaulted to `''`, and the openGraph/twitter blocks below
     * only emit an image when it's truthy — so every page built through
     * this helper shipped with NO og:image unless an admin had uploaded
     * one per-page. That's most of both properties' evergreen pages
     * (/about, /products, /brands, /contact, /faqs on the storefront;
     * /sell-online, /seller-faq, /pricing-and-fees and the policies on
     * the seller hub): links to them previewed as bare text on
     * WhatsApp, LinkedIn and X.
     *
     * Per-page overrides still win — this is only the floor.
     */
    defaultOgImage = DEFAULT_OG_IMAGE,
    site = 'main',
    canonical = `${originForSite(site)}${route}`,
    siteName = 'THROTTLEIN',
    noindex = false,
  } = opts;

  let override: AdminOverride | null = null;
  try {
    const res = await fetch(
      `${API_URL}/pages/static-meta?route=${encodeURIComponent(route)}&site=${site}`,
      { next: { revalidate: 60 } },
    );
    if (res.ok) {
      const data = dataOf(await res.json());
      override = (data?.override as AdminOverride) || null;
    }
  } catch {
    // Backend unreachable — silently fall back to defaults below.
  }

  const title = override?.seoTitle?.trim() || defaultTitle;
  const description = override?.seoDescription?.trim() || defaultDescription;
  const ogImage = override?.ogImage?.trim() || defaultOgImage;

  const meta: Metadata = {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      siteName,
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };

  if (noindex) {
    meta.robots = { index: false, follow: true };
  }

  return meta;
}
