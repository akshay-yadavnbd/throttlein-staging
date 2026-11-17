'use client';

/**
 * Admin-managed dynamic page — rendered from the catch-all routes
 * `/<parent-cat-slug>/<page-slug>` and `/locations/<slug>`.
 *
 * The Page document is resolved server-side in the parent route file so
 * the SEO meta is correct on first paint; that fetched record is passed
 * in here as `initialPage`. This component handles the *content* — runs
 * the page's template (products-list / brands-list / categories-list /
 * prose), pulls the matching data from the public API,
 * and renders.
 *
 * Template behaviours:
 *   products-list   – top body + filtered product grid (cat/brand/city/state/country)
 *   brands-list     – top body + brands tile grid
 *   categories-list – top body + categories tile grid (top-level by default)
 *   prose           – top body only (same look as /p/<slug>)
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Spinner } from '@heroui/react';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';
import RichTextView from '@/components/common/RichTextView';
import CategoryPage from '@/components/pages/CategoryPage';
import type { ResolvedPage } from '@/lib/pageResolver';

type Brand = { _id: string; name: string; slug: string; logo?: string };
type Category = { _id: string; name: string; slug: string; icon?: string };

/**
 * Top content for the dynamic page — rendered above the template's
 * own content (product grid, brand grid, etc.). Uses the shared
 * RichTextView so output styling matches the admin's WYSIWYG preview.
 */
function IntroBody({ html }: { html: string }) {
  if (!html?.trim()) return null;
  return (
    <section className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-10 py-6 md:py-10">
      <RichTextView html={html} className="text-[#3a3a3a]" />
    </section>
  );
}

/* ──── Header strip — shared across all templates so the title is
 * always the same shape, regardless of what's beneath it. ────
 * Top Content: the admin's contentTitle replaces the heading and
 * contentDescription renders as the intro line under it. */
