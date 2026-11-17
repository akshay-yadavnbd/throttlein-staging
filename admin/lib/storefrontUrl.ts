import type { SiteKey } from './site';

/**
 * Public origin of a storefront property, for admin "preview" links.
 *
 * Resolution, in order:
 *   1. An explicit env var — `NEXT_PUBLIC_STOREFRONT_URL` for the main
 *      site, `NEXT_PUBLIC_SELLER_URL` for the seller property.
 *   2. Derived from the admin's own origin by stripping the `admin.`
 *      subdomain (and prefixing `seller.` for the seller property), so
 *      a normal `admin.example.com` deployment needs no config.
 *   3. localhost:3000 for local development.
 *
 * WHY THIS EXISTS
 * The preview buttons used to hard-code the main storefront. Creating a
 * page on the seller property and hitting Preview opened
 * `throttlein.com/<slug>` — a main-site URL for a record whose `site`
 * is 'seller', so it 404'd. The editor's reasonable conclusion was
 * "my page is broken" when it was fine at
 * `seller.throttlein.com/<slug>`. A false alarm on the most-used button
 * in the editor.
 */
export function storefrontOrigin(site: SiteKey): string {
  const strip = (s: string) => s.replace(/\/$/, '');

  if (site === 'seller') {
    const env = process.env.NEXT_PUBLIC_SELLER_URL;
    if (env) return strip(env);
  } else {
    const env = process.env.NEXT_PUBLIC_STOREFRONT_URL;
    if (env) return strip(env);
  }

  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    const m = origin.match(/^(https?:\/\/)admin\.(.+)$/i);
    if (m) {
      const base = site === 'seller' ? `${m[1]}seller.${m[2]}` : `${m[1]}${m[2]}`;
      return strip(base);
    }
    // Dev laptop on a non-admin origin. Fall through to localhost below
    // rather than guessing — see the note on the return value.
  }

  // Local development. Note the SELLER path is NOT a different port:
  // one Next app serves both properties, and with
  // NEXT_PUBLIC_SELLER_URL unset the proxy's host routing is disabled,
  // so seller content is reached at /seller/* on the same origin. The
  // caller is responsible for that prefix — see `previewPath()`.
  return 'http://localhost:3000';
}

/**
 * Build the full preview URL for a page on a given site.
 *
 * `path` is the page's PUBLIC path on its own property (e.g.
 * `/page/seller-faq`, or `/helmets` for a dynamic page).
 *
 * On the seller property in local dev — where `NEXT_PUBLIC_SELLER_URL`
 * is unset and there's no host-based routing — CMS content lives under
 * the internal `/seller/c/**` namespace, so the prefix is added here.
 * With the env var set (any real deployment) the public path is used
 * verbatim, because the storefront proxy does the rewriting.
 */
export function previewUrl(site: SiteKey, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const origin = storefrontOrigin(site);
  if (site === 'seller' && !process.env.NEXT_PUBLIC_SELLER_URL) {
    return `${origin}/seller/c${clean}`;
  }
  return `${origin}${clean}`;
}
