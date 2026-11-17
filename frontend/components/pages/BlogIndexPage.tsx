'use client';

/**
 * Blog index page — matches the Figma "Blogs" frame (node 2454:1053).
 *
 * Layout:
 *   - Header (existing Navbar)
 *   - Breadcrumb strip (Home / Blogs OR Home / Blogs / <category>)
 *   - Big "Blogs" title
 *   - FEATURED HERO — split card with image on the left (562×453 at
 *     1512w) and title + excerpt + "Read more" CTA on the right
 *   - "More from us" section
 *       - Category tab bar (All + each active category)
 *       - 3×N grid of post cards (image, category chip in lime, title)
 *       - Pagination (← 1 2 3 … N →)
 *   - Footer (existing Footer)
 *
 * The page also serves /blog/category/<slug> — when categorySlug is
 * passed via the route, the featured hero is suppressed and the title
 * becomes the category name. The tab strip stays so the user can pivot
 * between categories without bouncing back to /blog first.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';
import { buildPostUrlForSite, blogPathForSite } from '@/lib/blogUrl';
import type { SiteKey } from '@/lib/site';
import Breadcrumbs from '@/components/common/Breadcrumbs';

type Author = { _id: string; name: string; avatar?: string };
type Category = {
  _id: string;
  name: string;
  slug: string;
  parent?: { _id: string } | string | null;
};
type Tag = { _id: string; name: string; slug: string };

type Post = {
  _id: string;
  title: string;
  slug: string;
  excerpt: string;
  featuredImage?: string;
  category?: Category | null;
  tags?: Tag[];
  author?: Author;
  publishedAt: string;
  readingMinutes: number;
  // root → leaf category breadcrumb returned by the backend, used by
  // buildPostUrl() to construct /blog/cat/sub/.../slug links.
  categoryChain?: { _id: string; name: string; slug: string }[];
};

function fmtDate(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Must match PAGE_SIZE in components/blog/blogRouteShared.tsx (SSR
 *  renders page 1, this component refetches on navigation) and stay a
 *  multiple of 6 so the 1/2/3-column grid fills whole rows. */
const PAGE_SIZE = 12;

