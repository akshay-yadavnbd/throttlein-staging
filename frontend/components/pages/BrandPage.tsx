'use client';

/**
 * Brand landing page — `/brands/<slug>`.
 *
 * URL slug comes from the Brand document's `slug` field (kept in sync with
 * the Mongo Brand model's `pre-save` slugify hook). We:
 *   1. Resolve the slug → brand record via GET /brands (cached client-side)
 *   2. Fetch products filtered by that brand's display name from /products
 *   3. Render a hero strip (logo + name + description + count) and a
 *      product grid below, with a sort dropdown above the grid
 *
 * If the slug doesn't match any active brand we render a polite "not found"
 * state with a link back home — no 404 needed for a marketing-style page.
 */

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@heroui/react';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';
import ProductCard, { type Product } from '@/components/common/ProductCard';
import Breadcrumbs from '@/components/common/Breadcrumbs';
import RichTextView from '@/components/common/RichTextView';
import { BrandPageSkeleton } from '@/components/common/PageSkeletons';

type Brand = {
  _id: string;
  name: string;
  slug: string;
  logo?: string;
  website?: string;
  description?: string;
  isActive: boolean;
  // Admin-authored on-page SEO copy — Top Content overrides the hero
  // heading/intro; Bottom Content renders after the product grid
  // (bottomDescription is sanitised rich-text HTML).
  contentTitle?: string;
  contentDescription?: string;
  bottomTitle?: string;
  bottomDescription?: string;
};

const SORTS = [
  { value: 'newest',     label: 'Newest' },
  { value: 'price_asc',  label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'rating',     label: 'Top rated' },
];

