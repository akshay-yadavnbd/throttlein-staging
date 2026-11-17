import { SITE_URL } from '@/lib/siteUrl';
/**
 * Product detail route — `/product/<slug>`.
 *
 * The page component itself is the client-side `<ProductDetailPage>`
 * which fetches its own data and handles interactivity. This server
 * wrapper exists solely to emit SEO metadata: title, description,
 * canonical, OpenGraph + Twitter cards. Without it, the initial HTML
 * served to crawlers has only the root layout's static metadata —
 * Google sees the same `<title>` and `<meta>` on every product page,
 * which kills indexing.
 *
 * Notes:
 *  - The API endpoint at `/products/<slugOrId>` accepts either form, so
 *    a fresh fetch here is cheap and the 60-second revalidate keeps
 *    things snappy.
 *  - The product is 404'd publicly when the seller isn't approved, so a
 *    missing/blocked product naturally lands on this route's notFound().
 */

import type { Metadata } from 'next';
import ProductDetailPage from '@/components/pages/ProductDetailPage';
import JsonLd from '@/components/seo/JsonLd';
import { productSchema, absoluteImageUrl, DEFAULT_OG_IMAGE } from '@/lib/jsonLd';
import { API_URL, dataOf } from '@/lib/api';



type RouteProps = { params: Promise<{ slug: string }> };

/** Pick the best OG image for a product record. Priority:
 *   1. Seller-set `ogImage` override
 *   2. First entry in `product.images`
 *   3. First non-empty bucket in `product.colorImages`
 *   4. Site-wide DEFAULT_OG_IMAGE hero
 *  All results are normalised to absolute URLs via absoluteImageUrl().
 */
function pickProductOgImage(p: any): string {
  const direct =
    absoluteImageUrl(p?.ogImage) ||
    absoluteImageUrl(p?.images?.[0]);
  if (direct) return direct;
  if (Array.isArray(p?.colorImages)) {
    for (const c of p.colorImages) {
      const abs = absoluteImageUrl(
        Array.isArray(c?.images) && c.images.length ? c.images[0] : undefined,
      );
      if (abs) return abs;
    }
  }
  return DEFAULT_OG_IMAGE;
}

function stripHtml(s?: string): string {
  if (!s) return '';
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const res = await fetch(`${API_URL}/products/${encodeURIComponent(slug)}`, {
      // Server-side fetch with light revalidation so admin product edits
      // surface within a minute without paying for an SSR round-trip on
      // every visit.
      next: { revalidate: 60 },
    });
    if (!res.ok) return { title: 'Product not found · THROTTLEIN' };
    const data = dataOf(await res.json());
    const p = data?.product;
    if (!p) return { title: 'Product not found · THROTTLEIN' };

    const brand =
      typeof p.brand === 'object' && p.brand?.name ? p.brand.name : '';
    const baseTitle = brand ? `${p.name} — ${brand}` : p.name;
    // SEO title: seller's explicit `seoTitle` override wins over the
    // auto-built one. Same pattern as the description + ogImage below.
    const autoTitle = `${baseTitle} · THROTTLEIN`;
    const title = p.seoTitle?.trim() ? p.seoTitle.trim() : autoTitle;
    // Description: seller's `seoDescription` wins; then any legacy
    // short_description / metaDescription; then a stripped + clamped
    // version of the rich-text description; then a brand-y fallback.
    //
    // The auto-derived variant is PREFIXED with the product name:
    // colour siblings imported from Shopify share the exact same
    // description body, which produced identical meta descriptions
    // across 5-10 URLs at a time (flagged as duplicates by
    // SEMrush/Search Console). The name differs per colour, so the
    // prefix makes each PDP's description unique.
    const bodyDesc = stripHtml(p.description);
    const descRaw =
      p.seoDescription?.trim() ||
      p.shortDescription ||
      p.metaDescription ||
      (bodyDesc ? `${p.name} — ${bodyDesc}` : '') ||
      `${p.name} available on THROTTLEIN — premium motorcycle parts and gear from trusted sellers.`;
    const description = descRaw.slice(0, 160);

    const canonical = `${SITE_URL}/product/${p.slug || slug}`;
    // OG image: seller override > first product image > first
    // colorImages bucket > site-wide DEFAULT_OG_IMAGE. See
    // pickProductOgImage() for the fallback chain.
    const ogImage = pickProductOgImage(p);

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
        images: [{ url: ogImage, alt: p.name }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [ogImage],
      },
    };
  } catch {
    return { title: 'Product · THROTTLEIN' };
  }
}

/** Server-side fetch that runs once per request (Next.js dedupes the
 *  same URL+options across `generateMetadata` and the page render
 *  thanks to React's cache). Used to feed the JSON-LD blob below. */
async function fetchProductForJsonLd(slug: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_URL}/products/${encodeURIComponent(slug)}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = dataOf(await res.json());
    return data?.product || null;
  } catch {
    return null;
  }
}

export default async function Page(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const product = await fetchProductForJsonLd(slug);

  // Build the Product + BreadcrumbList JSON-LD blobs when the product
  // exists. Both are rendered server-side so Google indexes them on
  // first crawl (rich snippet eligibility: rating stars, price, stock).
  // Product schema is generated via the central helper in lib/jsonLd
  // so the shape stays consistent across the product page + ItemList.
  let productJsonLd: Record<string, unknown> | null = null;
  let breadcrumbJsonLd: Record<string, unknown> | null = null;
  if (product) {
    const categoryName =
      typeof product.category === 'object' && product.category?.name
        ? product.category.name
        : '';
    const categorySlug =
      typeof product.category === 'object' && product.category?.slug
        ? product.category.slug
        : '';

    productJsonLd = productSchema({ ...product, slug: product.slug || slug });

    // Breadcrumb: Home › Category › Product. Category segment is
    // skipped when the product isn't categorised, which keeps the
    // structured data clean (Google ignores partial chains).
    const items: Array<{ '@type': string; position: number; name: string; item: string }> = [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
    ];
    if (categoryName && categorySlug) {
      items.push({
        '@type': 'ListItem',
        position: items.length + 1,
        name: categoryName,
        item: `${SITE_URL}/${categorySlug}`,
      });
    }
    items.push({
      '@type': 'ListItem',
      position: items.length + 1,
      name: product.name,
      item: `${SITE_URL}/product/${product.slug || slug}`,
    });

    breadcrumbJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items,
    };
  }

  return (
    <>
      {productJsonLd && <JsonLd data={productJsonLd} />}
      {breadcrumbJsonLd && <JsonLd data={breadcrumbJsonLd} />}
      {/* SSR the product so crawlers / View Source see the H1, price,
          breadcrumb, images, and description in the initial HTML
          instead of just the loading skeleton. */}
      <ProductDetailPage
        {...(props as any)}
        initialCatalog={product}
        initialOffers={
          product
            ? [{
                _id: product._id,
                sellerId: product.seller?._id,
                storeName: product.seller?.storeName || product.seller?.name,
                price: product.price,
                mrp: product.mrp,
                stock: product.stock,
                sku: product.sku,
              }]
            : []
        }
      />
    </>
  );
}