export default function BlogIndexPage({
  categorySlug,
  initialFeatured = null,
  initialPosts = [],
  initialTotal = 0,
  initialCategories = [],
  initialActiveCategory = null,
  initialPage = 1,
  site = 'main',
}: {
  categorySlug?: string;
  /**
   * Which property is rendering. The LAYOUT is identical either way —
   * this only affects link construction and the breadcrumb, which have to
   * resolve against the right host. Defaults to 'main' so the storefront's
   * existing call sites are unchanged.
   */
  site?: SiteKey;
  // SSR-fetched data from the parent server page.tsx so crawlers /
  // View Source see real cards instead of a skeleton. Optional —
  // when omitted the component falls back to its original behaviour
  // and fetches everything on mount.
  initialFeatured?: Post | null;
  initialPosts?: Post[];
  initialTotal?: number;
  initialCategories?: Category[];
  initialActiveCategory?: Category | null;
  // Page number resolved server-side from the URL's `?page=` param, so
  // a deep-linked/shared paginated URL starts on the right page instead
  // of always page 1.
  initialPage?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [featured, setFeatured] = useState<Post | null>(initialFeatured);
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [total, setTotal] = useState<number>(initialTotal);
  const [page, setPage] = useState(initialPage);

  // Keeps the URL's `?page=` param in sync with pagination clicks, so
  // the current page is reflected in the address bar and is shareable /
  // survives a refresh. `page=1` omits the param entirely (canonical
  // clean URL). Doesn't touch other existing query params.
  function goToPage(p: number) {
    setPage(p);
    const sp = new URLSearchParams(searchParams.toString());
    if (p <= 1) {
      sp.delete('page');
    } else {
      sp.set('page', String(p));
    }
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  // Loading is false when we already have SSR posts — the post-card
  // skeleton would otherwise flash on top of the real grid.
  const [loading, setLoading] = useState<boolean>(initialPosts.length === 0);

  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [activeCategory, setActiveCategory] = useState<Category | null>(initialActiveCategory);

  // `selectedSlug` is the LOCAL filter state. It's seeded from the
  // route prop (so /blog/category/<slug> still works as a deep link
  // / shareable URL) but subsequent chip clicks update only this
  // state — no navigation, no URL change. Reset `page` when the
  // filter changes so we never show an out-of-range pagination cursor.
  const [selectedSlug, setSelectedSlug] = useState<string | undefined>(categorySlug);
  function pickCategory(slug?: string) {
    setSelectedSlug(slug);
    setPage(1);
    // Drop a stale `?page=N` left over from before the filter changed —
    // silent replace (no new history entry) so it doesn't contradict the
    // page-1 content that's about to render.
    if (searchParams.get('page')) {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete('page');
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }

  // Auto-centers whichever tab is active inside the horizontally-scrolling
  // strip — runs whenever the selection changes (chip click) AND once
  // categories first load (so a deep-linked category is centered on
  // arrival too), since the pill for a category can start off-screen.
  const tabStripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = tabStripRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    const target =
      active.offsetLeft - container.clientWidth / 2 + active.offsetWidth / 2;
    container.scrollTo({
      left: Math.max(0, target),
      behavior: 'smooth',
    });
  }, [selectedSlug, categories]);

  // Load categories once + featured (only when not in category mode)
  useEffect(() => {
    api.get('/blog/categories').then(envelopeOrLegacy).then(({ data }) => setCategories(data.items || [])).catch(() => { });
  }, []);

  // `activeCategory` is driven by the URL prop ONLY — it controls
  // the page-level chrome (heading, breadcrumb crumb, section title).
  // Chip clicks update `selectedSlug` separately to filter the grid
  // without changing the page identity. So /blog always reads as the
  // index, even after a chip is picked; /blog/category/<slug> reads
  // as the category page.
  useEffect(() => {
    if (categorySlug) {
      const cached = categories.find((c) => c.slug === categorySlug);
      if (cached) {
        setActiveCategory(cached);
      } else {
        api.get('/blog/categories').then(envelopeOrLegacy).then(({ data }) => {
          const match = (data.items || []).find((c: Category) => c.slug === categorySlug);
          setActiveCategory(match || null);
        }).catch(() => { });
      }
    } else {
      setActiveCategory(null);
      // Featured hero only on the all-blogs view, not category pages.
      api.get('/blog/featured').then(envelopeOrLegacy).then(({ data }) => setFeatured(data.post || null)).catch(() => { });
    }
  }, [categorySlug, categories]);

  // Fetch posts whenever the page or filter changes. Skip the
  // loading flag on the very first render when SSR posts already
  // matched the filter — `hasSsrData` flips false after the first
  // user-initiated refetch, since the SSR data only matches initial
  // state (page=1, filter from URL).
  const ssrFirstPaintRef = useRef<boolean>(initialPosts.length > 0);
  useEffect(() => {
    if (ssrFirstPaintRef.current) {
      ssrFirstPaintRef.current = false;
      // SSR already populated posts/total for the initial page+filter.
      // Skip the immediate re-fetch on first paint.
      return;
    }
    setLoading(true);
    const params: any = { page, limit: PAGE_SIZE };
    if (selectedSlug) params.category = selectedSlug;
    /* Exclude the featured post SERVER-SIDE so every page returns a full
     * PAGE_SIZE grid and `total` stays accurate. Filtering it out after
     * the fetch (what this did before) shortened whichever page it
     * landed on — page 1 showed 9 cards against 10 everywhere else, so
     * the 3-column grid only looked right on page 1. */
    if (featured?._id) params.exclude = featured._id;
    api.get('/blog', { params }).then(envelopeOrLegacy)
      .then(({ data }) => {
        // Server already excluded it; this stays as a cheap guard for a
        // stale/older API that ignores `exclude`.
        const dropId = featured?._id;
        const items = (data.items || []).filter((p: Post) => p._id !== dropId);
        setPosts(items);
        setTotal(data.total || 0);
      })
      .catch(() => {
        setPosts([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [page, selectedSlug, featured?._id]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /**
   * Property-specific name for the blog section.
   *
   * The seller hub's blog is seller-education content sitting alongside
   * the storefront's rider-facing one, and a bare "Blogs" crumb didn't
   * say which you were in — the two properties share this component and
   * looked identical. Per product decision the seller property calls it
   * "Seller Blog"; the storefront keeps "Blogs".
   */
  const blogLabel = site === 'seller' ? 'Seller Blog' : 'Blogs';

  const heading = activeCategory ? activeCategory.name : blogLabel;
  const subheading = activeCategory
    ? `Posts in ${activeCategory.name}`
    : null;

  return (
    <div className="bg-white">
      {/* Breadcrumb — shared strip, identical to the products page.
          The blog crumb has to point at THIS property's blog index, not
          always the storefront's. */}
      <Breadcrumbs
        items={
          activeCategory
            ? [
                { label: blogLabel, href: blogPathForSite('/blog', site) },
                { label: activeCategory.name },
              ]
            : [{ label: blogLabel }]
        }
      />

      {/* HERO / TITLE */}
      <section className="bg-white">
        <div className="container pt-10" style={{ maxWidth: '1272px' }}>
          {/* <h1 className="text-4xl md:text-5xl lg:text-[64px] font-semibold tracking-[-1.5px] text-brand-black leading-[1.05]">
            {heading}
          </h1>
          {subheading && (
            <p className="mt-3 text-sm md:text-base text-[#575757]">{subheading}</p>
          )} */}

          {/* Top featured card — always renders the latest published
              post on /blog (`isFeatured` is an admin override; the
              endpoint falls back to most-recent-by-publishedAt).
              Per spec, chip clicks DO NOT filter this card — they
              only filter the grid below. The dedicated category
              route (/blog/category/<slug>) still hides this card via
              the `!activeCategory` check so direct category visits
              don't double-show a featured post that isn't in scope. */}
          {!activeCategory && featured && (
            <FeaturedCard post={featured} site={site} />
          )}
        </div>
      </section>

      {/* GRID SECTION — per the Figma "Blog page" frame the category
          pills sit DIRECTLY under the featured banner (40px gap), with
          no "More from us" heading. Category routes keep a small
          heading for context since they hide the featured card. */}
      <section className="bg-white">
        <div className="container pt-10 pb-16 md:pb-20" style={{ maxWidth: '1272px' }}>
          {activeCategory && (
            <h2 className="text-2xl md:text-3xl font-semibold text-brand-black">
              More in this category
            </h2>
          )}

          {/* Category tab strip — horizontal scroll on mobile. "All" is
              active by default (`!selectedSlug`); whichever pill is
              active also auto-centers itself in the scroll strip (see
              the effect keyed on `selectedSlug` below). Highlighting is
              driven by `selectedSlug` (the live grid filter) rather than
              `activeCategory` (route-only) so it actually updates when a
              chip is clicked in-place. */}
          {categories.length > 0 && (
            <div ref={tabStripRef} className={`${activeCategory ? 'mt-7' : ''} -mx-2 px-2 overflow-x-auto scrollbar-hide`}>
              <div className="inline-flex items-center gap-2 min-w-full">
                <TabPill
                  active={!selectedSlug}
                  onClick={() => pickCategory(undefined)}
                  label="All"
                />
                {/* Tab strip shows only top-level (parent-less) categories
                    so the bar stays compact. Sub-category surfacing is
                    done through the post URLs themselves. Clicks are
                    now in-place (no navigation) — the API refetch on
                    `selectedSlug` change updates the grid below. */}
                {categories
                  .filter((c) => {
                    const p = (c as any).parent;
                    return !p || (typeof p === 'object' && !p._id);
                  })
                  .map((c) => (
                    <TabPill
                      key={c._id}
                      active={selectedSlug === c.slug}
                      onClick={() => pickCategory(c.slug)}
                      label={c.name}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* Grid */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
              : posts.length === 0
                ? <NoPostsCard />
                : posts.map((p) => <PostCard key={p._id} post={p} site={site} />)}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-10 flex items-center justify-center gap-2">
              <PageButton
                onClick={() => goToPage(Math.max(1, page - 1))}
                disabled={page === 1}
                label={
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12H19M11 6L5 12L11 18" stroke="#212121" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
              {paginationRange(page, totalPages).map((p, i) =>
                p === '…' ? (
                  <span key={`g-${i}`} className="w-10 h-10 grid place-items-center text-default-500">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => goToPage(p as number)}
                    aria-current={p === page ? 'page' : undefined}
                    className={`w-10 h-10 rounded-lg text-base tabular-nums transition ${p === page
                      ? 'bg-brand-black text-white'
                      : 'text-[#575757] bg-[#EEE]'
                      }`}
                  >
                    {p}
                  </button>
                )
              )}
              <PageButton
                onClick={() => goToPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                label={
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12H19M13 6L19 12L13 18" stroke="#212121" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
            </div>
          )
          }
        </div >
      </section >
    </div >
  );
}

/* ─────────────────────── helpers ─────────────────────── */

/* Featured hero — updated Figma layout: COMPACT split card. Image on
   the left fills its column full-height (cover crop), content on the
   right is tighter (smaller title, 3-line excerpt, pill-shaped CTA). */
function FeaturedCard({ post, site }: { post: Post; site: SiteKey }) {
  return (
    /* Geometry from Figma node 4382:10440 (Banner → Container → Card):
       1232 card, 612×288 image, 40px gutter before the text column.
       The image is therefore ~half the card and a fixed 2.125:1 — it
       is NOT sized by the text. Previously the media column inherited
       the card's text-driven height, so the same cover was framed
       488×234 on /blog (1-line title) and 488×263 on /seller/blog
       (2-line title): identical content, different crop, which is what
       made the two properties look inconsistent. */
    <article className="grid grid-cols-1 lg:grid-cols-2 gap-0 rounded-2xl overflow-hidden border border-[#E0E0E0] bg-white shadow-[0_4px_8px_-2px_rgba(0,0,0,0.12)]">
      <div className="p-2 lg:pr-0">
        <div className="relative aspect-[612/288] rounded-xl overflow-hidden bg-default-100">
          {post.featuredImage ? (
            <Image
              src={imageUrl(post.featuredImage)}
              alt={post.title}
              fill
              /* Real slot is ~612 CSS px, so the old `480px` hint made
                 Next serve a 480w file for a 612-wide box — upscaled and
                 soft on the way in, before `cover` scaled it again. The
                 sources are 1824×825, so there is ample resolution to
                 draw on once the hint is honest. */
              sizes="(max-width: 1024px) 100vw, 640px"
              className="object-cover"
              priority
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-default-400 text-sm">
              No image
            </div>
          )}
        </div>
      </div>
      {/* 40px gutter + 24px vertical padding per Figma (pl-[40px],
          py-[24px] on the container). min-w-0 keeps long words from
          widening the column. */}
      <div className="p-5 lg:pl-10 lg:pr-6 lg:py-6 flex flex-col justify-center min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          {post.category && (
            <span className="inline-flex items-center bg-[#EAF4FF] text-[#2563EB] px-3 py-0.5 h-6 rounded-full text-[11px] font-semibold tracking-wider">
              {post.category.name}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[#424242] leading-[1.52]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3.5 h-3.5">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Published {fmtDate(post.publishedAt)}
          </span>
        </div>
        {/* Clamped to 2 lines — a 3-line title would otherwise overflow
            the card's fixed height and crowd out the excerpt/CTA. */}
        <h1 className="mt-3 text-lg lg:text-xl font-semibold tracking-[-0.3px] text-brand-black leading-[1.45] line-clamp-2">
          {post.title}
        </h1>
        {post.excerpt && (
          <p className="mt-3 text-sm text-[#424242] line-clamp-3 leading-[1.65]">
            {post.excerpt}
          </p>
        )}
        <Link
          href={buildPostUrlForSite(post, site)}
          className="mt-5 inline-flex items-center justify-center h-9 self-start px-4 border border-[#BDBDBD] rounded-full bg-white text-black text-sm hover:bg-[#F5F5F5] active:bg-[#EEE] transition"
        >
          Read Full Blog
        </Link>
      </div>
    </article>
  );
}

/* Post card — Figma "Blog Card Default" (node 3321:3893).
   8px inner padding, 384×173 cover image (≈2.22:1, rounded-12), then a
   COMPACT content stack with 8px gaps — chip, 2-line title, date. */
function PostCard({ post, site }: { post: Post; site: SiteKey }) {
  return (
    <Link
      href={buildPostUrlForSite(post, site)}
      className="group block rounded-2xl overflow-hidden border p-2 border-[#eee] hover:bg-white hover:shadow-[0_4px_8px_-2px_rgba(0,0,0,0.12)] hover:border-[#E0E0E0] transition"
    >
      <div className="relative aspect-[384/173] bg-default-100 overflow-hidden rounded-xl">
        {post.featuredImage ? (
          <Image
            src={imageUrl(post.featuredImage)}
            alt={post.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 420px"
            className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-default-400 text-sm">
            No image
          </div>
        )}
      </div>
      <div className="px-2 pt-3 pb-2 flex flex-col gap-2">
        {post.category && (
          <span className="self-start inline-flex items-center bg-[#EAF4FF] h-6 text-[#2563EB] px-3 rounded-full text-[11px] leading-none font-semibold tracking-wider">
            {post.category.name}
          </span>
        )}
        <h3 className="text-[15px] md:text-base font-semibold text-[#000] line-clamp-2 leading-[1.45]">
          {post.title}
        </h3>
        <span className="text-xs text-[#424242] leading-[1.52]">
          {fmtDate(post.publishedAt)}
        </span>
      </div>
    </Link>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden border border-[#eee] bg-white p-2">
      <div className="aspect-[368/157] rounded-xl bg-default-200/60 animate-pulse" />
      <div className="px-2 pt-3 pb-2 space-y-2">
        <div className="h-4 w-16 bg-default-200/60 rounded animate-pulse" />
        <div className="h-5 bg-default-200/60 rounded animate-pulse" />
        <div className="h-4 w-1/3 bg-default-200/60 rounded animate-pulse" />
      </div>
    </div>
  );
}

function NoPostsCard() {
  return (
    <div className="col-span-full py-16 text-center">
      <div className="text-base font-semibold text-brand-black">No posts yet</div>
      <p className="text-sm text-default-500 mt-1">Check back soon — we're writing.</p>
    </div>
  );
}

function TabPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-active={active}
      className={`shrink-0 px-4 py-2 h-10 min-w-[50px] rounded-md text-sm font-medium transition ${active
        ? 'bg-brand-black text-white border-brand-black'
        : 'bg-white text-[#3a3a3a] hover:bg-[#EEE] hover:text-brand-black'
        }`}
    >
      {label}
    </button>
  );
}

function PageButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  label: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-10 h-10 rounded-lg text-base border border-[#BDBDBD] grid place-items-center transition ${disabled
        ? 'text-default-300 cursor-not-allowed'
        : 'text-[#3a3a3a]'
        }`}
    >
      {label}
    </button>
  );
}

/** Standard pagination ellipsis logic — shows up to 5 visible buttons
 *  with "…" gaps. Always shows page 1 and the last page; the middle
 *  collapses around the current page. */
function paginationRange(current: number, total: number): (number | '…')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, '…', total];
  }
  if (current >= total - 3) {
    return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, '…', current - 1, current, current + 1, '…', total];
}
