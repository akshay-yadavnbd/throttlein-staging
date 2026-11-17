/**
 * Seller-site URL helper for storefront links.
 *
 * In production the seller funnel lives on its own subdomain
 * (NEXT_PUBLIC_SELLER_URL, e.g. https://seller.throttlein.com) with
 * CLEAN paths — the landing page is `/`, login is `/login`, etc.
 * In dev (env unset) the same pages live under `/seller/...` in this
 * app, so the helper falls back to those paths.
 *
 *   sellerUrl()          → https://seller.throttlein.com   (or /seller)
 *   sellerUrl('/login')  → https://seller.throttlein.com/login (or /seller/login)
 */
export const SELLER_ORIGIN = (process.env.NEXT_PUBLIC_SELLER_URL || '').replace(/\/$/, '');

export function sellerUrl(path: string = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (SELLER_ORIGIN) return clean === '/' ? SELLER_ORIGIN : `${SELLER_ORIGIN}${clean}`;
  return clean === '/' ? '/seller' : `/seller${clean}`;
}

/**
 * URL for a CMS-authored page on the seller property.
 *
 * CMS pages live at the ROOT of the seller property — one bare slug, no
 * `/page/` and no `/c/`:
 *
 *   production → https://seller.throttlein.com/seller-faq
 *   dev        → /seller/seller-faq
 *
 * Both land on the internal catch-all `app/seller/c/[...path]`: on the seller
 * host via handleSellerHosts(), and locally via handleLocalSellerPaths(). The
 * internal `/seller/c/**` namespace is never a public URL — the proxy 301s it
 * away if anyone types it.
 *
 * This used to emit `/seller/c/page/<slug>` in dev, which meant local URLs
 * exposed the internal namespace and looked nothing like production. Identical
 * shapes in both environments is the point: a link that works in dev works in
 * prod, and vice versa.
 *
 *   sellerContentUrl('/seller-faq')
 *   sellerContentUrl('/helmets')   // dynamic CMS landing page
 */
export function sellerContentUrl(path: string = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (SELLER_ORIGIN) return `${SELLER_ORIGIN}${clean}`;
  return `/seller${clean}`;
}
