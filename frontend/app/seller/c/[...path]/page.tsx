import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import ProsePage from '@/components/pages/ProsePage';
import DynamicPage from '@/components/pages/DynamicPage';
import JsonLd from '@/components/seo/JsonLd';
import { API_URL, dataOf } from '@/lib/api';
import { originForSite } from '@/lib/site';
import { resolvePage, type ResolvedPage } from '@/lib/pageResolver';
import { resolveSellerBodyLinks } from '@/lib/sellerBodyLinks';
import { isSellerCategoryTemplate } from '@/lib/sellerPageRoutes';
import { absoluteImageUrl, DEFAULT_OG_IMAGE } from '@/lib/jsonLd';
import { sellerContentUrl } from '@/lib/sellerUrl';
import {
  faqFromMarkdown,
  sellerServiceJsonLd,
  sellerWebPageGraphJsonLd,
} from '@/lib/structuredData';
import { fetchTestimonials } from '@/lib/testimonials';
import SellerCategoryPage, {
  type SellerCategoryData,
  type CategoryTile,
} from '@/components/pages/SellerCategoryPage';
import SellerCategoryPage2 from '@/components/pages/SellerCategoryPage2';

/**
 * Seller-property CMS catch-all — `/seller/c/<public path>`.
 *
 * This route is NEVER visited directly. `proxy.ts` rewrites every
 * unmatched path on `seller.throttlein.com` into this namespace,
 * preserving the public path verbatim:
 *
 *   seller.throttlein.com/about          → /seller/c/about
 *   seller.throttlein.com/page/returns   → /seller/c/page/returns
 *   seller.throttlein.com/helmets        → /seller/c/helmets
 *
 * Keeping the path verbatim under a fixed prefix is what lets the
 * backend's `pageToRoute()` compute the exact same string when it calls
 * revalidatePath after an admin save — ISR keys on the internal path,
 * not the public URL.
 *
 * WHY A CATCH-ALL RATHER THAN MIRRORED ROUTE FILES
 * The proxy cannot know whether a given path is a CMS page without a
 * database lookup, and doing one per request would put a network hop on
 * the hot path. So it rewrites optimistically and this route decides:
 * render the page, or 404 via `app/seller/not-found.tsx` — the seller
 * property's own 404, with seller chrome and a link across to the
 * storefront for anyone who meant to shop.
 */

const SELLER_ORIGIN = originForSite('seller');
const MAIN_ORIGIN = originForSite('main');

type RouteProps = { params: Promise<{ path: string[] }> };

type ProseDoc = {
  _id: string;
  slug: string;
  title: string;
  body?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogImage?: string;
  updatedAt?: string;
  createdAt?: string;
  /** Optional here, required by ProsePage's own `Page` type. Optional
   *  because the PUBLIC endpoint only ever returns published pages, so
   *  the field is redundant on the wire — but ProsePage shares its type
   *  with the client refetch, where an unpublished page is possible. */
  isPublished?: boolean;
};

/** Rebuild the public path from the catch-all segments. */
function publicPath(segments: string[]): string {
  return `/${(segments || []).join('/')}`;
}

/**
 * Does this path exist on the MAIN property?
 *
 * Safety net for wrong-domain URLs that are already out in the wild:
 * before the storefront chrome was scoped to its route group, every
 * seller page shipped hidden Navbar/Footer markup, and crawlers indexed
 * its relative links against the seller host — seller.throttlein.com
 * /helmets, /brands, /axor, /faqs, /privacy-policy and ~25 more, all
 * 404 (flagged by the SEO audit). Those URLs will keep receiving crawler
 * and user hits for a long time; a 301 to the SAME PATH on the main
 * origin — where it genuinely resolves — is the correct answer for both.
 *
 * The probe is a GET against our own main property, cached for an hour
 * per path (GET rather than HEAD because Next's data cache only caches
 * GETs). It only runs on catch-all MISSES, which are off the hot path
 * by definition. `redirect: 'manual'` — a redirect answer from main
 * (e.g. its own legacy 301s) still counts as "main owns this path";
 * following it would just waste a hop here.
 */
