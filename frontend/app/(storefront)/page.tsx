import { API_URL, dataOf } from '@/lib/api';
import type { Metadata } from 'next';
import HomePage from '@/components/pages/HomePage';
import JsonLd from '@/components/seo/JsonLd';
import { webPageSchema, itemListSchema } from '@/lib/jsonLd';
import { SITE_URL } from '@/lib/siteUrl';
import { buildStaticPageMetadata } from '@/lib/staticMeta';

// Home page meta — admin can override at /pages → Home via Edit meta.
export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    route: '/',
    defaultTitle: 'THROTTLEIN — Bike Helmets, Gear & Parts Marketplace',
    defaultDescription:
      'Shop premium motorcycle helmets, riding gear, and bike parts from verified Indian sellers. Authentic brands, fast delivery, easy returns.',
  });
}

/** Tiny fetch wrapper — returns a fallback on any error so a single
 *  backend hiccup doesn't blank the homepage. Each section has its
 *  own ISR cache window so admin edits surface without a full rebuild. */
async function safeFetch(url: string, fallback: any) {
  try {
    const r = await fetch(url, { next: { revalidate: 300 } });
    if (!r.ok) return fallback;
    const d = dataOf(await r.json());
    return Array.isArray(d?.items) ? d.items : fallback;
  } catch {
    return fallback;
  }
}

