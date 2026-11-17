import { SITE_URL } from '@/lib/siteUrl';
/**
 * Category landing route — `/<slug>` (root-level URL).
 *
 * Server wrapper that emits SEO metadata before handing off to the
 * client `<CategoryPage>` for the interactive filter sidebar + grid.
 *
 * URL history:
 *   - `/products/category/<slug>` (original — verbose)
 *   - `/c/<slug>` (interim shortening)
 *   - `/<slug>` (current — flat, SEO-friendly)
 *
 * Both prior paths 301-redirect here via `next.config.js`. The folder
 * is `[slug]/` (not `[categorySlug]/`) so its sibling dynamic-page
 * routes (`[slug]/[middleSlug]/page.tsx` and the 3-seg variant) can
 * coexist — Next.js requires sibling dynamic segments under the same
 * parent to share their parameter name.
 *
 * Reserved-word guard: when the slug doesn't match a real Category in
 * the public tree, we call notFound() instead of rendering an empty
 * grid. That keeps unknown URLs out of search engine indexes and gives
 * the user the proper 404 page.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import CategoryPage from '@/components/pages/CategoryPage';
import ProsePage from '@/components/pages/ProsePage';
import DynamicPage from '@/components/pages/DynamicPage';
import { resolvePage } from '@/lib/pageResolver';
import JsonLd from '@/components/seo/JsonLd';
import { collectionPageSchema, absoluteImageUrl, DEFAULT_OG_IMAGE } from '@/lib/jsonLd';
import { API_URL, dataOf } from '@/lib/api';



type RouteProps = { params: Promise<{ slug: string }> };

type ProsePageRecord = {
  _id: string;
  slug: string;
  title: string;
  type?: string;
  body?: string;
  seoTitle?: string;
  seoDescription?: string;
  isPublished?: boolean;
  updatedAt?: string;
  createdAt?: string;
};

/** Fetch a CMS prose page by slug. Returns null unless it's a published
 *  `type:'prose'` page — so dynamic / home / static-meta records don't
 *  accidentally render at the root URL. Lets pages like Privacy Policy
 *  and Terms live at the clean `/<slug>` instead of `/page/<slug>`. */