async function mainSiteHasPath(path: string): Promise<boolean> {
  try {
    const res = await fetch(`${MAIN_ORIGIN}${path}`, {
      redirect: 'manual',
      next: { revalidate: 3600 },
    });
    return res.ok || (res.status >= 300 && res.status < 400);
  } catch {
    return false;
  }
}

/** Fetch a seller-site prose page by slug. */
async function fetchProse(slug: string): Promise<ProseDoc | null> {
  try {
    const res = await fetch(
      `${API_URL}/pages/${encodeURIComponent(slug)}?site=seller`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    const data = dataOf(await res.json());
    return data?.page || null;
  } catch {
    return null;
  }
}

type Resolution =
  | { kind: 'prose'; page: ProseDoc; path: string }
  | { kind: 'dynamic'; page: ResolvedPage; path: string }
  | { kind: 'seller-category'; data: SellerCategoryData; page: ResolvedPage; path: string }
  | { kind: 'moved'; to: string; path: string }
  | { kind: 'miss'; path: string };

/**
 * Build the props for a seller-category page.
 *
 * The Types and Brands grids read the page's own admin selections; see the
 * note inside. Both sections are optional — a page with nothing selected
 * simply doesn't render them.
 */
async function buildSellerCategory(page: ResolvedPage): Promise<SellerCategoryData> {
  const sc: Record<string, any> = (page as any).sellerCategory || {};
  const f: Record<string, any> = (page as any).filter || {};

  /**
   * Types and Brands come from the page's OWN admin selections —
   * `filter.categories` and `filter.brands` — not from anything derived.
   *
   * They were previously computed from the primary category's children and
   * whichever brands existed under it, which meant the grids could show
   * things nobody chose and silently change as the catalogue grew. Reading
   * the explicit selection makes the page show exactly what the editor
   * picked, in the order they picked it, and needs no extra requests: the
   * resolve endpoint already populates both arrays.
   */
  const toTile = (x: any, imageKey: 'icon' | 'logo'): CategoryTile => ({
    name: x?.name || '',
    slug: x?.slug || '',
    image: x?.[imageKey] || x?.image || '',
  });

  const types: CategoryTile[] = (Array.isArray(f.categories) ? f.categories : [])
    // Unpopulated entries arrive as bare id strings — skip rather than
    // rendering a nameless tile.
    .filter((c: any) => c && typeof c === 'object')
    .map((c: any) => toTile(c, 'icon'))
    .filter((t: CategoryTile) => t.name);

  const brands: CategoryTile[] = (Array.isArray(f.brands) ? f.brands : [])
    .filter((b: any) => b && typeof b === 'object')
    .map((b: any) => toTile(b, 'logo'))
    .filter((t: CategoryTile) => t.name);

  return {
    title: page.title,
    noun: sc.noun || '',
    nounPlural: sc.nounPlural || '',
    heroBodyOne: sc.heroBodyOne || '',
    heroBodyTwo: sc.heroBodyTwo || '',
    heroImage: sc.heroImage || '',
    expandHeading: sc.expandHeading || '',
    expandBody: sc.expandBody || '',
    expandImage: sc.expandImage || '',
    whyHeading: sc.whyHeading || '',
    whyIntro: sc.whyIntro || '',
    whyCards: Array.isArray(sc.whyCards) ? sc.whyCards : [],
    stepsHeading: sc.stepsHeading || '',
    stepsIntro: sc.stepsIntro || '',
    steps: Array.isArray(sc.steps) ? sc.steps : [],
    closingImage: sc.closingImage || '',
    eligibilityBody: sc.eligibilityBody || '',
    eligibilityIntro: sc.eligibilityIntro || '',
    eligibilityItems: Array.isArray(sc.eligibilityItems) ? sc.eligibilityItems : [],
    eligibilityFootnote: sc.eligibilityFootnote || '',
    eligibilityImage: sc.eligibilityImage || '',
    eligibilityHeading: sc.eligibilityHeading || '',
    eligibilityImages: Array.isArray(sc.eligibilityImages) ? sc.eligibilityImages : [],
    // Video block — the renderer omits the whole section when videoId
    // is blank, so an unconfigured page shows nothing rather than a
    // play button that goes nowhere.
    videoHeading: sc.videoHeading || '',
    videoThumbnail: sc.videoThumbnail || '',
    videoId: sc.videoId || '',
    faq: Array.isArray(sc.faq) ? sc.faq : [],
    types,
    brands,
    // Admin-managed success stories, shared by every seller-category page.
    // Fetched here rather than inside the component because the component
    // is a client component — and its own fallback means a failed fetch
    // degrades to the built-in card rather than an empty section.
    testimonials: await fetchTestimonials('seller'),
  };
}

/**
 * Work out what, if anything, lives at this path on the seller site.
 *
 * Mirrors the main site's URL shapes:
 *   /page/<slug>  → prose page
 *   /<slug>       → top-level dynamic page
 *
 * Deliberately NOT supported yet: the main site's 2- and 3-segment
 * category/brand URL shapes. The seller property has no product catalog
 * of its own, so there are no categories to nest pages under. Add them
 * here alongside a `resolvePage(parent, slug, brand, 'seller')` call if
 * that changes.
 */
async function resolve(segments: string[]): Promise<Resolution> {
  const path = publicPath(segments);

  if (segments.length === 2 && segments[0] === 'page') {
    const page = await fetchProse(segments[1]);
    if (page) return { kind: 'prose', page, path };
    return { kind: 'miss', path };
  }

  // /sell-online/<slug> — a seller-category landing page. Nested under the
  // Sell Online page, which is the parent every one of them hangs off.
  if (segments.length === 2 && segments[0] === 'sell-online') {
    const resolved = await resolvePage(undefined, segments[1], undefined, 'seller');
    // Both layout variants share this URL shape — the template picks the
    // renderer, not the address (see the render branch below).
    if (resolved && isSellerCategoryTemplate(resolved.template)) {
      return {
        kind: 'seller-category',
        data: await buildSellerCategory(resolved),
        page: resolved,
        path,
      };
    }
    return { kind: 'miss', path };
  }

  if (segments.length === 1) {
    // A bare slug can be either a prose page or a dynamic one.
    //
    // The `type` check is essential: resolvePage() resolves by slug and
    // returns ANY page type, prose included. While prose only ever arrived
    // via the 2-segment `/page/<slug>` branch this was harmless. Now that
    // prose pages live at the property ROOT, an unchecked result routes them
    // through DynamicPage — which renders `body` without markdown parsing, so
    // the page came out as literal `**bold**` and `## headings`, with no H1
    // block and no table of contents (the ToC is built from parsed headings).
    //
    // Only accept a genuinely dynamic page here; anything else falls through
    // to the prose fetch below. Slugs are unique per site, so exactly one of
    // the two can match.
    const resolved = await resolvePage(undefined, segments[0], undefined, 'seller');
    // seller-category pages are ALSO type='dynamic', but they belong at
    // /sell-online/<slug>. Without this they'd render here too — as the generic
    // DynamicPage product grid — giving the same page two URLs with completely
    // different layouts, and letting the wrong one get indexed.
    if (resolved && isSellerCategoryTemplate(resolved.template)) {
      return { kind: 'moved', to: `/sell-online/${resolved.slug}`, path };
    }
    if (resolved && resolved.type === 'dynamic') {
      return { kind: 'dynamic', page: resolved, path };
    }
    const prose = await fetchProse(segments[0]);
    if (prose) return { kind: 'prose', page: prose, path };
  }

  return { kind: 'miss', path };
}

function stripHtml(s?: string): string {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { path: segments } = await params;
  const found = await resolve(segments);

  // On a miss the page calls `notFound()`, which renders
  // app/seller/not-found.tsx. Next does NOT apply that file's own
  // `metadata` export when the 404 is triggered from a page — the
  // route's metadata wins — so returning `{}` here left the tab showing
  // the root layout's default storefront title on a seller 404. Supply
  // the 404 metadata from this side instead.
  // A 301 needs no metadata — the crawler follows it.
  if (found.kind === 'moved') return { robots: { index: false, follow: true } };

  if (found.kind === 'miss') {
    // Mirror the page's safety net: a miss that 301s to the main origin
    // needs no 404 metadata either.
    if (await mainSiteHasPath(found.path)) {
      return { robots: { index: false, follow: true } };
    }
    return {
      title: '404 — Page not found · THROTTLEIN Seller Hub',
      robots: { index: false, follow: false },
    };
  }

  const page = found.page as ProseDoc & ResolvedPage;
  const title = page.seoTitle?.trim() || page.title || 'THROTTLEIN Sellers';
  const description =
    page.seoDescription?.trim() ||
    stripHtml((page as ProseDoc).body).slice(0, 160) ||
    undefined;
  // Canonical points at the SELLER origin. Without this the page would
  // canonicalise to throttlein.com and Google would drop it as a
  // duplicate of a URL that doesn't exist.
  const canonical = `${SELLER_ORIGIN}${found.path}`;
  /**
   * Social preview image: the page's own upload, else the site-wide
   * hero. This block emitted no `images` at all, so every seller CMS
   * page (seller-faq, pricing-and-fees, the policies, the category
   * landing pages) previewed as bare text when shared. `twitter` was
   * declaring `summary_large_image` while supplying no image, which is
   * the card type most likely to be dropped outright without one.
   */
  const ogImage = absoluteImageUrl((page as ProseDoc).ogImage) || DEFAULT_OG_IMAGE;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title,
      description,
      url: canonical,
      siteName: 'THROTTLEIN Sellers',
      locale: 'en_IN',
      images: [{ url: ogImage }],
      modifiedTime: page.updatedAt || undefined,
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
  };
}

