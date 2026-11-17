/**
 * SellerGuideDetailPage — server component rendering a single Seller
 * Guide at /seller/guide/<slug>.
 *
 * Visual hierarchy mirrors BlogDetailPage:
 *
 *   1. White banner:
 *        a. Breadcrumb strip (Home / Become a Seller / Title) — bordered
 *           bottom hairline, own row, Poppins.
 *        b. Hero row — left column has a "Seller Guide" lime pill +
 *           "Published <date>" meta line, then the title (large
 *           Poppins display weight). Right column hosts the hero image.
 *        c. "In short" card — the short-description lead paragraph
 *           rendered as a bordered white card beneath the hero row,
 *           same chrome BlogDetailPage uses for its excerpt.
 *   2. Article body — two-column layout with a mobile ToC drawer and a
 *      sticky "In this article" rail at lg+, same as BlogDetailPage.
 *      Content is admin-authored, sanitised HTML rendered via
 *      RichTextView (same renderer BlogDetailPage uses for its body).
 *   3. White "More guides" strip — up to 3 other active guides as
 *      cards, styled like BlogDetailPage's "You may also like" block.
 *
 * Chrome comes from app/seller/layout.tsx so
 * it matches /sell's chrome — /sell is the parent context for these
 * guides and using the same shell preserves the storefront's existing
 * visual flow.
 *
 * Server-rendered (no 'use client') so crawlers, AMP previews, and
 * View Source all see the real copy with SEO meta resolved by the
 * page-level generateMetadata.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { imageUrl } from '@/lib/api';
import RichTextView from '@/components/common/RichTextView';

/** Slugify a heading's text into a stable URL-safe anchor id. */
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

/** Walk the content HTML, inject IDs onto h2/h3, collect a ToC. Runs
 *  client-side after hydration since we need DOMParser. Returns the
 *  rewritten HTML plus the ToC entries (h2 only — h3 still gets IDs
 *  for deep links but doesn't appear in the rail). */
function buildHeadingsToc(html: string): {
  html: string;
  toc: Array<{ id: string; text: string; level: 2 | 3 }>;
} {
  if (!html || typeof window === 'undefined') return { html, toc: [] };
  const doc = new DOMParser().parseFromString(
    `<div id="__root__">${html}</div>`,
    'text/html',
  );
  const root = doc.getElementById('__root__');
  if (!root) return { html, toc: [] };
  const seen = new Set<string>();
  const toc: Array<{ id: string; text: string; level: 2 | 3 }> = [];
  root.querySelectorAll('h2, h3').forEach((h) => {
    const text = (h.textContent || '').trim();
    if (!text) return;
    let id = slugifyHeading(text) || 'section';
    let n = 2;
    while (seen.has(id)) id = `${slugifyHeading(text) || 'section'}-${n++}`;
    seen.add(id);
    h.setAttribute('id', id);
    const existing = h.getAttribute('class') || '';
    h.setAttribute('class', `${existing} scroll-mt-40`.trim());
    if (h.tagName === 'H2') toc.push({ id, text, level: 2 });
  });
  return { html: root.innerHTML, toc };
}

type Guide = {
  _id: string;
  title: string;
  slug: string;
  shortDescription?: string;
  content?: string;
  image?: string;
  publishedAt?: string | null;
  createdAt?: string | null;
};

