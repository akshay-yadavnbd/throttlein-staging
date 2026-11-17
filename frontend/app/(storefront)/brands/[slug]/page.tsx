import { SITE_URL } from '@/lib/siteUrl';
/**
 * Brand landing route — `/brands/<slug>`.
 *
 * Server wrapper that emits SEO metadata before handing off to the
 * client `<BrandPage>` for the interactive product grid. The brand
 * record is looked up via the public list endpoint (filtered by slug
 * server-side) so this stays cache-friendly.
 */

import type { Metadata } from 'next';
import BrandPage from '@/components/pages/BrandPage';
import JsonLd from '@/components/seo/JsonLd';
import { brandSchema, absoluteImageUrl, DEFAULT_OG_IMAGE } from '@/lib/jsonLd';
import { API_URL, dataOf } from '@/lib/api';



type RouteProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    // The public brands endpoint returns the whole list; we filter by
    // slug here so the SEO metadata mirrors the client view. Cheap to
    // cache because brands change rarely.
    const res = await fetch(`${API_URL}/brands?active=1`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return { title: 'Brand · THROTTLEIN' };
    const data = dataOf(await res.json());
    const list = (data?.items || data?.brands || []) as Array<{
      name: string; slug?: string; logo?: string; description?: string;
      seoTitle?: string; seoDescription?: string; ogImage?: string;
    }>;
    const brand = list.find((b) => b.slug === slug);
    if (!brand) return { title: 'Brand not found · THROTTLEIN' };

    // Does this brand have any active products? Same check the brands
    // sitemap uses (`withProducts=1`). If the lookup fails we leave the
    // page indexable rather than risk noindexing a real brand.
    let isEmpty = false;
    try {
      const withRes = await fetch(`${API_URL}/brands?active=1&withProducts=1`, {
        next: { revalidate: 300 },
      });
      if (withRes.ok) {
        const withData = dataOf(await withRes.json());
        const withList = (withData?.items || withData?.brands || []) as Array<{ slug?: string }>;
        isEmpty = !withList.some((b) => b.slug === (brand.slug || slug));
      }
    } catch {
      /* keep indexable */
    }

    // Per-brand SEO overrides win over the auto-built defaults.
    const autoTitle = `${brand.name} — Bike Gear · THROTTLEIN`;
    const title = brand.seoTitle?.trim() ? brand.seoTitle.trim() : autoTitle;
    const descRaw =
      brand.seoDescription?.trim() ||
      brand.description ||
      `Shop genuine ${brand.name} motorcycle parts, helmets, and gear on THROTTLEIN — authentic products from verified sellers, fast delivery across India.`;
    const description = descRaw.slice(0, 160);

    const canonical = `${SITE_URL}/brands/${brand.slug || slug}`;
    // OG image: seller-set override > brand logo > site-wide default.
    const ogImage =
      absoluteImageUrl(brand.ogImage) ||
      absoluteImageUrl(brand.logo) ||
      DEFAULT_OG_IMAGE;

    return {
      title,
      description,
      alternates: { canonical },
      // No products → noindex (links still followed). Removed automatically
      // once the brand gets a product.
      ...(isEmpty ? { robots: { index: false, follow: true } } : {}),
      openGraph: {
        type: 'website',
        title,
        description,
        url: canonical,
        siteName: 'THROTTLEIN',
        images: [{ url: ogImage, alt: brand.name }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [ogImage],
      },
    };
  } catch {
    return { title: 'Brand · THROTTLEIN' };
  }
}

/** Lookup helper so the JSON-LD block below uses the same record the
 *  metadata function resolved — Next.js dedupes the identical fetch
 *  inside one request so it's cheap. */
async function fetchBrandForJsonLd(
  slug: string
): Promise<{ name: string; slug?: string; logo?: string; website?: string; description?: string } | null> {
  try {
    const res = await fetch(`${API_URL}/brands?active=1`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = dataOf(await res.json());
    const list = (data?.items || data?.brands || []) as Array<{
      name: string; slug?: string; logo?: string; website?: string; description?: string;
    }>;
    return list.find((b) => b.slug === slug) || null;
  } catch {
    return null;
  }
}

/** First N products tagged with this brand — feeds the ItemList JSON-LD
 *  so the SERP entry can fan out into a product carousel. */
async function fetchTopProductsForBrand(
  slug: string,
  limit = 10
): Promise<Array<{ name: string; slug: string }>> {
  try {
    const res = await fetch(
      `${API_URL}/products?brand=${encodeURIComponent(slug)}&limit=${limit}`,
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

export default async function Page(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const [brand, topProducts] = await Promise.all([
    fetchBrandForJsonLd(slug),
    fetchTopProductsForBrand(slug),
  ]);

  // Brand entity JSON-LD — tells Google what the page is about (a
  // brand, not a product / blog post). `sameAs` links to the official
  // brand website so the knowledge-graph entries get cross-linked.
  const brandJsonLd = brand
    ? brandSchema({
        slug: brand.slug || slug,
        name: brand.name,
        description: brand.description,
        logo: brand.logo,
        sameAs: brand.website ? [brand.website] : undefined,
      })
    : null;

  // Breadcrumb — Home › Brands › <brand-name>. Tells Google the page
  // sits one level under the /brands index, which helps both rich
  // snippets and breadcrumb navigation in mobile SERPs.
  const breadcrumbJsonLd = brand
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
          { '@type': 'ListItem', position: 2, name: 'Brands', item: `${SITE_URL}/brands` },
          {
            '@type': 'ListItem',
            position: 3,
            name: brand.name,
            item: `${SITE_URL}/brands/${brand.slug || slug}`,
          },
        ],
      }
    : null;

  // ItemList — declares this brand page as a curated list of N products.
  // Google can render the SERP entry as a product carousel.
  const itemListJsonLd =
    brand && topProducts.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: `${brand.name} — products`,
          numberOfItems: topProducts.length,
          itemListElement: topProducts.map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: `${SITE_URL}/product/${p.slug}`,
            name: p.name,
          })),
        }
      : null;

  return (
    <>
      {brandJsonLd && <JsonLd data={brandJsonLd} />}
      {breadcrumbJsonLd && <JsonLd data={breadcrumbJsonLd} />}
      {itemListJsonLd && <JsonLd data={itemListJsonLd} />}
      {/* SSR the brand + first page of products so the H1 (brand
          name), description, logo, and product cards are in the
          initial HTML. Client useEffects refresh on hydration. */}
      <BrandPage
        {...(props as any)}
        initialBrand={brand}
        initialProducts={topProducts}
      />
    </>
  );
}