export default async function SellerContentPage(props: RouteProps) {
  const { path: segments } = await props.params;
  const found = await resolve(segments);

  // Branches are ordered hit-first, with the miss last. Putting the miss
  // case first would leave the compiler relying on `notFound(): never`
  // to narrow the union — true today, but a silent breakage if that
  // signature ever changes. Exhausting the hits first means the
  // narrowing is structural.
  if (found.kind === 'prose') {
    // In-content links are authored as same-origin paths (`/pricing-and-fees`),
    // which is wrong on this property in both directions — seller pages need
    // the /seller prefix in dev, and main-site policies need the storefront
    // origin. Resolve each against whichever property owns the slug.
    const page = {
      ...found.page,
      body: await resolveSellerBodyLinks(found.page.body || ''),
    };
    /* [WebPage + BreadcrumbList] @graph per the supplied template, plus
       FAQPage derived from the page's own `## Question?` headings — it
       exists exactly when the page HAS Q&A content and can't drift
       from it. Publisher/isPartOf are @id references into the layout's
       Organization/WebSite nodes. */
    const pageUrl = `${SELLER_ORIGIN}${found.path}`;
    const webPageGraphLd = sellerWebPageGraphJsonLd({
      name: page.title,
      description: stripHtml(page.body)
        ? stripHtml(page.body).slice(0, 200)
        : undefined,
      url: pageUrl,
      crumbs: [
        { name: 'Seller Home', url: `${SELLER_ORIGIN}/` },
        { name: page.title, url: pageUrl },
      ],
      webPageExtra: {
        ...(page.updatedAt ? { dateModified: page.updatedAt } : {}),
        ...(page.createdAt ? { datePublished: page.createdAt } : {}),
      },
    });
    const faqLd = faqFromMarkdown(page.body || '');

    // ProsePage expects `params: Promise<{ slug }>` — it calls `use()`
    // on it and refetches client-side by slug. Our catch-all params are
    // `{ path: string[] }`, so hand it a synthetic promise carrying the
    // resolved slug rather than spreading our own props through.
    // (The client refetch picks the right property up automatically:
    // lib/api.ts sends X-Site from window.location.host.)
    return (
      <>
        <JsonLd data={webPageGraphLd} />
        {faqLd && <JsonLd data={faqLd} />}
        <ProsePage
          params={Promise.resolve({ slug: page.slug })}
          // `isPublished` is required by ProsePage but absent from the
          // public payload — reaching this branch at all means the page
          // IS published, since the endpoint filters unpublished ones out.
          initialPage={{ ...page, isPublished: page.isPublished !== false }}
        />
      </>
    );
  }

  if (found.kind === 'moved') {
    // 301 rather than render: one canonical URL per page.
    permanentRedirect(sellerContentUrl(found.to));
  }

  if (found.kind === 'seller-category') {
    const d = found.data;
    // FAQPage JSON-LD — these pages exist to rank, and the accordion is the
    // part Google can surface directly.
    const faqLd = d.faq?.length
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: d.faq.map((f) => ({
            '@type': 'Question',
            name: f.question,
            // Answers are rich text (HTML) since the admin FAQ editor moved
            // to the blog-style editor; structured data wants plain text.
            acceptedAnswer: { '@type': 'Answer', text: stripHtml(f.answer) },
          })),
        }
      : null;

    /* [WebPage + BreadcrumbList] @graph and the Service block per the
       supplied templates — the blocks the schema audit flagged missing
       on every seller-category landing page. */
    const pageUrl = `${SELLER_ORIGIN}${found.path}`;
    const webPageGraphLd = sellerWebPageGraphJsonLd({
      name: found.page.title,
      description: d.heroBodyOne || undefined,
      url: pageUrl,
      crumbs: [
        { name: 'Seller Home', url: `${SELLER_ORIGIN}/` },
        { name: 'Sell Online', url: `${SELLER_ORIGIN}/sell-online` },
        { name: found.page.title, url: pageUrl },
      ],
    });
    const serviceLd = sellerServiceJsonLd({
      name: found.page.title,
      description: d.heroBodyOne || undefined,
      url: pageUrl,
    });

    return (
      <>
        <JsonLd data={webPageGraphLd} />
        <JsonLd data={serviceLd} />
        {faqLd && <JsonLd data={faqLd} />}
        {/* Same data, two layouts — the template field picks the renderer. */}
        {found.page.template === 'seller-category-2' ? (
          <SellerCategoryPage2 data={d} />
        ) : (
          <SellerCategoryPage data={d} />
        )}
      </>
    );
  }

  if (found.kind === 'dynamic') {
    return <DynamicPage page={found.page} />;
  }

  // Nothing here on the seller property. Before 404ing, check whether
  // the MAIN property owns this exact path — storefront URLs were
  // indexed against the seller host for months (see mainSiteHasPath),
  // and those deserve a 301 to the page the visitor actually wanted.
  // This is NOT the old blanket redirect this branch once had: that
  // bounced EVERY miss to the main origin, where unknown paths then
  // 404'd — a soft-404. The probe means we only redirect when the
  // destination genuinely resolves.
  if (await mainSiteHasPath(found.path)) {
    permanentRedirect(`${MAIN_ORIGIN}${found.path}`);
  }

  // A real 404 ON THIS DOMAIN, rendered by app/seller/not-found.tsx
  // (seller chrome, seller recovery links, plus a visible link across
  // to the storefront so nobody is stranded).
  notFound();
}