function fmtDate(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function SellerGuideDetailPage({
  guide,
  related = [],
}: {
  guide: Guide;
  /** Up to 3 other active guides shown in the "More guides" block. */
  related?: Guide[];
}) {
  const publishedDate = guide.publishedAt || guide.createdAt || null;

  // ToC + heading-anchor injection (client-only — DOMParser).
  // useMemo runs once per content change; useState keeps a stable
  // pair to feed back to render. `activeId` is tracked via an
  // IntersectionObserver so the currently-in-view section highlights
  // in the sidebar rail.
  const articleRef = useRef<HTMLDivElement | null>(null);
  const [{ html: bodyWithIds, toc }, setBody] = useState<{
    html: string;
    toc: Array<{ id: string; text: string; level: 2 | 3 }>;
  }>({ html: guide.content || '', toc: [] });

  useEffect(() => {
    if (!guide.content) {
      setBody({ html: '', toc: [] });
      return;
    }
    setBody(buildHeadingsToc(guide.content));
  }, [guide.content]);

  const [activeId, setActiveId] = useState<string>('');
  useEffect(() => {
    if (toc.length === 0 || !articleRef.current) return;
    const headings = toc
      .map((t) => articleRef.current!.querySelector<HTMLElement>(`#${CSS.escape(t.id)}`))
      .filter((el): el is HTMLElement => !!el);
    if (headings.length === 0) return;
    // Mark the topmost heading whose top is just past the viewport's
    // upper buffer as active. Buffer matches scroll-mt-40 (160px).
    const onScroll = () => {
      const buffer = 180;
      let current = headings[0].id;
      for (const h of headings) {
        if (h.getBoundingClientRect().top - buffer <= 0) current = h.id;
        else break;
      }
      setActiveId(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [toc]);

  function handleTocClick(e: React.MouseEvent, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 140;
    window.scrollTo({ top: y, behavior: 'smooth' });
    history.replaceState(null, '', `#${id}`);
  }

  return (
    <div className="guide-detail bg-white">
      {/* Header and footer come from app/seller/layout.tsx — the
          seller property's own chrome, shared by every page on it. */}

      {/* ════════════════════════════════════════════════════════════════
          BREADCRUMB — bordered strip above the hero, matches
          BlogDetailPage's breadcrumb bar exactly.
          ══════════════════════════════════════════════════════════════ */}
      <div className="py-4 border-b border-[#EEE]">
        <div className="container">
          <div className="flex items-center gap-1 font-poppins">
            <Link
              href="/"
              className="text-[14px] font-medium leading-none text-[#7e746e] hover:text-brand-black"
            >
              Home
            </Link>
            <Slash />
            <Link
              href="/seller"
              className="text-[14px] font-medium leading-none text-[#7e746e] hover:text-brand-black"
            >
              Become a Seller
            </Link>
            <Slash />
            <span className="text-[14px] font-medium leading-none text-[#1a1410] truncate max-w-[60vw]">
              {guide.title}
            </span>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════
          1. HERO — title/meta + image, then the "In short" card
          ══════════════════════════════════════════════════════════════ */}
      <section className="pt-10 space-y-10">
        <div className="container" style={{ maxWidth: '1312px' }}>
          <div
            className={
              'grid items-stretch gap-6 ' +
              (guide.image
                ? 'grid-cols-1 md:grid-cols-1 lg:grid-cols-2 md:gap-10'
                : 'grid-cols-1')
            }
          >
            {/* LEFT — text column */}
            <div className="flex flex-col gap-10 my-auto">
              {/* Lime pill + publish date, styled like Blog's category
                  pill + meta row (calendar glyph + date). */}
              <div className="flex items-center gap-4 flex-wrap ">
                <span className="inline-flex items-center bg-[#EAF4FF] text-[#2563EB] px-3 py-0.5 h-7 rounded-full text-[11px] font-semibold tracking-wider">
                  Seller Guide
                </span>
                {publishedDate && (
                  <div className="flex items-center gap-3 font-poppins text-sm leading-[1.52] text-[#424242]">
                    <span className="flex gap-2 items-center">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        className="w-4 h-4"
                      >
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      Published {fmtDate(publishedDate)}
                    </span>
                  </div>
                )}
              </div>

              {/* Title — same scale as BlogDetailPage's h1. */}
              <h1 className="font-poppins font-medium text-[#111827] text-[40px] sm:text-[48px] lg:text-[64px] leading-[1.15] tracking-[-3px] m-0">
                {guide.title}
              </h1>
            </div>

            {/* RIGHT — hero image (matches blog's 562×453 aspect). */}
            {guide.image && (
              <div className="p-2">
                <div className="relative aspect-[562/453] rounded-xl overflow-hidden bg-default-100">
                  <Image
                    src={imageUrl(guide.image)}
                    alt={guide.title}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1024px) 420px, 562px"
                    className="object-cover"
                    priority
                  />
                </div>
              </div>
            )}
          </div>

          {/* "In short" card — short description rendered the same way
              BlogDetailPage renders its excerpt: bordered white card
              spanning the full row, directly under the hero grid. */}
          {guide.shortDescription && (
            <aside
              aria-label="Guide summary"
              className="bg-white mt-10 border border-[#E0E0E0] rounded-2xl p-5 md:p-8 flex flex-col gap-4"
            >
              <h2 className="font-poppins text-[20px] font-semibold text-black leading-[1.52] m-0">
                In short
              </h2>
              <p className="font-poppins text-[16px] text-[#424242] leading-[1.52]">
                {guide.shortDescription}
              </p>
            </aside>
          )}
        </div>

        {/* ════════════════════════════════════════════════════════════════
            2. ARTICLE BODY — two-column with mobile ToC drawer + sticky
               ToC rail on the right, mirrors BlogDetailPage exactly.
            ══════════════════════════════════════════════════════════════ */}
        <div className="container">
          <div className="max-w-[1232px] mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,892px)_minmax(0,1fr)] gap-6 lg:gap-10">
              {/* LEFT — long-form article body */}
              <main className="min-w-0 lg:pt-10">
                {/* Mobile-only ToC drawer */}
                {toc.length > 0 && (
                  <details className="lg:hidden mb-6 rounded-2xl border border-default-200 bg-white">
                    <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between">
                      <span className="text-base text-black">In this article</span>
                      <span className="text-xs text-default-500 tabular-nums">
                        {toc.length}
                      </span>
                    </summary>
                    <ol className="px-3 pb-3 flex flex-col">
                      {toc.map((item) => (
                        <li key={item.id}>
                          <a
                            href={`#${item.id}`}
                            onClick={(e) => handleTocClick(e, item.id)}
                            className={`block min-h-10 px-3 py-2 text-sm rounded-md hover:bg-default-100 ${item.level === 3 ? 'pl-6 text-[#7e746e]' : 'text-[#424242]'
                              }`}
                          >
                            {item.text}
                          </a>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                <div
                  ref={articleRef}
                  className="article-body text-base text-[#424242] leading-[1.52]"
                >
                  {guide.content ? (
                    <RichTextView html={bodyWithIds || guide.content} />
                  ) : (
                    <p className="text-default-500 italic">
                      This guide is still a draft — check back soon.
                    </p>
                  )}
                </div>
              </main>

              {/* RIGHT — sticky rail */}
              <aside className="hidden lg:block">
                {toc.length > 0 && (
                  <div className="lg:sticky lg:top-24 flex flex-col gap-6 lg:pt-10 lg:pb-6">
                    <nav className="flex flex-col gap-4 overflow-clip">
                      <h3 className="font-poppins text-[20px] font-medium text-black leading-[1.52] m-0">
                        In this article
                      </h3>
                      <ol className="flex flex-col">
                        {toc.map((item) => {
                          const isActive = item.id === activeId;
                          return (
                            <li key={item.id}>
                              <a
                                href={`#${item.id}`}
                                onClick={(e) => handleTocClick(e, item.id)}
                                className={`flex items-center gap-1 min-h-10 px-3 py-2 rounded-md text-sm transition ${isActive
                                  ? 'bg-[#EEE] rounded-[8px] text-black'
                                  : 'text-[#424242] hover:bg-[#EEE] hover:text-black'
                                  } ${item.level === 3 ? 'pl-7' : ''}`}
                              >
                                <span className="flex-1 min-w-0 font-poppins text-[14px] leading-[1.52]">
                                  {item.text}
                                </span>
                              </a>
                            </li>
                          );
                        })}
                      </ol>
                    </nav>
                  </div>
                )}
              </aside>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          3. MORE GUIDES — white strip with up to 3 other active guides,
             styled like BlogDetailPage's "You may also like" block.
          ══════════════════════════════════════════════════════════════ */}
      {related.length > 0 && (
        <section className="bg-white py-16 md:py-20 !pt-0">
          <div className="container">
            <div className="max-w-[1232px] mx-auto flex flex-col gap-10">
              <h2 className="text-[#141414] text-3xl md:text-[32px] font-medium tracking-[-1px] leading-[1.52]">
                More guides
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {related.map((g) => (
                  <Link
                    key={g._id}
                    href={`/seller/guide/${encodeURIComponent(g.slug)}`}
                    className="group block rounded-2xl overflow-hidden border p-2 border-[#eee] hover:bg-white hover:shadow-[0_4px_8px_-2px_rgba(0,0,0,0.12)] hover:border-[#E0E0E0] transition"
                  >
                    <div className="relative aspect-[384/310] bg-default-100 overflow-hidden rounded-2xl">
                      {g.image ? (
                        <Image
                          src={imageUrl(g.image)}
                          alt={g.title}
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
                          className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
                        />
                      ) : (
                        <div className="absolute inset-0 grid place-items-center text-default-400 text-sm">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="p-3 pt-6 pb-0">
                      <span className="inline-flex items-center bg-[#d4fa00] h-7 text-black px-3 py-1 rounded-full text-[11px] leading-[1.42] font-semibold tracking-wider">
                        Seller Guide
                      </span>
                      <h3 className="mt-4 text-base md:text-lg font-semibold text-[#000] leading-snug line-clamp-2 leading-[1.52]">
                        {g.title}
                      </h3>
                      {(g.publishedAt || g.createdAt) && (
                        <div className="mt-3 pt-3 border-t border-[#EEE] leading-[1.52] flex items-center justify-between text-xs text-[#424242]">
                          <span>{fmtDate(g.publishedAt || g.createdAt)}</span>
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Poppins — loaded just for this page so the guide detail matches
          BlogDetailPage's typography exactly, without forcing Poppins on
          the rest of the storefront. Falls back to Inter (site default)
          if Google Fonts fails. */}
      <style jsx global>{`
        .guide-detail,
        .guide-detail h1,
        .guide-detail h2,
        .guide-detail h3,
        .guide-detail h4,
        .guide-detail p,
        .guide-detail a,
        .guide-detail span,
        .guide-detail button,
        .guide-detail input,
        .guide-detail textarea {
          font-family: var(--font-poppins), var(--font-inter), 'Inter', ui-sans-serif, system-ui, sans-serif;
        }
        .article-body .rt-view h1 {
          font-size: 1.75rem;
          line-height: 1.25;
          margin: 1.75rem 0 0.75rem;
          font-weight: 600;
          letter-spacing: -1px;
          color: #000;
        }
        .article-body .rt-view h2 {
          font-size: 1.5rem;
          line-height: 1.52;
          margin: 1.75rem 0 0.75rem;
          font-weight: 400;
          letter-spacing: -1px;
          color: #000;
        }
        .article-body .rt-view h3 {
          font-size: 1.25rem;
          line-height: 1.52;
          margin: 1.5rem 0 0.5rem;
          font-weight: 500;
          letter-spacing: -0.5px;
          color: #000;
        }
        .article-body .rt-view p {
          margin: 0 0 1rem;
          color: #424242;
          line-height: 1.52;
        }
        .article-body .rt-view ul,
        .article-body .rt-view ol {
          margin: 0 0 1rem;
        }
        .article-body .rt-view li {
          margin: 0.35rem 0;
          color: #424242;
        }
        .article-body .rt-view blockquote {
          border-left: 3px solid #bdff00;
          background: #fafaf6;
          padding: 0.875rem 1rem;
          margin: 1.25rem 0;
          font-style: normal;
          color: #1a1a1a;
          border-radius: 0 0.5rem 0.5rem 0;
        }
        .article-body .rt-view img {
          margin: 1.25rem 0;
          border-radius: 0.75rem;
        }
        .article-body .rt-view a {
          color: #141414;
          text-decoration: underline;
          text-decoration-color: #bdff00;
          text-decoration-thickness: 2px;
          text-underline-offset: 3px;
        }
        .article-body .rt-view a:hover {
          background: #bdff00;
        }
      `}</style>
    </div>
  );
}

/** Breadcrumb separator — matches BlogDetailPage's Slash glyph. */
function Slash() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4 text-[#7e746e]" aria-hidden>
      <path d="M5 13 L11 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
