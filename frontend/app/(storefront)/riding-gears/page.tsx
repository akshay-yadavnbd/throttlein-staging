import { Suspense } from 'react';
import type { Metadata } from 'next';
import CategoryPage from '@/components/pages/CategoryPage';
import JsonLd from '@/components/seo/JsonLd';
import { SITE_URL } from '@/lib/siteUrl';
import { API_URL, dataOf } from '@/lib/api';

/**
 * Riding Gear collection — `/riding-gears`.
 *
 * A curated landing page aggregating every RIDER-worn category
 * (helmets, jackets, gloves, pants, boots, suits, protection, rain
 * gear) into one grid. Uses CategoryPage's `collectionSlugs` mode: the
 * sidebar's Category panel lists exactly these parents (children
 * indented) and the grid pulls each subtree from the backend.
 *
 * The slugs must match the restructured taxonomy — see
 * backend/scripts/restructure-categories.js.
 *
 * ── WHY THIS READS THE CATEGORY RECORD ──────────────────────────────
 * A real Category row exists with slug `riding-gears` ("Bike Riding
 * Gear"), and it's editable at Admin → Catalogue → Categories with the
 * full SEO + Top/Bottom Content field set.
 *
 * But this file is a STATIC route segment, and in Next.js a static
 * segment beats the dynamic `[slug]` one — so `/riding-gears` never
 * reached the category route that reads those fields. Meta came from
 * `buildStaticPageMetadata({ route: '/riding-gears' })`, which looks up
 * a `static-meta` Page record that isn't in the admin's STATIC_PAGES
 * manifest and therefore can't be created from the panel at all; the
 * on-page heading and intro were hardcoded below. Net effect: everything
 * an admin typed into that category was silently discarded, with no
 * other surface to type it into.
 *
 * So the metadata and on-page copy now follow the SAME precedence as
 * the dynamic category route in `app/(storefront)/[slug]/page.tsx`:
 *   meta title  → category.seoTitle       → generated default
 *   meta desc   → category.seoDescription → category.description → default
 *   heading     → category.contentTitle   → category.name → "Riding Gear"
 *   intro       → category.contentDescription → category.description → default
 * The curated `collectionSlugs` aggregation is unchanged — only where
 * the words come from has moved.
 */
const GEAR_SLUGS = [
  'helmets',
  'riding-jackets',
  'riding-gloves',
  'riding-pants',
  'riding-boots',
  'riding-suits',
  'protection-gear',
  'rain-gear',
];

const CATEGORY_SLUG = 'riding-gears';

const FALLBACK_TITLE = 'Riding Gear — Helmets, Jackets, Gloves & More · THROTTLEIN';
const FALLBACK_DESCRIPTION =
  "Shop Throttlein's full riding gear range — helmets, riding jackets, gloves, pants, boots, suits, protection and rain gear from trusted brands, delivered across India.";
const FALLBACK_HEADING = 'Riding Gear';
const FALLBACK_INTRO =
  'Everything the rider wears — helmets, jackets, gloves, pants, boots, suits, protection and rain gear.';

type CategoryNode = {
  name?: string;
  slug?: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  contentTitle?: string;
  contentDescription?: string;
  bottomTitle?: string;
  bottomDescription?: string;
  children?: CategoryNode[];
};

function findInTree(nodes: CategoryNode[], slug: string): CategoryNode | null {
  for (const n of nodes || []) {
    if (n?.slug === slug) return n;
    const hit = findInTree(n?.children || [], slug);
    if (hit) return hit;
  }
  return null;
}

/** The category row backing this URL. Next dedupes this fetch with the
 *  identical one in generateMetadata, so it costs one request. */
async function fetchCategory(): Promise<CategoryNode | null> {
  try {
    const res = await fetch(`${API_URL}/categories`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const data = dataOf(await res.json());
    return findInTree(data?.tree || [], CATEGORY_SLUG);
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const node = await fetchCategory();

  const title = node?.seoTitle?.trim() || FALLBACK_TITLE;
  const description = (
    node?.seoDescription?.trim() ||
    node?.description?.trim() ||
    FALLBACK_DESCRIPTION
  ).slice(0, 160);
  const canonical = `${SITE_URL}/${CATEGORY_SLUG}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      siteName: 'THROTTLEIN',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
    { '@type': 'ListItem', position: 2, name: 'Riding Gear', item: `${SITE_URL}/riding-gears` },
  ],
};

export default async function RidingGearsPage() {
  const node = await fetchCategory();

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <Suspense fallback={null}>
        <CategoryPage
          slugOverride={CATEGORY_SLUG}
          titleOverride={
            node?.contentTitle?.trim() || node?.name?.trim() || FALLBACK_HEADING
          }
          descriptionOverride={
            node?.contentDescription?.trim() ||
            node?.description?.trim() ||
            FALLBACK_INTRO
          }
          bottomTitle={node?.bottomTitle?.trim() || undefined}
          bottomDescriptionHtml={node?.bottomDescription?.trim() || undefined}
          collectionSlugs={GEAR_SLUGS}
        />
      </Suspense>
    </>
  );
}
