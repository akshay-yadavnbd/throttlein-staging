'use client';

/**
 * Shop by Bike — `/shop-by-bike`.
 *
 * Figma: https://www.figma.com/design/5opHjBIvfDYPxAnfnO82TD/Throttlein?node-id=3492-4932
 *
 * Layout: "Pick your ride" header (title + subtitle + search), then a
 * two-column body — a sticky left sidebar listing every bike brand
 * under "Shop by Bike" (with a model-count badge), and a right column
 * that lists EVERY brand's models in one long scroll, grouped under a
 * heading per brand. Clicking a sidebar brand smooth-scrolls to its
 * section; the sidebar highlights whichever brand section is currently
 * in view (scrollspy).
 *
 * All data is fetched live from `/categories` — nothing here is
 * hardcoded. "Shop by Bike" node → its active children are brands →
 * each brand's active children are the individual bike models shown
 * as tiles (real bike photos via each model's `icon`, falling back to
 * a decorative silhouette when a model has no image yet).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';
import { nameToSlug, slugToName } from '@/lib/categorySlug';
import { div } from 'framer-motion/client';

type CategoryNode = {
    _id: string;
    name: string;
    slug?: string;
    icon?: string;
    parent?: string | null;
    isActive: boolean;
    children: CategoryNode[];
};

/** Walk the nested tree looking for a node matching `target` (by slug,
 *  falling back to a slugified name for records that predate the slug
 *  field). */
function findNode(nodes: CategoryNode[], target: string): CategoryNode | null {
    for (const n of nodes) {
        if ((n.slug || nameToSlug(n.name)) === target) return n;
        const hit = findNode(n.children || [], target);
        if (hit) return hit;
    }
    return null;
}

/** Decorative fallback shown for a model that has no photo yet. */
function ModelSilhouette() {
    return (
        <svg
            viewBox="0 0 120 60"
            className="w-3/4 text-default-300/60"
            fill="currentColor"
            aria-hidden
        >
            <circle cx="22" cy="48" r="3.5" />
            <circle cx="96" cy="48" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="96" cy="48" r="3.5" />
            <path d="M22 48 L42 32 L78 32 L96 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M44 32 L52 22 L72 22 L80 32 Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M82 32 L96 18 L108 18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
    );
}

