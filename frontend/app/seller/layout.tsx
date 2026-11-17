import SellerHeader from '@/components/seller/SellerHeader';
import SellerFooter from '@/components/seller/SellerFooter';
import JsonLd from '@/components/seo/JsonLd';
import { fetchSellerCategoryLinks } from '@/lib/sellerCategoryLinks';
import { sellerGraphJsonLd } from '@/lib/structuredData';

/**
 * Layout for the SELLER PROPERTY.
 *
 * Covers /seller and everything under it — which, on
 * seller.throttlein.com, is what serves `/`, `/login`, `/register`,
 * `/verify`, `/guide/*`, `/blog/*` and the `/c/*` CMS pages, via the
 * rewrites in `proxy.ts`.
 *
 * ── Why the chrome lives here ─────────────────────────────────────
 * The seller property has its own header and footer: a different logo
 * (SELLER HUB, not the storefront wordmark), its own nav, and a footer
 * built around selling rather than shopping. Putting them in this
 * layout means every seller page gets them for free — previously only
 * the landing page rendered a header, by importing `MarketingHeader`
 * itself, so the blog and CMS pages came out with the storefront's
 * chrome or none at all.
 *
 * ── Storefront chrome ──────────────────────────────────────────────
 * There is none to fight anymore. Navbar and Footer used to render
 * unconditionally from the root layout, and this file hid them with
 * `#site-header, #site-footer { display:none }` — which still shipped
 * the full storefront header/footer markup in every seller page.
 * Crawlers read hidden HTML: the SEO audit flagged all of that chrome's
 * relative links (mega-menu categories/brands, /about, /faqs, /signin,
 * policies…) as 404s on the seller subdomain. The chrome now lives in
 * app/(storefront)/layout.tsx, so seller HTML never contains it and the
 * CSS hide is gone.
 */
export default async function SellerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /**
   * The footer's "Popular categories" band lists the published
   * seller-category pages. Fetched here rather than inside SellerFooter
   * because that's a client component, and this is the one place that
   * renders on every page of the property.
   *
   * `fetch` with `next: { revalidate: 300 }` keeps the layout statically
   * rendered with ISR — this does NOT opt the property into dynamic
   * rendering the way reading `headers()` would.
   */
  const footerCategories = await fetchSellerCategoryLinks();

  return (
    <>
      {/* Combined Organization + WebSite @graph for the seller property
          — replaces the storefront org/site schema this property used to
          inherit from the root layout (flagged 🟠 by the schema audit). */}
      <JsonLd data={sellerGraphJsonLd} />
      <SellerHeader />
      {/* flex-1 keeps SellerFooter pinned to the viewport bottom on
          short pages — the body is `flex flex-col min-h-screen` and the
          root layout no longer provides a <main> wrapper. */}
      <main className="flex-1">{children}</main>
      <SellerFooter categories={footerCategories} />
    </>
  );
}
