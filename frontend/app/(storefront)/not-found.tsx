/**
 * Global 404 page — rendered by Next.js whenever no route matches OR a
 * server component explicitly calls `notFound()`. Lives at the app root
 * so it sits inside the regular RootLayout (Navbar + Footer wrap it
 * automatically); only the middle content section is rendered here.
 *
 * Visual design comes from the Throttlein Figma 404 frame: stacked "4"
 * + helmet glyph + "4" on top, headline + subtitle below, then two
 * CTAs (primary "Back to homepage", secondary "Customer support").
 *
 * SEO-wise, the route correctly returns a real HTTP 404 (App Router
 * sets the status automatically when `not-found.tsx` matches — no soft
 * 404). The page also adds a recovery surface so users who land here
 * from a stale link or typo can still find what they wanted:
 *   - A search input that submits to /products?q=<term>
 *   - A row of popular-category chips
 *
 * The helmet image is stored locally under /public/images/404-helmet.png
 * so we don't depend on Figma's 7-day asset URLs at runtime.
 */

import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '404 — Page not found · THROTTLEIN',
  // Tell crawlers not to index the 404 — keeps it out of search results
  // even if someone manages to link to a missing route.
  robots: { index: false, follow: false },
};

// Hand-picked recovery destinations. Slugs should match the live
// category list — update if a category gets renamed. Keeping this
// small (4-6 chips) keeps the layout tight on mobile.
const POPULAR_CATEGORIES: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Helmets', href: '/helmets' },
  { label: 'Jackets', href: '/riding-jackets' },
  { label: 'Gloves', href: '/riding-gloves' },
  { label: 'Lights', href: '/lighting' },
  { label: 'Luggage', href: '/luggage-touring' },
  { label: 'Browse all', href: '/products' },
];

export default function NotFound() {
  return (
    <section className="bg-white">
      <div className="max-w-[1232px] mx-auto px-6 sm:px-10 py-20 md:py-[120px] flex flex-col items-center gap-10">
        {/* ─── "404" — two big black "4"s flanking the helmet ─── */}
        <div className="flex items-end justify-center w-full max-w-[460px]">
          {/* Left 4 */}
          <span
            aria-hidden="true"
            className="font-poppins font-medium text-[#0a0a0a] leading-none tracking-tight select-none
                       text-[160px] sm:text-[200px] md:text-[220px]"
          >
            4
          </span>

          {/* Helmet "0" — the visual centerpiece. object-contain keeps
              the proportions intact across breakpoints. */}
          <div className="relative shrink-0 mx-1 sm:mx-2
                          w-[120px] h-[130px]
                          sm:w-[160px] sm:h-[170px]
                          md:w-[200px] md:h-[210px]">
            <Image
              src="/images/404-helmet.webp"
              alt=""
              fill
              priority
              sizes="(max-width: 640px) 120px, (max-width: 768px) 160px, 200px"
              className="object-contain"
            />
          </div>

          {/* Right 4 */}
          <span
            aria-hidden="true"
            className="font-poppins font-medium text-[#0a0a0a] leading-none tracking-tight select-none
                       text-[160px] sm:text-[200px] md:text-[220px]"
          >
            4
          </span>
        </div>

        {/* ─── Headline + subtitle ─── */}
        <div className="flex flex-col gap-3 text-center max-w-[850px]">
          <h1 className="font-poppins font-medium text-[24px] sm:text-[28px] md:text-[32px] text-[#0a0a0a] leading-[1.2] tracking-[-1px]">
            Looks Like You&apos;ve Taken a Wrong Turn.
          </h1>
          <p className="font-poppins text-[15px] sm:text-base text-[#424242] leading-[1.52]">
            This page has taken a different route. Let&apos;s get you back on track.
          </p>
        </div>

        {/* ─── Search bar ─── A plain HTML form so it works with
             progressive enhancement (no client component needed). It
             submits to /products with ?q=<term> — the same query param
             the global search uses, so users land on a result page
             instead of another dead end. */}
        <form
          role="search"
          action="/products"
          method="get"
          className="w-full max-w-[576px]"
        >
          <label htmlFor="not-found-search" className="sr-only">
            Search products
          </label>
          <div className="flex items-center gap-2 h-[49px] rounded-lg border border-[#e0e0e0]
                          focus-within:border-[#0a0a0a] transition bg-white overflow-hidden">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4 ml-4 text-[#575757] shrink-0"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              id="not-found-search"
              type="search"
              name="q"
              placeholder="Search helmets, jackets, lights…"
              className="flex-1 h-full bg-transparent outline-none font-poppins text-sm text-[#0a0a0a] placeholder:text-[#9c9c9c]"
              autoComplete="off"
            />
            <button
              type="submit"
              className="h-full px-5 bg-[#0a0a0a] text-white font-poppins text-sm
                         transition hover:bg-[#1f1f1f] active:bg-[#000]"
            >
              Search
            </button>
          </div>
        </form>

        {/* ─── Popular categories ─── Recovery chips so users who can't
             remember the exact thing they wanted still have a path
             forward. Each chip is a real internal link so search
             engines crawling the 404 can still discover the catalogue. */}
        <div className="w-full max-w-[640px] flex flex-col items-center gap-3">
          <div className="text-xs uppercase tracking-[0.18em] text-[#575757] font-semibold">
            Popular categories
          </div>
          <ul className="flex flex-wrap justify-center gap-2">
            {POPULAR_CATEGORIES.map(({ label, href }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="inline-flex items-center h-9 px-4 rounded-full border border-[#e0e0e0]
                             text-[#0a0a0a] font-poppins text-sm bg-white
                             transition hover:border-[#0a0a0a] hover:bg-[#fafafa]"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* ─── CTAs ─── Primary = filled black, Secondary = bordered white.
             Matches Figma's `CTA` component (node 2085:267). */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full max-w-[576px]">
          <Link
            href="/"
            className="flex-1 h-[49px] inline-flex items-center justify-center gap-2 rounded-lg
                       bg-[#0a0a0a] text-white font-poppins text-sm
                       shadow-[inset_0_-1px_0_1px_#0a0a0a,inset_0_0.5px_0.5px_1px_rgba(255,255,255,0.32)]
                       transition hover:bg-[#1f1f1f] active:bg-[#000]"
          >
            Back to homepage
          </Link>
          <Link
            href="/account"
            className="flex-1 h-[49px] inline-flex items-center justify-center gap-2 rounded-lg
                       bg-white border border-[#e0e0e0] text-[#0a0a0a] font-poppins text-sm
                       transition hover:border-[#0a0a0a]"
          >
            Customer support
          </Link>
        </div>
      </div>
    </section>
  );
}