export default function ShoByBikePage({
    slug = 'shop-by-bike',
}: {
    /** Category slug to browse. Defaults to the top-level "Shop by Bike"
     *  node. */
    slug?: string;
}) {
    const [tree, setTree] = useState<CategoryNode[]>([]);
    const [treeLoaded, setTreeLoaded] = useState(false);
    const [query, setQuery] = useState('');
    const [activeSlug, setActiveSlug] = useState('');
    const [mobileBrandOpen, setMobileBrandOpen] = useState(false);
    const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
    const hoveredSlugRef = useRef<string | null>(null);


    useEffect(() => {
        let cancelled = false;
        setTreeLoaded(false);
        api
            .get('/categories').then(envelopeOrLegacy)
            .then(({ data }) => {
                if (cancelled) return;
                setTree(data.tree || []);
            })
            .catch(() => {
                if (!cancelled) setTree([]);
            })
            .finally(() => {
                if (!cancelled) setTreeLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, [slug]);

    const currentNode = useMemo(() => findNode(tree, slug), [tree, slug]);
    const categoryName = currentNode?.name || slugToName(slug);
    const loading = !treeLoaded;

    const brands = useMemo(
        () => (currentNode?.children || []).filter((c) => c.isActive),
        [currentNode]
    );

    // Full, unfiltered brand list — used ONLY by the sidebar so it always
    // lists every brand (with its true model count) regardless of the
    // search query. The content grid below uses `brandRows` instead,
    // which narrows to search matches.
    const allBrandRows = useMemo(() => {
        return brands
            .map((b) => {
                const bSlug = b.slug || nameToSlug(b.name);
                const allModels = (b.children || []).filter((c) => c.isActive);
                return { ...b, slug: bSlug, count: allModels.length };
            })
            .filter((b) => b.count > 0);
    }, [brands]);

    // Search-filtered rows — drives the content grid only. Brands with
    // zero matching models are dropped so the grid doesn't render an
    // empty heading with nothing under it.
    const brandRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return brands
            .map((b) => {
                const bSlug = b.slug || nameToSlug(b.name);
                const allModels = (b.children || []).filter((c) => c.isActive);
                const models = q
                    ? allModels.filter((m) => m.name.toLowerCase().includes(q))
                    : allModels;
                return { ...b, slug: bSlug, models, count: allModels.length };
            })
            .filter((b) => b.models.length > 0);
    }, [brands, query]);

    // Scrollspy — highlight whichever brand section is nearest the top
    // of the content pane as the customer scrolls through the long list.
    // `contentScrollRef` is the pane's own scroll container (see below) —
    // passing it as `root` scopes the observer to THAT pane's viewport
    // instead of the whole window, which matters now that the brand list
    // scrolls independently of the page.
    const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
    const contentScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (loading || brandRows.length === 0) return;
        const els = brandRows
            .map((b) => sectionRefs.current[b.slug])
            .filter(Boolean) as HTMLElement[];
        if (!els.length) return;

        const observer = new IntersectionObserver(
            (entries) => {
                // Hovering a sidebar button jumps the pane instantly; skip
                // updates while that's in flight so a hover alone can
                // never mark a brand "active" (see setHovered below).
                if (hoveredSlugRef.current) return;
                const visible = entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible[0]) setActiveSlug(visible[0].target.id);
            },
            { root: contentScrollRef.current, rootMargin: '0px 0px -70% 0px', threshold: 0 }
        );
        els.forEach((el) => observer.observe(el));
        return () => observer.disconnect();
    }, [loading, brandRows]);

    function scrollToBrand(brandSlug: string) {
        sectionRefs.current[brandSlug]?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }

    // While the pointer is over a sidebar button, jump straight to that
    // brand's section and dim/disable every OTHER section so only the
    // hovered brand's content reads as interactive. `hoveredSlugRef` is
    // the guard the scrollspy observer checks above — kept as a ref (not
    // just the state) so the observer's closure always sees the latest
    // value instead of a stale one.
    function setHovered(slug: string | null) {
        hoveredSlugRef.current = slug;
        setHoveredSlug(slug);
    }

    // On mouse-leave, snap back to whatever was last actually selected
    // (by click) — hovering is just a preview. The guard stays engaged
    // through the snap-back scroll (cleared two frames later, once the
    // browser has settled the resulting layout/intersection) so the
    // observer can't briefly misfire and flash the just-hovered brand as
    // active before correcting itself.
    //
    // IMPORTANT: this must be wired to the <nav> wrapper's onMouseLeave,
    // NOT to each individual button. Moving the pointer between adjacent
    // buttons (e.g. scanning down toward the last tab) fires that
    // button's mouseleave before the next button's mouseenter — if each
    // button scheduled its own delayed clear, those stale timers pile up
    // and one fires *after* a newer hover has already started, wiping
    // the guard mid-flight and letting the observer briefly latch onto
    // the wrong section. A token guards against any leftover race.
    const hoverTokenRef = useRef(0);
    function beginHover(slugToHover: string) {
        hoverTokenRef.current += 1;
        setHovered(slugToHover);
        scrollToBrand(slugToHover);
    }
    function endHover() {
        const token = ++hoverTokenRef.current;
        if (activeSlug) scrollToBrand(activeSlug);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (hoverTokenRef.current === token) setHovered(null);
            });
        });
    }

    return (
        <>
            {/* Breadcrumb strip */}
            <div className="border-b border-[#eee] sticky top-17.75 md:top-[77px] z-2 bg-white">
                <div className="container py-4">
                    <nav className="text-sm text-[#7E746E] font-medium flex items-center gap-1.5 flex-wrap">
                        <Link href="/" className="hover:text-[#1a1410]">Home</Link>
                        <span className="text-[#9e9e9e]">/</span>
                        <span className="text-brand-black font-medium">{categoryName}</span>
                    </nav>

                </div>
                <div className='md:hidden border-t border-[#eee]'>
                    <div className="container relative">
                        <button
                            type="button"
                            onClick={() => setMobileBrandOpen((v) => !v)}
                            aria-expanded={mobileBrandOpen}
                            className="w-full flex items-center justify-between py-2.5 text-sm text-[#212121]"
                        >
                            <span>Brand Models</span>
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`w-5 h-5 text-[#212121] transition-transform duration-300 ${mobileBrandOpen ? 'rotate-180' : ''}`}
                                aria-hidden
                            >
                                <polyline points="7 9 12 4 17 9" />
                                <polyline points="7 15 12 20 17 15" />
                            </svg>
                        </button>

                        {/* Accordion body — floats OVER the page content below
                            (position: absolute, high z-index) instead of pushing
                            it down. The grid-rows 0fr→1fr trick still drives the
                            open/close animation; being absolutely positioned just
                            means that height change no longer affects layout flow
                            for anything else on the page. */}
                        <div
                            className={`absolute left-0 right-0 top-full p-0 z-30 grid bg-white shadow-lg transition-all ease-out ${mobileBrandOpen ? 'grid-rows-[1fr] px-4' : 'grid-rows-[0fr]'
                                }`}
                        >
                            <div className="overflow-hidden">
                                <div className="max-h-72 overflow-y-auto">
                                    {brandRows.map((b) => {
                                        const active = activeSlug === b.slug;
                                        return (
                                            <button
                                                key={b._id}
                                                type="button"
                                                onClick={() => {
                                                    setActiveSlug(b.slug);
                                                    scrollToBrand(b.slug);
                                                    setMobileBrandOpen(false);
                                                }}
                                                className={`w-full flex items-center justify-between rounded-lg gap-2 px-4 py-2.5 text-sm text-left transition ${active
                                                    ? 'bg-[#000] text-white font-semibold'
                                                    : 'text-default-600 hover:bg-[#F5F5F5]'
                                                    }`}
                                            >
                                                <span className="truncate">{b.name}</span>
                                                <span className="text-xs tabular-nums">{b.count}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="container">
                {/* Header — title + subtitle, search on the right */}
                {loading ? (
                    <div className="md:grid md:grid-cols-[160px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] py-4 w-full">
                        <div className="hidden md:flex flex-col gap-2 p-5 lg:p-10 !pl-0">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="h-8 rounded-lg bg-default-200/50 animate-pulse" />
                            ))}
                        </div>
                        <div className="flex flex-col gap-10 md:p-5 lg:p-10">
                            <div className="flex items-start justify-between gap-4 flex-wrap pb-10 border-b border-[#EEE]">
                                {/* Real heading + subtitle (not placeholders) so the <h1>
                                    is in the server-rendered HTML / view-source. */}
                                <div>
                                    <h1 className="text-xl md:text-2xl font-bold text-[#000]">Pick your ride</h1>
                                    <p className="text-base text-[#424242] !mt-2">
                                        Filter parts, gear, and accessories by your bike model.
                                    </p>
                                </div>
                                <div className="relative w-full sm:w-64 h-10 0 rounded bg-default-200/50 animate-pulse" />
                            </div>
                            {Array.from({ length: 4 }).map((_, s) => (
                                <div key={s} className='w-full'>
                                    <div className="h-5 w-32 rounded bg-default-200/50 animate-pulse mb-4" />
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                        {Array.from({ length: 5 }).map((_, i) => (
                                            <div key={i} className="aspect-square rounded-2xl bg-default-200/50 animate-pulse" />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="md:grid md:grid-cols-[160px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
                        {/* Sidebar — sticky brand jump-nav with scrollspy highlight */}
                        <aside className="hidden md:block border-r border-[#EEE]">
                            <nav
                                className="sticky top-[131px] flex flex-col max-h-[calc(100vh-3rem)] overflow-y-auto p-5 lg:p-10 !pl-0"
                                onMouseLeave={endHover}
                            >
                                {allBrandRows.map((b) => {
                                    const active = activeSlug === b.slug;
                                    return (
                                        <button
                                            key={b._id}
                                            type="button"
                                            onClick={() => {
                                                setActiveSlug(b.slug);
                                                scrollToBrand(b.slug);
                                            }}
                                            onMouseEnter={() => beginHover(b.slug)}
                                            className={`group flex items-center justify-between gap-2 pl-3 pr-1 py-2 rounded-lg h-8 text-xs lg:text-sm text-left transition-all duration-300 ${active
                                                ? 'bg-[#000] text-white'
                                                : 'text-[#212121] hover:bg-[#F5F5F5]'
                                                }`}
                                        >
                                            <span className="truncate">{b.name}</span>
                                            <span
                                                className={`text-xs px-[5px] tabular-nums transition-opacity duration-300 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                                    }`}
                                            >
                                                {b.count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </nav>
                        </aside>

                        {/* Content — every brand's models, grouped under a heading */}
                        <div className='md:p-5 lg:p-10 z-1'>
                            <div className="flex items-start justify-between gap-4  lg:flex-row py-4 md:pb-10 md:border-b border-[#EEE]">
                                <div>
                                    <h1 className="text-xl md:text-2xl font-bold text-[#000]">Pick your ride</h1>
                                    <p className="text-base text-[#424242] !mt-2">
                                        Filter parts, gear, and accessories by your bike model.
                                    </p>
                                </div>
                                <div className="hidden md:block relative w-full sm:w-64">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-default-400 pointer-events-none"
                                        aria-hidden
                                    >
                                        <circle cx="11" cy="11" r="8" />
                                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                    </svg>
                                    <input
                                        type="text"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        placeholder="Search Model"
                                        className="w-full pl-9 p-3 h-12 rounded-lg border bg-[#EEEEEE] border-transparent hover:border-[#] focus:border-[#1a1410] outline-none text-sm tabular-nums"
                                    />
                                </div>
                            </div>
                            {brandRows.length === 0 ? (
                                // Search matched nothing — the header + search box above
                                // stay visible (unlike before, where this replaced the
                                // whole layout and stranded the customer with no way to
                                // edit or clear their search) and only this content area
                                // swaps to the empty state.
                                <div className='py-20'>
                                    <div className="text-center py-12 rounded-2xl border-2 border-dashed border-default-200">
                                        <p className="text-default-600">
                                            {query.trim() ? `No bike models match "${query.trim()}".` : 'Nothing here yet — check back soon.'}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-10 min-w-0 pt-5 md:pt-10">
                                    {brandRows.map((b) => (
                                        <div
                                            key={b._id}
                                            id={b.slug}
                                            ref={(el) => {
                                                sectionRefs.current[b.slug] = el;
                                            }}
                                            className={`scroll-mt-44 md:scroll-mt-38 transition-opacity duration-300 ${hoveredSlug && hoveredSlug !== b.slug ? 'opacity-30 pointer-events-none' : 'opacity-100'
                                                }`}
                                        >

                                            <h2 className="text-lg font-bold text-[#1a1410] mb-6 md:mb-4">{b.name}</h2>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                                {b.models.map((m) => {
                                                    const mSlug = m.slug || nameToSlug(m.name);
                                                    return (
                                                        <Link
                                                            key={m._id}
                                                            href={`/${mSlug}`}
                                                            className="group flex flex-col items-center text-center"
                                                        >
                                                            <div className="w-full aspect-square rounded-xl p-4 bg-[#F3F4F2] border border-transparent duration-300 overflow-hidden flex items-center justify-center group-hover:p-2 group-hover:bg-[#E2E3DD] transition-all">
                                                                {m.icon ? (
                                                                    <div className="relative w-full h-full">
                                                                        <Image
                                                                            src={imageUrl(m.icon)}
                                                                            alt={m.name}
                                                                            fill
                                                                            sizes="(min-width: 1024px) 180px, 33vw"
                                                                            className="object-contain mix-blend-multiply"
                                                                        />
                                                                    </div>
                                                                ) : (
                                                                    <ModelSilhouette />
                                                                )}
                                                            </div>
                                                            <p className="!mt-2 text-base text-[#000] truncate w-full">
                                                                {m.name}
                                                            </p>
                                                        </Link>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                    {/* Scroll-room spacer — without this, jumping to the LAST
                                        (often short) brand section runs the sticky sidebar out
                                        of room to stay pinned: it un-sticks and shifts on
                                        screen mid-hover, sliding a different button out from
                                        under a stationary cursor and firing a spurious native
                                        hover event there. That cascades into the sidebar
                                        flashing between brands when hovering the last tab.
                                        Reserving a full viewport height below the last section
                                        guarantees the sidebar always has room to stay stuck. */}
                                    <div className="h-screen" aria-hidden />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div >
        </>
    );
}