function PageHeader({ page }: { page: ResolvedPage }) {
  return (
    <header className="bg-white border-b border-[#eee]">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-10 pt-8 pb-6">
        <nav className="text-xs text-[#575757] mb-3">
          <Link href="/" className="hover:text-[#141414]">Home</Link>
          {page.parentCategory && (
            <>
              <span className="mx-1.5">/</span>
              <Link
                href={`/${page.parentCategory.slug}`}
                className="hover:text-[#141414]"
              >
                {page.parentCategory.name}
              </Link>
            </>
          )}
          <span className="mx-1.5">/</span>
          <span className="text-[#141414] font-medium">{page.title}</span>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-medium text-[#141414] tracking-tight">
          {page.contentTitle?.trim() || page.title}
        </h1>
        {page.contentDescription?.trim() && (
          <p className="text-sm text-[#575757] mt-2 max-w-2xl leading-relaxed">
            {page.contentDescription}
          </p>
        )}
      </div>
    </header>
  );
}

/* ──── Bottom Content — admin-authored SEO block rendered after the
 * template's grid (title + rich-text HTML). Shared by the brands-list
 * and categories-list templates; products-list hands the same fields
 * to CategoryPage which renders them itself. ──── */
function BottomContent({ page }: { page: ResolvedPage }) {
  if (!page.bottomTitle?.trim() && !page.bottomDescription?.trim()) return null;
  return (
    <section className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-10 pb-16">
      <div className="pt-8 border-t border-[#eaeaea]">
        {page.bottomTitle?.trim() && (
          <h2 className="text-xl font-semibold text-[#1a1410] mb-3">
            {page.bottomTitle}
          </h2>
        )}
        {page.bottomDescription?.trim() && (
          <RichTextView
            html={page.bottomDescription}
            className="text-[15px] leading-relaxed text-[#424242]"
          />
        )}
      </div>
    </section>
  );
}

/* ─────────────────── products-list template ───────────────────
 *
 * Delegates to CategoryPage so the dynamic page picks up the same
 * filter sidebar (Availability / Category subs / Price / Brand / Size)
 * + sort dropdown + grid that `/<slug>` uses. We pass
 * overrides for the title, breadcrumb, intro body, and an optional
 * pre-selected brand filter so the page reads as "LS2 Helmet in Noida"
 * rather than the bare category name.
 *
 * Location values on the page are intentionally NOT used as product
 * filters — they exist purely for SEO/naming (see the earlier decision
 * to treat the catalogue as pan-India).
 *
 * `slugForFetch` is the parent category slug — it drives which
 * subtree of products CategoryPage aggregates from. Without a parent
 * category set on the Page, the template falls back to a no-op slug
 * which renders an empty grid (admins should pick a category or use
 * the prose template instead).
 * ─────────────────── */
function ProductsListTemplate({ page }: { page: ResolvedPage }) {
  // The page's URL prefix is the parent category; that's also what the
  // products grid should filter by. Filter-side `category` is kept in
  // sync by the page editor, so either source works. The admin can
  // additionally aggregate MORE categories via filter.categories —
  // when present, we switch CategoryPage into collection mode (same
  // machinery as /riding-gears) so the grid pulls every listed
  // category's subtree and the sidebar shows them all.
  const primarySlug =
    page.parentCategory?.slug ||
    page.filter?.category?.slug ||
    '';
  const catSlugs = Array.from(new Set([
    primarySlug,
    ...(page.filter?.categories || []).map((c) => c.slug),
  ].filter(Boolean)));
  const isCollection = catSlugs.length > 1;

  // Brand pre-select — the dynamic-page filter stores brands as
  // populated `{name, slug}` docs; CategoryPage's selectedBrands set is
  // keyed by display name, so we hand it names. Supports the single
  // legacy `filter.brand` plus the multi `filter.brands` array.
  const brandNames = Array.from(new Set([
    page.filter?.brand?.name,
    ...(page.filter?.brands || []).map((b) => b.name),
  ].filter(Boolean))) as string[];
  const brandFilter = brandNames.length ? brandNames : undefined;

  // Custom breadcrumb — "Home › <Parent category> › <page title>".
  // Falls back to just Home › title if there's no parent category.
  // Rendered inside CategoryPage's bordered breadcrumb strip, so the
  // classes here mirror the strip's default nav exactly (products page
  // typography: Poppins Medium 14px, #7e746e / #1a1410).
  const breadcrumb = (
    <nav className="flex items-center gap-1 font-poppins text-[14px] font-medium leading-none flex-wrap">
      <Link href="/" className="text-[#7e746e] hover:text-[#1a1410] transition">Home</Link>
      {page.parentCategory && (
        <>
          <span className="text-[#7e746e] mx-1" aria-hidden>/</span>
          <Link
            href={`/${page.parentCategory.slug}`}
            className="text-[#7e746e] hover:text-[#1a1410] transition"
          >
            {page.parentCategory.name}
          </Link>
        </>
      )}
      <span className="text-[#7e746e] mx-1" aria-hidden>/</span>
      <span className="text-[#1a1410]">{page.title}</span>
    </nav>
  );

  // Intro — render the admin's rich text via the shared RichTextView.
  // Wrapped in a max-width container so it lines up with the title
  // strip and product grid (the CategoryPage canvas is `max-w-7xl`).
  const intro = page.body?.trim() ? (
    <RichTextView html={page.body} className="text-[#3a3a3a]" />
  ) : null;

  return (
    <CategoryPage
      // No `params` here — CategoryPage skips `use()` when an
      // explicit slugOverride is provided, which keeps it from
      // suspending on a fresh-each-render promise reference.
      // Multi-category pages ALSO pass collectionSlugs, which switches
      // the data fetch into collection mode (aggregating every listed
      // category's subtree); slugOverride stays the primary category so
      // in-page links still have a sane base.
      slugOverride={primarySlug}
      collectionSlugs={isCollection ? catSlugs : undefined}
      // Top Content — contentTitle replaces the heading, contentDescription
      // is the intro line under it. Fall back to the page title.
      titleOverride={page.contentTitle?.trim() || page.title}
      descriptionOverride={page.contentDescription?.trim() || undefined}
      breadcrumbNode={breadcrumb}
      introNode={intro}
      initialBrandFilter={brandFilter}
      // Bottom Content — rendered by CategoryPage after the grid.
      bottomTitle={page.bottomTitle?.trim() || undefined}
      bottomDescriptionHtml={page.bottomDescription?.trim() || undefined}
    />
  );
}

/* ─────────────────── brands-list template ─────────────────── */
function BrandsListTemplate({ page }: { page: ResolvedPage }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/brands?limit=200').then(envelopeOrLegacy)
      .then(({ data }) => {
        if (!cancelled) setBrands(data.items || data.brands || []);
      })
      .catch(() => { if (!cancelled) setBrands([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <IntroBody html={page.body || ''} />
      <section className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-10 pb-16">
        {loading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
            {brands.map((b) => (
              <Link key={b._id} href={`/brands/${b.slug}`} className="group flex flex-col items-center gap-3">
                <div className="w-full aspect-square rounded-2xl border border-[#eee] bg-white p-4 flex items-center justify-center transition hover:border-default-300 hover:-translate-y-0.5 hover:shadow-md">
                  {b.logo ? (
                    <div className="relative w-full h-full mix-blend-multiply">
                      <Image src={imageUrl(b.logo)} alt={b.name} fill sizes="200px" className="object-contain" />
                    </div>
                  ) : (
                    <span className="text-2xl font-bold uppercase tracking-wider text-[#141414]">
                      {b.name.slice(0, 2)}
                    </span>
                  )}
                </div>
                <div className="text-sm font-medium text-[#141414] text-center truncate w-full">{b.name}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/* ─────────────────── categories-list template ─────────────────── */
function CategoriesListTemplate({ page }: { page: ResolvedPage }) {
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/categories').then(envelopeOrLegacy)
      .then(({ data }) => {
        // Public endpoint returns a tree. Flatten top level only — that's
        // the most useful default. (Sub-cat children render under each.)
        const list: Category[] = (data.tree || data.items || []).map((n: any) => ({
          _id: n._id, name: n.name, slug: n.slug, icon: n.icon,
        }));
        if (!cancelled) setCats(list);
      })
      .catch(() => { if (!cancelled) setCats([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <IntroBody html={page.body || ''} />
      <section className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-10 pb-16">
        {loading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
            {cats.map((c) => (
              <Link
                key={c._id}
                href={`/${c.slug}`}
                className="group rounded-2xl border border-[#eee] bg-white p-5 transition hover:border-default-300 hover:-translate-y-0.5 hover:shadow-md text-center"
              >
                {c.icon && (
                  <div className="w-12 h-12 mx-auto mb-3 relative">
                    <Image src={imageUrl(c.icon)} alt={c.name} fill sizes="48px" className="object-contain" />
                  </div>
                )}
                <div className="text-sm font-medium text-[#141414]">{c.name}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/* ─────────────────── prose template ─────────────────── */
function ProseTemplate({ page }: { page: ResolvedPage }) {
  return (
    <section className="max-w-[820px] mx-auto px-4 sm:px-6 lg:px-10 py-10 md:py-14">
      <RichTextView html={page.body || ''} className="text-[#3a3a3a]" />
    </section>
  );
}

/* ─────────────────── Switchboard ─────────────────── */
export default function DynamicPage({ page }: { page: ResolvedPage }) {
  const tpl = page.template || (page.type === 'prose' ? null : 'products-list');

  // products-list delegates to CategoryPage which renders its own title
  // strip + breadcrumb, so we skip the top-level PageHeader for it.
  // Every other template still gets the shared header.
  if (tpl === 'products-list') {
    return (
      <div className="bg-white">
        <ProductsListTemplate page={page} />
      </div>
    );
  }

  return (
    <div className="bg-white">
      <PageHeader page={page} />
      {tpl === 'brands-list'     && <BrandsListTemplate     page={page} />}
      {tpl === 'categories-list' && <CategoriesListTemplate page={page} />}
      {tpl === null              && <ProseTemplate          page={page} />}
      {/* Bottom Content — SEO block after the grid (brands/categories
          templates; products-list renders its own via CategoryPage). */}
      {(tpl === 'brands-list' || tpl === 'categories-list') && (
        <BottomContent page={page} />
      )}
    </div>
  );
}
