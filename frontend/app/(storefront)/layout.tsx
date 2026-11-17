import Navbar from '@/components/common/Navbar';
import Footer from '@/components/common/Footer';
import JsonLd from '@/components/seo/JsonLd';
import { orgJsonLd, siteJsonLd } from '@/lib/structuredData';

/**
 * Layout for the STOREFRONT property (throttlein.com).
 *
 * The storefront chrome — Navbar + Footer — lives HERE, not in the root
 * layout. It used to be rendered unconditionally at the root, which
 * meant every seller-property page (seller.throttlein.com) shipped the
 * full storefront header and footer in its HTML, merely hidden with
 * `display:none` by app/seller/layout.tsx. Crawlers read hidden markup:
 * the SEO audit flagged ~25 storefront links (mega-menu categories and
 * brands, /about, /faqs, /signin, policy pages…) as 404s ON THE SELLER
 * SUBDOMAIN, because every one of those relative hrefs was being
 * discovered inside seller pages.
 *
 * With the chrome scoped to this route group it simply never renders
 * into seller HTML, and the seller layout's CSS hide is gone. Route
 * groups don't affect URLs — every storefront path is unchanged.
 *
 * Navbar and Footer keep their own pathname-based self-hiding for the
 * storefront routes that use different chrome (/signin, /account, the
 * auth pages, …), exactly as before.
 */
export default function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Storefront Organization + WebSite JSON-LD — moved here from
          the root layout so the seller property stops emitting the
          storefront's schema (flagged by the schema audit). */}
      <JsonLd data={orgJsonLd} />
      <JsonLd data={siteJsonLd} />
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
