import type { Metadata } from 'next';
import { API_URL, dataOf } from '@/lib/api';
import SellPage from '@/components/pages/SellPage';
import JsonLd from '@/components/seo/JsonLd';
import { buildStaticPageMetadata } from '@/lib/staticMeta';
import { SELLER_ORIGIN } from '@/lib/sellerUrl';
import { sellerHomeGraphJsonLd } from '@/lib/structuredData';

/**
 * Seller landing page — public URL `seller.throttlein.com/`.
 *
 * Editable from Admin → (switch to Seller) → Pages → "Seller home".
 * The override record is `site='seller', staticRoute='/'`.
 *
 * MIGRATION NOTE: this used to read the MAIN site's `/seller` record.
 * `backend/scripts/migrateSellerStaticMeta.js` MOVED that record to
 * `site: 'seller', staticRoute: '/'`, so nothing written before the
 * multi-site split is lost. `/seller` was also removed from the main
 * site's static manifest (`admin/lib/staticPages.ts`) and from the
 * filesystem walk (`backend/src/utils/discoverStaticPages.js`) — it's
 * this property's page, so it belongs on this property's Pages list.
 * `throttlein.com/seller` still 301s here, handled by a redirect rather
 * than a page record.
 */
export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    site: 'seller',
    route: '/',
    defaultTitle: 'Become a Seller · THROTTLEIN',
    defaultDescription:
      'List your motorcycle accessories on THROTTLEIN — zero setup fee, 24-hour go-live, and buyers who already know what they want.',
    siteName: 'THROTTLEIN Sellers',
    // `originForSite('seller')` already yields the subdomain root, so
    // the canonical default is correct. Kept explicit only for the case
    // where SELLER_ORIGIN and NEXT_PUBLIC_SELLER_URL disagree.
    ...(SELLER_ORIGIN ? { canonical: SELLER_ORIGIN } : {}),
  });
}

/**
 * FAQ block content — admin-managed FaqSection rows scoped
 * site='seller' (Admin → Pages → Seller home tab). Sections are
 * flattened to one Q&A list because this page renders a single flat
 * accordion, not the main site's grouped layout. Any failure returns []
 * and SellPage falls back to its hardcoded copy, so the section never
 * renders blank. 300s ISR matches the rest of the property's content.
 */
async function fetchSellerFaqs(): Promise<{ q: string; a: string }[]> {
  try {
    const r = await fetch(`${API_URL}/faqs?site=seller`, {
      next: { revalidate: 300 },
    });
    if (!r.ok) return [];
    const d = dataOf(await r.json());
    const sections = Array.isArray(d?.items) ? d.items : [];
    return sections.flatMap((s: any) =>
      (s.faqs || []).map((f: any) => ({ q: f.question, a: f.answer })),
    );
  } catch {
    return [];
  }
}

export default async function Page(props: any) {
  const initialFaqs = await fetchSellerFaqs();
  return (
    <>
      {/* Home's Service + WebPage nodes — combined with the layout's
          Organization + WebSite @graph they form the exact home schema
          supplied by the product owner. */}
      <JsonLd data={sellerHomeGraphJsonLd} />
      <SellPage {...props} initialFaqs={initialFaqs} />
    </>
  );
}
