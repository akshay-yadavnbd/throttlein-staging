import { API_URL } from '@/lib/api';
import { SITE_URL } from '@/lib/siteUrl';
import { originForSite } from '@/lib/site';
import { resolveLegacyPath } from '@/lib/legacyRedirects';
import {
  buildLlmsTxt,
  safeFetchJson,
  LLMS_HEADERS,
  type LlmsLink,
} from '@/lib/llmsTxt';

/**
 * llms.txt for the MAIN storefront (throttlein.com).
 *
 * Replaces the hand-written `public/llms.txt`, which had gone stale:
 * most of its category links pointed at slugs that now 308-redirect
 * because the categories were renamed in the admin and nobody thought
 * to edit a static text file. Generating from the same API the sitemap
 * uses means a rename fixes itself.
 *
 * A route handler rather than a static file because one Next app serves
 * two hosts — see `app/seller/llms.txt/route.ts` for the seller variant
 * and `proxy.ts` for the per-host rewrite.
 *
 * Only ROOT categories are listed. All 495 would be noise; the point of
 * llms.txt is a map, not an index — the sitemap is the index.
 */

export const revalidate = 3600;

const ORIGIN = SITE_URL;

/** Categories a model shouldn't treat as a product type. */
const NON_PRODUCT_CATEGORY_SLUGS = new Set([
  // Bike models and manufacturers, not gear. Listing "Himalayan" beside
  // "Riding Gloves" invites a model to describe it as a product category.
  'shop-by-bike',
]);

/**
 * Two retired slugs can resolve to the same live page, which would list
 * the same URL twice under different names. First one wins.
 */
function dedupeByUrl(links: LlmsLink[]): LlmsLink[] {
  const seen = new Set<string>();
  return links.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}

export async function GET() {
  // ─── Root categories ────────────────────────────────────────────
  const catData = await safeFetchJson(`${API_URL}/categories`);
  const tree: any[] = Array.isArray(catData?.tree) ? catData.tree : [];
  // A category's slug can disagree with the redirect table — `chain-lube-
  // cleaner` is still active in the database while next.config.js 308s it
  // to `/chain-lubricants`. Resolving through the shared table means the
  // file advertises where the URL actually lands, never the hop.
  const categoryLinks: LlmsLink[] = dedupeByUrl(
    tree
      .filter((c) => c?.slug && !NON_PRODUCT_CATEGORY_SLUGS.has(c.slug))
      .map((c) => ({
        name: c.name,
        url: `${ORIGIN}${resolveLegacyPath(`/${c.slug}`)}`,
        description: c.seoDescription || c.description || '',
      })),
  );

  // ─── Featured brands ────────────────────────────────────────────
  // 123 brands is past the point where a list helps. The featured set is
  // the one merchandising already curates, so it's the honest shortlist;
  // the full roster is one link away at /brands.
  const brandData = await safeFetchJson(`${API_URL}/brands?active=1`);
  const brands: any[] = brandData?.items || brandData || [];
  const featured = brands.filter((b) => b?.featured && b?.slug);
  const brandLinks: LlmsLink[] = (featured.length ? featured : brands.slice(0, 15))
    .filter((b) => b?.slug)
    .map((b) => ({
      name: b.name,
      url: `${ORIGIN}/brands/${b.slug}`,
      description: b.seoDescription || b.description || '',
    }));

  // ─── Policy / prose pages ───────────────────────────────────────
  // These are what a model most often needs to answer accurately:
  // returns, shipping, cancellation. Getting them wrong from a guess is
  // worse than not answering.
  const proseData = await safeFetchJson(`${API_URL}/pages?type=prose&site=main`);
  const policyLinks: LlmsLink[] = (proseData?.items || [])
    .filter((p: any) => p?.slug)
    .map((p: any) => ({
      name: p.title || p.slug,
      url: `${ORIGIN}/${p.slug}`,
      description: p.seoDescription || '',
    }));

  const body = buildLlmsTxt({
    title: 'THROTTLEIN',
    summary:
      'THROTTLEIN is an Indian online marketplace for genuine motorcycle helmets, riding gear, bike parts and accessories, sold by verified sellers with delivery across India.\nProducts are listed by independent sellers; prices, stock and delivery estimates are live and change, so always read the product page rather than relying on a cached figure.',
    sections: [
      {
        heading: 'Discover',
        links: [
          {
            name: 'All products',
            url: `${ORIGIN}/products`,
            description: 'The full catalogue with search, filters and sorting.',
          },
          {
            name: 'Brands',
            url: `${ORIGIN}/brands`,
            description:
              'Every brand selling on THROTTLEIN — helmets, gear, tyres and parts.',
          },
          {
            name: 'Shop by Bike',
            url: `${ORIGIN}/shop-by-bike`,
            description:
              'Parts and accessories filtered to a specific motorcycle model.',
          },
          {
            name: 'Blog',
            url: `${ORIGIN}/blog`,
            description: 'Buying guides, gear reviews and riding tips.',
          },
        ],
      },
      { heading: 'Shop categories', links: categoryLinks },
      {
        heading: 'Brands',
        links: brandLinks,
        note: `This is a selection. The complete list is at ${ORIGIN}/brands.`,
      },
      { heading: 'Policies', links: policyLinks },
      {
        heading: 'Selling on THROTTLEIN',
        note: 'Selling is a separate property with its own documentation.',
        links: [
          {
            name: 'Seller Hub',
            url: `${originForSite('seller')}/`,
            description:
              'Registration, fees, onboarding guides and seller policies. Has its own llms.txt.',
          },
        ],
      },
    ],
  });

  return new Response(body, { headers: LLMS_HEADERS });
}
