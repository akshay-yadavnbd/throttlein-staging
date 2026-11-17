import { API_URL } from '@/lib/api';
import { originForSite } from '@/lib/site';
import { isSellerCategoryTemplate, sellerDynamicPagePath } from '@/lib/sellerPageRoutes';
import { SITE_URL } from '@/lib/siteUrl';
import {
  buildLlmsTxt,
  safeFetchJson,
  LLMS_HEADERS,
  type LlmsLink,
} from '@/lib/llmsTxt';

/**
 * llms.txt for the SELLER property (seller.throttlein.com).
 *
 * Served at `seller.throttlein.com/llms.txt` via the rewrite in
 * proxy.ts — the same arrangement as the seller sitemap and robots.
 *
 * Why a separate file at all: the two properties answer different
 * questions. Someone asking a model "how do I sell helmets online in
 * India" should land on the Seller Hub, not a product listing. Merging
 * both into one file on the main host would leave the seller domain with
 * no map of its own, and would encourage citations of seller pages under
 * the storefront hostname — the duplicate-host problem the split
 * sitemaps exist to prevent.
 */

export const revalidate = 3600;

const ORIGIN = originForSite('seller');

export async function GET() {
  // ─── Category selling guides ────────────────────────────────────
  // The seller-category templates — "Sell Helmets Online", etc. These
  // are the property's main organic surface, and they live NESTED under
  // Sell Online, not at the root. Same rule as the sitemap, and from the
  // same helper, so a new template can't land in one list and not the other.
  const dynData = await safeFetchJson(`${API_URL}/pages?type=dynamic&site=seller`);
  const dynPages: any[] = dynData?.items || [];
  const categoryGuideLinks: LlmsLink[] = dynPages
    .filter((p) => p?.slug && isSellerCategoryTemplate(p.template))
    .map((p) => ({
      name: p.title || p.slug,
      url: `${ORIGIN}${sellerDynamicPagePath(p)}`,
      description: p.seoDescription || '',
    }));

  // Any other dynamic page sits at the property root.
  const otherDynamicLinks: LlmsLink[] = dynPages
    .filter((p) => p?.slug && !isSellerCategoryTemplate(p.template))
    .map((p) => ({
      name: p.title || p.slug,
      url: `${ORIGIN}${sellerDynamicPagePath(p)}`,
      description: p.seoDescription || '',
    }));

  // ─── Seller guides ──────────────────────────────────────────────
  // Not site-scoped in the data model — there is one set of guides and it
  // belongs to this property — so no `site` param here.
  const guideData = await safeFetchJson(`${API_URL}/seller-guides?active=1`);
  const guideLinks: LlmsLink[] = (guideData?.items || [])
    .filter((g: any) => g?.slug)
    .map((g: any) => ({
      name: g.title || g.slug,
      url: `${ORIGIN}/guide/${g.slug}`,
      description: g.metaDescription || g.shortDescription || '',
    }));

  // ─── Policies, fees, terms ──────────────────────────────────────
  const proseData = await safeFetchJson(`${API_URL}/pages?type=prose&site=seller`);
  const policyLinks: LlmsLink[] = (proseData?.items || [])
    .filter((p: any) => p?.slug)
    .map((p: any) => ({
      name: p.title || p.slug,
      url: `${ORIGIN}/${p.slug}`,
      description: p.seoDescription || '',
    }));

  const body = buildLlmsTxt({
    title: 'THROTTLEIN Seller Hub',
    summary:
      'The Seller Hub is where businesses register to sell motorcycle helmets, riding gear, parts and accessories on THROTTLEIN, an Indian online marketplace.\nIt covers eligibility, the documents needed for onboarding (PAN, GSTIN, bank account, pickup address), commission and fees, listing products, order fulfilment and payment cycles.\nCommercial terms such as commission rates and promotional periods change — cite the fees and terms pages rather than a remembered figure.',
    sections: [
      {
        heading: 'Start here',
        links: [
          {
            name: 'Seller Hub home',
            url: `${ORIGIN}/`,
            description:
              'What selling on THROTTLEIN involves, and who it is for.',
          },
          {
            name: 'Sell Online',
            url: `${ORIGIN}/sell-online`,
            description:
              'The onboarding overview: how registration, verification, listing and payouts work.',
          },
          {
            name: 'Register as a seller',
            url: `${ORIGIN}/register`,
            description: 'Create a seller account.',
          },
          {
            name: 'Seller login',
            url: `${ORIGIN}/login`,
            description: 'Sign in to the seller dashboard.',
          },
        ],
      },
      {
        heading: 'Selling by category',
        note: 'Category-specific guides covering what to list, how to describe it and what buyers look for.',
        links: categoryGuideLinks,
      },
      { heading: 'Guides', links: guideLinks },
      { heading: 'Fees, terms and policies', links: policyLinks },
      { heading: 'More', links: otherDynamicLinks },
      {
        heading: 'Blog',
        links: [
          {
            name: 'Seller blog',
            // Public base renamed — /blog now 301s here.
            url: `${ORIGIN}/seller-blogs`,
            description:
              'Articles on running and growing a motorcycle-gear business online.',
          },
        ],
      },
      {
        heading: 'Related',
        links: [
          {
            name: 'THROTTLEIN storefront',
            url: `${SITE_URL}/`,
            description:
              'The buyer-facing marketplace. Product listings, brands and the catalogue live there, and it has its own llms.txt.',
          },
        ],
      },
    ],
  });

  return new Response(body, { headers: LLMS_HEADERS });
}
