/**
 * Multi-site helpers for the storefront.
 *
 * ONE Next app serves two public properties:
 *   - 'main'   → throttlein.com
 *   - 'seller' → seller.throttlein.com
 *
 * The seller host's clean URLs are rewritten by `proxy.ts` onto an
 * internal `/seller/...` namespace, so a route file always knows
 * statically which property it belongs to — server components pass the
 * site explicitly rather than sniffing headers.
 *
 * Keep the keys in sync with `backend/src/constants/sites.js`.
 */

export type SiteKey = 'main' | 'seller';

export const DEFAULT_SITE: SiteKey = 'main';

/**
 * Internal path prefix for a site's CMS content. The seller property's
 * pages live under `/seller/c/<public path>` inside the app router.
 *
 * MUST stay in sync with:
 *   - the rewrite in `proxy.ts` → handleSellerHosts()
 *   - `SITE_ROUTE_PREFIX` in `backend/src/controllers/pageController.js`
 *     (which builds the path passed to revalidatePath)
 */
export const SITE_CONTENT_PREFIX: Record<SiteKey, string> = {
  main: '',
  seller: '/seller/c',
};

/** Absolute origin for a site — used for canonicals, OG tags, sitemaps
 *  and any cross-host link. */
export function originForSite(site: SiteKey): string {
  if (site === 'seller') {
    return (
      process.env.NEXT_PUBLIC_SELLER_URL ||
      (process.env.NODE_ENV === 'production'
        ? 'https://seller.throttlein.com'
        : 'http://localhost:3000')
    ).replace(/\/$/, '');
  }
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://throttlein.com'
      : 'http://localhost:3000')
  ).replace(/\/$/, '');
}

/**
 * Which property is this hostname? Used by the client-side axios
 * interceptor, where a single JS bundle is served to both hosts and the
 * only reliable signal is `window.location.host`.
 */
export function siteFromHost(host?: string | null): SiteKey {
  if (!host) return DEFAULT_SITE;
  const h = host.toLowerCase().split(':')[0];
  const sellerHost = (process.env.NEXT_PUBLIC_SELLER_URL || '')
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .toLowerCase()
    .split(':')[0];
  if (sellerHost && h === sellerHost) return 'seller';
  // Fallback for deployments that haven't set NEXT_PUBLIC_SELLER_URL:
  // any host beginning `seller.` is the seller property.
  if (h.startsWith('seller.')) return 'seller';
  return DEFAULT_SITE;
}

/**
 * Site key from host AND path.
 *
 * The host alone is not enough. `proxy.ts` only rewrites `/seller/**` on the
 * real seller domain, so in local dev (and any preview deploy without a seller
 * hostname) the seller property is served from the MAIN host under a `/seller`
 * path prefix. Deriving the site from the host there yields 'main', and every
 * client-side refetch then asks the main site for seller content — which 404s
 * over SSR content that rendered perfectly.
 *
 * That is exactly how `/seller/c/page/pricing-and-fees` came to show a "Page
 * not found" body under a correct page title: the server resolved the page,
 * then ProsePage's post-hydration refetch looked on the wrong property.
 */
export function siteFromLocation(host?: string | null, pathname?: string | null): SiteKey {
  if (siteFromHost(host) === 'seller') return 'seller';
  const p = (pathname || '').toLowerCase();
  if (p === '/seller' || p.startsWith('/seller/')) return 'seller';
  return DEFAULT_SITE;
}

/** Site key from the browser's current location. Safe to call during
 *  SSR — returns 'main' when `window` is absent. */
export function currentSite(): SiteKey {
  if (typeof window === 'undefined') return DEFAULT_SITE;
  return siteFromLocation(window.location.host, window.location.pathname);
}