async function fetchProsePage(slug: string): Promise<ProsePageRecord | null> {
  try {
    const res = await fetch(`${API_URL}/pages/${encodeURIComponent(slug)}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = dataOf(await res.json());
    const page = data?.page as ProsePageRecord | undefined;
    if (!page || page.type !== 'prose') return null;
    return page;
  } catch {
    return null;
  }
}

/** Strip HTML/markdown-ish tags for a plain-text meta description. */
function stripHtml(s?: string): string {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_`>-]/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Walk a nested category tree looking for a node with the target slug. */
function findInTree(
  nodes: any[],
  target: string
): {
  name: string;
  description?: string;
  icon?: string;
  // Admin-authored SEO overrides — used by generateMetadata below.
  seoTitle?: string;
  seoDescription?: string;
  // Set by `/categories?hasProducts=1` — false when nothing in this
  // node's subtree has a visible product.
  hasProducts?: boolean;
} | null {
  for (const n of nodes || []) {
    if (n?.slug === target) return n;
    const hit = findInTree(n?.children || [], target);
    if (hit) return hit;
  }
  return null;
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    // `hasProducts=1` marks every node whose subtree has at least one
    // visible product (same check the sitemap uses), so empty categories,
    // sub-categories and Shop-by-Bike makes/models can be noindexed below.
    const res = await fetch(`${API_URL}/categories?hasProducts=1`, {
      next: { revalidate: 300 },
    });
    const data = res.ok ? dataOf(await res.json()) : null;
    const node = data ? findInTree(data?.tree || [], slug) : null;
    if (!node) {
      // Not a category — try a CMS prose page (Privacy Policy, Terms, …).
      const page = await fetchProsePage(slug);
      if (!page) {
        // Not prose either — try a top-level dynamic page (admin-created
        // products-list / brands-list / categories-list at /<slug>).
        const dyn = await resolvePage(undefined, slug);
        if (!dyn) return { title: 'Page not found · THROTTLEIN' };
        const dTitle = (dyn.seoTitle?.trim()) || `${dyn.title} · THROTTLEIN`;
        const dDesc =
          (dyn.seoDescription?.trim()) ||
          stripHtml(dyn.body).slice(0, 160) ||
          undefined;
        const dCanonical = `${SITE_URL}/${dyn.slug}`;
        return {
          title: dTitle,
          description: dDesc,
          alternates: { canonical: dCanonical },
          openGraph: {
            type: 'website',
            title: dTitle,
            description: dDesc,
            url: dCanonical,
            siteName: 'THROTTLEIN',
            ...(dyn.ogImage ? { images: [{ url: dyn.ogImage }] } : {}),
          },
          twitter: {
            card: 'summary_large_image',
            title: dTitle,
            description: dDesc,
            ...(dyn.ogImage ? { images: [dyn.ogImage] } : {}),
          },
        };
      }
      const pTitle = (page.seoTitle?.trim()) || page.title || 'THROTTLEIN';
      const pDesc =
        (page.seoDescription?.trim()) ||
        stripHtml(page.body).slice(0, 160) ||
        undefined;
      const pCanonical = `${SITE_URL}/${page.slug}`;
      return {
        title: pTitle,
        description: pDesc,
        alternates: { canonical: pCanonical },
        openGraph: {
          type: 'article',
          title: pTitle,
          description: pDesc,
          url: pCanonical,
          siteName: 'THROTTLEIN',
          locale: 'en_IN',
          modifiedTime: page.updatedAt || undefined,
        },
        twitter: { card: 'summary_large_image', title: pTitle, description: pDesc },
      };
    }

    const name = node.name;
    // Prefer the admin-authored SEO overrides when present. The Category
    // admin panel exposes `seoTitle` (max ~60 chars) and `seoDescription`
    // (max ~160 chars); these win over the fallback templates so the
    // marketing team can tune what actually renders in Google. Falls
    // through to the generated string when the seller hasn't set them.
    const title =
      (node.seoTitle && String(node.seoTitle).trim()) ||
      `${name} for Bikes · THROTTLEIN`;
    const description = (
      (node.seoDescription && String(node.seoDescription).trim()) ||
      node.description ||
      `Browse ${name.toLowerCase()} for motorcycles on THROTTLEIN — top brands, fast delivery, verified sellers across India.`
    ).slice(0, 160);

    const canonical = `${SITE_URL}/${slug}`;
    const iconAbs = absoluteImageUrl(node.icon);
    // Category icons are often tiny outline SVGs (bad OG previews),
    // so fall back to the site-wide hero when the icon isn't a real
    // raster image URL.
    const ogImage =
      iconAbs && !iconAbs.startsWith('data:')
        ? iconAbs
        : DEFAULT_OG_IMAGE;

    // No products in this category (or anywhere below it) → keep it out of
    // search results but let crawlers follow its links. Becomes indexable
    // again automatically once a product is added. Only an explicit `false`
    // counts, so an API without the flag never noindexes a real category.
    const isEmpty = node.hasProducts === false;

    return {
      title,
      description,
      alternates: { canonical },
      ...(isEmpty ? { robots: { index: false, follow: true } } : {}),
      openGraph: {
        type: 'website',
        title,
        description,
        url: canonical,
        siteName: 'THROTTLEIN',
        images: [{ url: ogImage, alt: name }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [ogImage],
      },
    };
  } catch {
    return { title: 'THROTTLEIN' };
  }
}

/** Pull the category tree once per request — feeds both notFound() and
 *  the JSON-LD blob below. Next.js dedupes the identical fetch with
 *  the one inside generateMetadata. */
async function fetchCategoryNode(
  slug: string
): Promise<{ name: string } | null> {
  try {
    const res = await fetch(`${API_URL}/categories`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = dataOf(await res.json());
    return findInTree(data?.tree || [], slug) as { name: string } | null;
  } catch {
    return null;
  }
}

/** First page of full products for SSR'd category cards. Returns the
 *  raw items array (full Product shape so the client component can
 *  render image, price, ratings, etc. in the initial HTML). Cached for
 *  5 min — same as the categories tree above. */
async function fetchInitialCategoryProducts(
  slug: string,
  limit = 24,
): Promise<{ items: any[]; total: number }> {
  try {
    const res = await fetch(
      `${API_URL}/products?category=${encodeURIComponent(slug)}&limit=${limit}&sort=newest`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return { items: [], total: 0 };
    const data = dataOf(await res.json());
    return {
      items: Array.isArray(data?.items) ? data.items : [],
      total: typeof data?.total === 'number' ? data.total : (data?.items?.length || 0),
    };
  } catch {
    return { items: [], total: 0 };
  }
}

/** First N products in the category — feeds the ItemList JSON-LD so
 *  Google can render this page as a product carousel in search results. */
async function fetchTopProductsForCategory(
  slug: string,
  limit = 10
): Promise<Array<{ name: string; slug: string }>> {
  try {
    const res = await fetch(
      `${API_URL}/products?category=${encodeURIComponent(slug)}&limit=${limit}`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return [];
    const data = dataOf(await res.json());
    return (data?.items || [])
      .filter((p: any) => p?.slug && p?.name)
      .map((p: any) => ({ name: p.name, slug: p.slug }));
  } catch {
    return [];
  }
}

export default async function Page(props: RouteProps) {
  const { slug } = await props.params;
  const node = await fetchCategoryNode(slug);

  // Unknown slug → first try a CMS prose page (Privacy Policy, Terms,
  // Shipping, etc.) so those render at the clean root URL `/<slug>`.
  // Only `type:'prose'` published pages qualify (see fetchProsePage).
  if (!node) {
    const page = await fetchProsePage(slug);
    if (!page) {
      // Not a category or prose page — try a top-level dynamic page
      // (admin-created products-list / brands-list / categories-list
      // living at /<slug> with no category URL prefix).
      const dyn = await resolvePage(undefined, slug);
      if (dyn) return <DynamicPage page={dyn} />;
      // Still nothing → 404. Important because `[slug]` is a root-level
      // catch-all — without this guard, every random URL like `/asdf`
      // would render the category page with an empty grid, polluting the
      // search index and confusing visitors.
      notFound();
    }

    const articleJsonLd: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
      ...(stripHtml(page.body)
        ? { description: stripHtml(page.body).slice(0, 200) }
        : {}),
      url: `${SITE_URL}/${page.slug}`,
      ...(page.updatedAt ? { dateModified: page.updatedAt } : {}),
      ...(page.createdAt ? { datePublished: page.createdAt } : {}),
      inLanguage: 'en-IN',
      // Reference the Organization emitted by the root layout by @id
      // so both graphs merge into one publisher node.
      publisher: { '@id': `${SITE_URL}/#organization` },
    };

    return (
      <>
        <JsonLd data={articleJsonLd} />
        <ProsePage params={props.params} initialPage={page as any} />
      </>
    );
  }

  // Run the ItemList fetch and the SSR products fetch in parallel —
  // both hit /products with the same category param so the API
  // doesn't double-handle the request.
  const [topProducts, initialProducts] = await Promise.all([
    fetchTopProductsForCategory(slug),
    fetchInitialCategoryProducts(slug),
  ]);
  const displayName = node.name;

  // Breadcrumb — Home › <category-name>.
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      {
        '@type': 'ListItem',
        position: 2,
        name: displayName,
        item: `${SITE_URL}/${slug}`,
      },
    ],
  };

  // ItemList — declares this URL as a category landing with N products.
  // Google uses this to optionally show a product carousel under the
  // SERP entry. Only emitted when we actually have products to list.
  const itemListJsonLd =
    topProducts.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: `${displayName} — products`,
          numberOfItems: topProducts.length,
          itemListElement: topProducts.map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: `${SITE_URL}/product/${p.slug}`,
            name: p.name,
          })),
        }
      : null;

  const collectionJsonLd = collectionPageSchema({
    url: `${SITE_URL}/${slug}`,
    name: `${displayName} for Bikes`,
    description: `Browse ${displayName.toLowerCase()} for motorcycles on ThrottleIn — top brands, fast delivery, verified sellers across India.`,
  });

  return (
    <>
      <JsonLd data={collectionJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      {itemListJsonLd && <JsonLd data={itemListJsonLd} />}
      {/* SSR the category name (so the H1 matches the DB record, not
          the slug-derived guess) and the first page of products so
          the grid is in the initial HTML. */}
      <CategoryPage
        {...(props as any)}
        // On-page copy precedence: the admin's Top Content fields win,
        // then the category's name / free-form description, then
        // CategoryPage's own defaults. seoDescription is deliberately
        // NOT shown on-page anymore — it's meta-only copy (it used to
        // double as the subtitle before Top Content existed, which made
        // the two admin fields fight over the same line).
        titleOverride={
          ((node as any).contentTitle && String((node as any).contentTitle).trim()) ||
          displayName
        }
        descriptionOverride={
          ((node as any).contentDescription && String((node as any).contentDescription).trim()) ||
          ((node as any).description && String((node as any).description).trim()) ||
          undefined
        }
        initialItems={initialProducts.items}
        initialTotal={initialProducts.total}
      />
    </>
  );
}
