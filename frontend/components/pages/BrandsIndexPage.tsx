'use client';

/**
 * Brands index — `/brands`.
 *
 * Pulls the full list of active brands from /api/brands and renders them
 * in a responsive grid. Each tile links to the brand's own landing page
 * at /brands/<slug>. Includes a search box so a customer can quickly jump
 * to a specific brand without scrolling through the whole list.
 *
 * Layout: title strip (eyebrow + headline + count + search) → grid of
 * brand cards (logo tile + name). Mirrors the visual language of the
 * homepage Top Brands rail so the two pages feel like the same family.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Input, Spinner } from '@heroui/react';
import { api, envelopeOrLegacy, imageUrl } from '@/lib/api';
import Breadcrumbs from '@/components/common/Breadcrumbs';

type Brand = {
  _id: string;
  name: string;
  slug: string;
  logo?: string;
  description?: string;
  isActive: boolean;
  order?: number;
};

export default function BrandsIndexPage({
  initialBrands = [],
}: {
  // SSR-fetched brand list from the parent server page. Crawlers /
  // View Source see real brand tiles in the initial HTML.
  initialBrands?: Brand[];
} = {}) {
  const [brands, setBrands] = useState<Brand[]>(initialBrands);
  const [loading, setLoading] = useState<boolean>(initialBrands.length === 0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    api
      // withProducts=1 — only brands that actually have at least one
      // active product; empty brands would land on a "no products yet"
      // page and read as broken.
      .get('/brands', { params: { active: 1, withProducts: 1 } })
      .then(envelopeOrLegacy)
      .then(({ data }) => setBrands((data.items as Brand[]) || []))
      .catch(() => setBrands([]))
      .finally(() => setLoading(false));
  }, []);

  /* Letter-index filter — `all` shows everything, otherwise narrows the
     grid to brands whose name starts with the picked letter. Composes
     with the search box: filter first, then search. */
  const [letter, setLetter] = useState<'all' | string>('all');

  /** Returns the first character of the brand's name, normalised:
   *  uppercase A-Z, or '#' for names that start with a digit / symbol /
   *  non-Latin character. Used both for the alphabet bar and the
   *  per-letter filter. */
  function firstChar(name: string): string {
    const c = (name.trim()[0] || '').toUpperCase();
    return /^[A-Z]$/.test(c) ? c : '#';
  }

  /* Map letter → count, computed off the full brand list so the
     alphabet bar can disable letters that have no brands and show the
     count under each pill. */
  const letterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of brands) {
      const c = firstChar(b.name);
      counts[c] = (counts[c] || 0) + 1;
    }
    return counts;
  }, [brands]);

  /* Letters to render in the alphabet bar — always A-Z, plus '#' if any
     brand name starts with a non-letter. Keeps the row a stable width
     even when some letters are empty (they just render disabled). */
  const ALPHABET = useMemo(() => {
    const base = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    return letterCounts['#'] ? ['#', ...base] : base;
  }, [letterCounts]);

  const filtered = useMemo(() => {
    let list = brands;
    if (letter !== 'all') {
      list = list.filter((b) => firstChar(b.name) === letter);
    }
    // Always sort alphabetically by name (case-insensitive). The backend
    // sorts by `order` — we override that here so the grid reads as a
    // proper A-Z directory.
    list = [...list].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((b) => b.name.toLowerCase().includes(q));
  }, [brands, query, letter]);

  return (
    <div className="bg-white">
      {/* Breadcrumb — shared strip, identical to the products page. */}
      <Breadcrumbs items={[{ label: 'Brands' }]} />

      {/* Title strip */}
      <section className="container pt-8 pb-10 border-b border-[#eee]">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#575757]">
              Brands
            </div>
            <h1 className="text-3xl sm:text-4xl font-medium text-[#141414] tracking-tight mt-1">
              All brands
            </h1>
            <p className="text-sm sm:text-base text-[#575757] mt-2 max-w-2xl">
              Authentic motorcycle gear and parts from {brands.length} verified
              brands. Tap any logo to shop that brand&apos;s catalogue.
            </p>
          </div>

          {/* Quick search — narrows the grid as the user types. Stays on
              the same page so users can clear the box to see everything
              again with no nav. */}
          <Input labelPlacement="outside" variant="bordered"
            aria-label="Search brands"
            placeholder="Search brands"
            value={query}
            onValueChange={setQuery}
            isClearable
            onClear={() => setQuery('')}
            startContent={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 text-[#575757] shrink-0"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            }
            classNames={{
              base: 'w-full md:w-[320px] shrink-0',
              inputWrapper:
                'h-11 bg-white border border-[#e0e0e0] data-[hover=true]:border-[#141414] group-data-[focus=true]:border-[#141414] shadow-none',
              input: 'text-sm placeholder:text-[#9ca3af]',
            }}
          />
        </div>
      </section>

      {/* ─────────── Alphabet index ───────────
          A-Z row of clickable pills. The currently-selected letter gets
          a black pill; letters with no brands render disabled and
          slightly faded so the row stays a fixed width regardless of
          which letters happen to have content. "All" sits at the left
          as the reset state. Brands whose names start with a digit or
          symbol get bucketed under '#' (only rendered if anything is
          there). */}
      <section className="container pt-6 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLetter('all')}
            aria-pressed={letter === 'all'}
            className={`min-w-[40px] h-9 px-3 rounded-md text-xs font-semibold uppercase tracking-wider transition cursor-pointer ${
              letter === 'all'
                ? 'bg-[#141414] text-white'
                : 'bg-[#f3f4f2] text-[#141414] hover:bg-[#eaffb0]'
            }`}
          >
            All
          </button>
          {ALPHABET.map((ch) => {
            const count = letterCounts[ch] || 0;
            const disabled = count === 0;
            const active = letter === ch;
            return (
              <button
                key={ch}
                type="button"
                disabled={disabled}
                onClick={() => setLetter(ch)}
                aria-pressed={active}
                title={disabled ? `No brands starting with ${ch}` : `${count} brand${count === 1 ? '' : 's'}`}
                className={`w-9 h-9 rounded-md text-xs font-semibold uppercase transition ${
                  active
                    ? 'bg-[#141414] text-white cursor-pointer'
                    : disabled
                    ? 'bg-transparent text-[#bdbdbd] cursor-not-allowed'
                    : 'bg-[#f3f4f2] text-[#141414] hover:bg-[#eaffb0] cursor-pointer'
                }`}
              >
                {ch}
              </button>
            );
          })}
        </div>
      </section>

      {/* Brand grid */}
      <section className="container py-6 md:py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size="lg" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 rounded-2xl border-2 border-dashed border-default-200 bg-white">
            <h3 className="text-lg font-medium text-[#141414]">
              {brands.length === 0 ? 'No brands yet' : 'No brands match'}
            </h3>
            <p className="text-sm text-[#575757] mt-1 max-w-md mx-auto px-4">
              {brands.length === 0
                ? 'Brands will appear here once they\'ve been added by an admin.'
                : letter !== 'all' && query
                ? `No brands starting with "${letter}" match "${query}".`
                : letter !== 'all'
                ? `No brands start with "${letter}".`
                : `No brands match "${query}". Try a different search.`}
            </p>
            {brands.length > 0 && (query || letter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setLetter('all');
                }}
                className="inline-flex items-center gap-1.5 mt-5 text-sm font-semibold text-[#141414] hover:underline cursor-pointer"
              >
                Clear filters →
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
            {filtered.map((b) => (
              <Link
                key={b._id}
                href={`/brands/${b.slug}`}
                className="group flex flex-col items-center gap-3"
              >
                <div className="w-full aspect-square rounded-2xl border border-[#eee] bg-white p-4 flex items-center justify-center transition hover:border-default-300 hover:-translate-y-0.5 hover:shadow-md">
                  {b.logo ? (
                    /* `mix-blend-multiply` lets brand PNGs with white
                       backgrounds read as transparent on the white tile.
                       Safe because the tile bg is always white here. */
                    <div className="relative w-full h-full mix-blend-multiply">
                      <Image
                        src={imageUrl(b.logo)}
                        alt={b.name}
                        fill
                        sizes="(max-width: 768px) 40vw, 200px"
                        className="object-contain"
                      />
                    </div>
                  ) : (
                    <span className="text-2xl font-bold uppercase tracking-wider text-[#141414]">
                      {b.name.slice(0, 2)}
                    </span>
                  )}
                </div>
                <div className="text-sm font-medium text-[#141414] text-center w-full truncate">
                  {b.name}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