export default function BrandPage({
  params,
  initialBrand = null,
  initialProducts = [],
}: {
  params: Promise<{ slug: string }>;
  // SSR-fetched brand + product grid from server page.tsx. Crawlers
  // / View Source see the brand H1, description, and product cards
  // in the initial HTML.
  initialBrand?: Brand | null;
  initialProducts?: Product[];
}) {
  const { slug } = use(params);

  const [brand, setBrand] = useState<Brand | null>(initialBrand);
  const [brandLoading, setBrandLoading] = useState<boolean>(!initialBrand);
  const [brandNotFound, setBrandNotFound] = useState(false);

  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [productsLoading, setProductsLoading] = useState<boolean>(initialProducts.length === 0);
  const [total, setTotal] = useState<number>(initialProducts.length);
  const [sort, setSort] = useState<string>('newest');

  /* Resolve slug → brand. We hit /brands?active=1 once and match by slug
     client-side rather than adding a `/brands/by-slug/:slug` endpoint —
     the brand list is small enough that a single request is fine. */
  useEffect(() => {
    let cancelled = false;
    setBrandLoading(true);
    setBrandNotFound(false);
    api
      .get('/brands', { params: { active: 1 } }).then(envelopeOrLegacy)
      .then(({ data }) => {
        if (cancelled) return;
        const items: Brand[] = data.items || [];
        const match = items.find((b) => (b.slug || '').toLowerCase() === slug.toLowerCase());
        if (match) {
          setBrand(match);
        } else {
          setBrand(null);
          setBrandNotFound(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setBrand(null);
        setBrandNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setBrandLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  /* Fetch products for the resolved brand. The backend's /products
     endpoint filters by brand *name* (not slug), so we pass `brand.name`
     once it's resolved. Refires whenever the sort changes.

     Gate on `brandLoading` so the products spinner doesn't briefly flip
     off (between "brand still loading" and "brand resolved → fetch
     products") which used to cause a double-flash on first paint. */
  useEffect(() => {
    if (brandLoading) return;
    if (!brand) {
      setProducts([]);
      setTotal(0);
      setProductsLoading(false);
      return;
    }
    setProductsLoading(true);
    api
      .get('/products', {
        params: {
          // Send the slug (preferred — exact, case-insensitive match on
          // the backend). The endpoint also accepts the display name or
          // ObjectId as a fallback.
          brand: brand.slug || brand.name,
          sort: sort || 'newest',
          limit: 48,
        },
      }).then(envelopeOrLegacy)
      .then(({ data }) => {
        setProducts(data.items || []);
        setTotal(data.total ?? data.items?.length ?? 0);
      })
      .catch(() => {
        setProducts([]);
        setTotal(0);
      })
      .finally(() => setProductsLoading(false));
  }, [brand, brandLoading, sort]);

  /* ─────────── Loading state ─────────── */
  if (brandLoading) {
    return <BrandPageSkeleton />;
  }

  /* ─────────── Brand-not-found state ─────────── */
  if (brandNotFound || !brand) {
    return (
      <div className="container py-20 text-center">
        <h1 className="text-3xl font-medium text-[#141414]">Brand not found</h1>
        <p className="text-[#575757] mt-2">
          We couldn&apos;t find a brand with the slug{' '}
          <code className="bg-[#f3f4f2] rounded px-1.5 py-0.5">{slug}</code>.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 mt-6 bg-[#141414] text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-[#141414]/90"
        >
          Back to home <span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  const logoSrc = brand.logo ? imageUrl(brand.logo) : '';

  /* ─────────── Brand landing ─────────── */
  return (
    <div className="bg-white">
      {/* Breadcrumb — shared strip, identical to the products page. */}
      <Breadcrumbs items={[{ label: 'Brands', href: '/brands' }, { label: brand.name }]} />

      {/* Brand hero — compact logo tile on the left, vertically centred
          against the name + description column so the text doesn't hang
          off the tile's bottom edge. On mobile it stacks. */}
      <section className="container pt-6 pb-8">
        <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-6 border-b border-[#eee] pb-8">
          <div className="w-[96px] h-[96px] sm:w-[112px] sm:h-[112px] rounded-2xl border border-[#eee] bg-[#fafbf8] p-4 flex items-center justify-center shrink-0">
            {logoSrc ? (
              <div className="relative w-full h-full mix-blend-multiply">
                <Image
                  src={logoSrc}
                  alt={`${brand.name} logo`}
                  fill
                  sizes="112px"
                  className="object-contain"
                />
              </div>
            ) : (
              <span className="text-xl font-bold uppercase tracking-wider text-[#141414]">
                {brand.name.slice(0, 2)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#575757]">
              Brand
            </div>
            {/* Top Content — admin's contentTitle / contentDescription
                (Brands panel) override the brand name / description. */}
            <h1 className="text-2xl sm:text-3xl font-medium text-[#141414] tracking-tight mt-1">
              {brand.contentTitle?.trim() || brand.name}
            </h1>
            {(brand.contentDescription?.trim() || brand.description) && (
              <p className="text-sm text-[#575757] mt-2 max-w-2xl leading-relaxed">
                {brand.contentDescription?.trim() || brand.description}
              </p>
            )}
            <div className="mt-3 flex items-center justify-center sm:justify-start gap-4 text-xs text-[#3a3a3a]">
              <span>
                <span className="font-semibold text-[#141414] tabular-nums">{total}</span>{' '}
                {total === 1 ? 'product' : 'products'}
              </span>
              {brand.website && (
                <>
                  <span className="text-[#e0e0e0]">|</span>
                  <a
                    href={brand.website}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-[#141414] hover:underline"
                  >
                    Visit website ↗
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Products section */}
      <section className="container pb-16">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#575757]">
              Shop {brand.name}
            </div>
            <h2 className="text-2xl font-medium text-[#141414] tracking-tight mt-0.5">
              All products
            </h2>
          </div>
          {/* Sort by — same plain text-plus-chevron dropdown the
              /products page uses (CategoryPage), so both listing
              surfaces feel identical. */}
          <Dropdown placement="bottom-end">
            <DropdownTrigger>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-[15px] text-[#1a1410] outline-none focus:outline-none shrink-0"
              >
                Sort by
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[#1a1410]" aria-hidden>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label="Sort by"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={new Set([sort])}
              onAction={(key) => setSort(String(key))}
            >
              {SORTS.map((s) => (
                <DropdownItem key={s.value}>{s.label}</DropdownItem>
              ))}
            </DropdownMenu>
          </Dropdown>
        </div>

        {productsLoading ? (
          <SkeletonGrid />
        ) : products.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border-2 border-dashed border-default-200 bg-white">
            <h3 className="text-lg font-medium text-[#141414]">No products yet</h3>
            <p className="text-sm text-[#575757] mt-1 max-w-md mx-auto px-4">
              {brand.name} hasn&apos;t listed any products yet. Check back soon or browse the homepage for related brands.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 mt-5 text-sm font-semibold text-[#141414] hover:underline"
            >
              Continue shopping →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {products.map((p, i) => (
              // Defensive key derivation. `_id` is the intended source
              // but the /brands endpoint occasionally returns lean docs
              // where an entry lacks `_id` (or two entries share one
              // from a bad join), triggering the "unique key" warning.
              // Fall back to slug, then to array index so React never
              // sees `undefined` and duplicates always resolve.
              <ProductCard
                key={p?._id || (p as any)?.slug || `brand-product-${i}`}
                product={p}
              />
            ))}
          </div>
        )}

        {/* Bottom Content — admin-authored SEO block rendered after the
            product grid (title + rich-text HTML from the Brands panel). */}
        {(brand.bottomTitle?.trim() || brand.bottomDescription?.trim()) && (
          <section className="mt-14 pt-8 border-t border-[#eaeaea]">
            {brand.bottomTitle?.trim() && (
              <h2 className="text-xl font-semibold text-[#1a1410] mb-3">
                {brand.bottomTitle}
              </h2>
            )}
            {brand.bottomDescription?.trim() && (
              <RichTextView
                html={brand.bottomDescription}
                className="text-[15px] leading-relaxed text-[#424242]"
              />
            )}
          </section>
        )}
      </section>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="aspect-[3/4] rounded-2xl bg-default-200/50 animate-pulse" />
      ))}
    </div>
  );
}