export default async function Page(props: any) {
  // Helper that returns the unwrapped object from /seller-cta — the
  // endpoint shape is { cta: {...} } not { items: [...] }, so the
  // generic safeFetch above (which expects items[]) can't be reused.
  async function fetchSellerCta() {
    try {
      const r = await fetch(`${API_URL}/seller-cta?active=1`, {
        next: { revalidate: 300 },
      });
      if (!r.ok) return null;
      const d = dataOf(await r.json());
      return d?.cta || null;
    } catch {
      return null;
    }
  }

  // Categories don't follow the { items: [...] } shape — the
  // /categories endpoint returns { tree: [...] }. Wrap it in a tiny
  // helper that pulls just the top-level rows for the new horizontal
  // category strip (Section 01 of the redesigned homepage).
  async function fetchCategories() {
    try {
      const r = await fetch(`${API_URL}/categories`, { next: { revalidate: 300 } });
      if (!r.ok) return [];
      const d = dataOf(await r.json());
      return Array.isArray(d?.tree) ? d.tree : [];
    } catch {
      return [];
    }
  }

  // Promo blocks — admin-managed cards under the "Best selling" carousel.
  // Uses a tighter ISR window (60s) than the rest of the homepage so the
  // admin sees their edits surface within a minute.
  async function fetchPromoBlocks() {
    try {
      const r = await fetch(`${API_URL}/promo-blocks?active=1`, {
        next: { revalidate: 60 },
      });
      if (!r.ok) return [];
      const d = dataOf(await r.json());
      return Array.isArray(d?.items) ? d.items : [];
    } catch {
      return [];
    }
  }

  // Home SEO block — singleton record (heading + body + chip links)
  // rendered at the foot of the homepage. Server returns null when
  // the admin has toggled the block off, in which case both the
  // ExploreLinks AND SeoContent sections are skipped client-side.
  async function fetchHomeSeoBlock() {
    try {
      const r = await fetch(`${API_URL}/home-seo?active=1`, {
        next: { revalidate: 60 },
      });
      if (!r.ok) return null;
      const d = dataOf(await r.json());
      return d?.block || null;
    } catch {
      return null;
    }
  }

  // Fetch all homepage sections in parallel. `safeFetch` swallows
  // failures so a single 500 doesn't break the page.
  const [brands, ratingList, jackets, pants, helmets, banners, sellerCta, categories, discounted, promoBlocks, homeSeoBlock] = await Promise.all([
    safeFetch(`${API_URL}/brands?active=1&featured=1`, []),
    // General rating-sorted pool — feeds "Recommended by bikers" (and
    // acts as the fallback for Best selling if the two category rails
    // below come back empty).
    safeFetch(`${API_URL}/products?sort=rating&limit=12`, []),
    // "Best selling this month" is apparel-focused per product decision:
    // riding jackets + riding pants only (each ?category= includes its
    // subcategories — textile/mesh/winter jackets etc.). Two fetches
    // because the public listing takes one category per request.
    safeFetch(`${API_URL}/products?category=riding-jackets&sort=rating&limit=12`, []),
    safeFetch(`${API_URL}/products?category=riding-pants&sort=rating&limit=12`, []),
    // "Recommended by bikers" is helmets-only per product decision.
    // Over-fetched (rail shows 4) so dedupe against Best selling can't
    // starve it.
    safeFetch(`${API_URL}/products?category=helmets&sort=rating&limit=8`, []),
    safeFetch(`${API_URL}/home-banners?active=1`, []),
    fetchSellerCta(),
    fetchCategories(),
    // Offers section — genuinely discounted products (mrp > price).
    // Over-fetched so we can drop any that already appear in the rails
    // above and still fill the carousel.
    safeFetch(`${API_URL}/products?discounted=1&sort=newest&limit=16`, []),
    fetchPromoBlocks(),
    fetchHomeSeoBlock(),
  ]);

  // Best selling = riding jackets + riding pants, 12 shown so the
  // carousel actually scrolls. INTERLEAVED (2 jackets : 1 pant, each
  // list already rating-sorted) rather than merged and re-sorted by
  // rating — with a jacket-heavy catalogue a pure rating sort filled
  // all 12 slots with jackets and pants never surfaced, defeating the
  // point of a two-category rail. Deduped in case a product is tagged
  // under both trees. Falls back to the general rating pool if both
  // category rails are empty — the section should never go blank
  // because a category was renamed.
  const seen = new Set<string>();
  const apparel: any[] = [];
  {
    const j = [...jackets];
    const p = [...pants];
    while (j.length || p.length) {
      for (const next of [j.shift(), j.shift(), p.shift()]) {
        if (!next) continue;
        const id = String(next._id);
        if (seen.has(id)) continue;
        seen.add(id);
        apparel.push(next);
      }
    }
  }
  const bestSellers = (apparel.length ? apparel : ratingList).slice(0, 12);

  // "Recommended by bikers" = top-rated helmets (per product decision;
  // it used to be the general rating pool, which filled it with the
  // same shoes/brake pads as everything else). Deduped against Best
  // selling — impossible to collide today (jackets/pants vs helmets),
  // but categories get re-tagged. Falls back to the general pool so
  // the rail never goes blank.
  const shownIds = new Set(bestSellers.map((p: any) => String(p._id)));
  const helmetPool = helmets.length ? helmets : ratingList;
  const recommended = helmetPool
    .filter((p: any) => !shownIds.has(String(p._id)))
    .slice(0, 4);
  recommended.forEach((p: any) => shownIds.add(String(p._id)));

  // Offers: discounted products not already shown above. If dedupe
  // empties the rail (tiny catalog), fall back to the raw discounted
  // list, then to the newest products — the section is never blank.
  let offersList = discounted
    .filter((p: any) => !shownIds.has(String(p._id)))
    .slice(0, 8);
  if (offersList.length === 0) {
    offersList = discounted.length
      ? discounted.slice(0, 8)
      : await safeFetch(`${API_URL}/products?sort=newest&limit=8`, []);
  }

  // The first hero banner is the LCP element on the homepage —
  // preload it explicitly so the browser starts the download BEFORE
  // it has even parsed the Next.js Image component. Without this the
  // hero slot painted solid black for ~2s on cold connections
  // (Semrush flagged "Largest Contentful Paint — Likely Poor").
  //
  // We preload the raw upstream URL (already absolute thanks to the
  // /api/files proxy fix). Next.js's image optimizer still server-side
  // fetches the same URL; warming the browser's resource cache in
  // parallel measurably reduces time-to-first-paint on the hero.
  const firstHeroSrc: string | null =
    (banners[0] && typeof banners[0].image === 'string' && banners[0].image) ||
    null;

  // Home WebPage schema + ItemList of best sellers — both wired in via
  // JsonLd so crawlers can attach the home view to the site graph and
  // see the featured-products carousel on first paint.
  const homeWebPage = webPageSchema({
    url: `${SITE_URL}/`,
    name: 'ThrottleIn — Bike Helmets, Gear & Parts Marketplace',
    headline: "India's marketplace for motorcycle riders",
    description:
      'Shop premium motorcycle helmets, riding gear, and bike parts from verified Indian sellers. Authentic brands, fast delivery, easy returns.',
  });
  const homeBestSellersList =
    Array.isArray(bestSellers) && bestSellers.length
      ? itemListSchema({
          name: 'Best sellers this month',
          description:
            'Top-rated motorcycle gear and parts on ThrottleIn this month.',
          url: `${SITE_URL}/`,
          items: bestSellers,
        })
      : null;

  return (
    <>
      <JsonLd data={homeWebPage} />
      {homeBestSellersList && <JsonLd data={homeBestSellersList} />}
      {firstHeroSrc && (
        // Rendered in the JSX tree but hoisted into <head> by Next.js,
        // so crawlers + browsers both see it at the top of the document.
        <link
          rel="preload"
          as="image"
          href={firstHeroSrc}
          fetchPriority="high"
        />
      )}
      <HomePage
        {...props}
        initialBrands={brands}
        initialBestSellers={bestSellers}
        initialBanners={banners}
        initialSellerCta={sellerCta}
        initialCategories={categories}
        initialRecommended={recommended}
        initialOffers={offersList}
        initialPromoBlocks={promoBlocks}
        initialHomeSeoBlock={homeSeoBlock}
      />
    </>
  );
}
