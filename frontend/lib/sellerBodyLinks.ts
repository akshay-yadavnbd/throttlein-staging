import { API_URL, dataOf } from './api';
import { originForSite } from './site';
import { sellerContentUrl } from './sellerUrl';

/**
 * Rewrite root-relative links inside SELLER prose bodies to the right property.
 *
 * CMS bodies are authored with same-origin paths like `[Pricing & Fees](/pricing-and-fees)`.
 * That assumption breaks in two directions once the seller property exists:
 *
 *   1. In dev there is no seller host, so seller content lives at
 *      `/seller/<slug>`. A body link to `/seller-terms` resolves against
 *      localhost:3000 and 404s.
 *   2. Seller bodies also link to MAIN-site policies — `seller-terms` links to
 *      `/shipping-policy` and `/return-and-refund-policy`, which only exist on
 *      throttlein.com. On seller.throttlein.com those 404, so this is broken in
 *      production too, not just locally.
 *
 * So each link is resolved by WHICH PROPERTY OWNS THE SLUG, read from the API
 * rather than a hardcoded list — otherwise every new page silently reintroduces
 * the bug. Seller-owned slugs go through `sellerContentUrl()`; everything else
 * gets an absolute URL on the main origin.
 *
 * Anchors, absolute URLs, mailto: and tel: are left untouched.
 */

const MAIN_ORIGIN = originForSite('main');

/** Slugs that live on the seller property. Cached — this is read on every
 *  seller prose render, and the set changes only when an admin adds a page. */
async function sellerOwnedSlugs(): Promise<Set<string>> {
  const out = new Set<string>();
  for (const type of ['prose', 'dynamic'] as const) {
    try {
      const res = await fetch(`${API_URL}/pages?type=${type}&site=seller`, {
        next: { revalidate: 300 },
      });
      if (!res.ok) continue;
      const data = dataOf(await res.json());
      for (const p of data?.items || []) if (p?.slug) out.add(String(p.slug));
    } catch {
      // A failed lookup must not break the page. Falling through leaves the
      // link as authored, which is no worse than before this ran.
    }
  }
  return out;
}

/**
 * @param body  Raw markdown body (links rewritten before markdown rendering,
 *              so the renderer's own escaping applies to the final href).
 */
export async function resolveSellerBodyLinks(body: string): Promise<string> {
  if (!body) return body;

  // Only bother when there's at least one root-relative markdown link.
  if (!/\]\(\/[^)]/.test(body)) return body;

  const sellerSlugs = await sellerOwnedSlugs();

  return body.replace(/\]\((\/[^)\s]*)\)/g, (whole, href: string) => {
    // Leave anchors and anything that isn't a plain single-segment path.
    if (href.startsWith('/#')) return whole;

    const [pathOnly, hash = ''] = href.split('#');
    const slug = pathOnly.replace(/^\/+|\/+$/g, '');
    const suffix = hash ? `#${hash}` : '';

    // Multi-segment paths are left alone — they're main-site catalogue or
    // blog URLs, not seller CMS pages.
    if (!slug || slug.includes('/')) {
      return `](${MAIN_ORIGIN}${pathOnly}${suffix})`;
    }

    if (sellerSlugs.has(slug)) {
      return `](${sellerContentUrl(`/${slug}`)}${suffix})`;
    }
    // Not a seller page → it belongs to the storefront. Absolute, because on
    // seller.throttlein.com a relative path would look for a seller page.
    return `](${MAIN_ORIGIN}/${slug}${suffix})`;
  });
}
