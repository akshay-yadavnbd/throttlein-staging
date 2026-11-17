'use client';

/**
 * Static prose page — `/<slug>` (also reachable via the legacy
 * `/page/<slug>`, which 301-redirects to the clean root URL).
 *
 * Fetches a single page by slug from /api/pages/<slug>. The admin
 * controls the URL slug, title, body (markdown), SEO meta, and the
 * Published toggle. Unpublished pages 404 publicly so draft URLs
 * don't leak.
 *
 * Layout: full container width with a header band (breadcrumb, title,
 * brand accent, last-updated) and a two-column body — a sticky
 * auto-generated "On this page" table of contents (built from the `##`
 * headings) plus the rendered content. The ToC collapses on mobile.
 *
 * Body rendering is a tiny inline markdown parser — covers headings,
 * lists, bold/italic, links, inline code, blockquotes, and horizontal
 * rules. Avoids pulling in react-markdown as a dependency just for
 * these prose pages.
 */

import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, envelopeOrLegacy } from '@/lib/api';
import { ProsePageSkeleton } from '@/components/common/PageSkeletons';

type Page = {
  _id: string;
  slug: string;
  title: string;
  body?: string;
  seoTitle?: string;
  seoDescription?: string;
  isPublished: boolean;
  updatedAt?: string;
};

/* Slugify a heading into a stable anchor id. Shared by the renderer
 * (which stamps the id onto each <h2>) and the ToC builder (which links
 * to it) so the two always agree. */
function headingSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/&amp;/g, 'and')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ─────────────────────────────────────────────────────────────────
 * Tiny markdown renderer
 * Single-pass conversion to HTML — handles the subset most marketing
 * copy uses. Output is fed via `dangerouslySetInnerHTML` to a wrapper
 * with Tailwind typography classes so paragraphs / headings / lists
 * get the storefront's polished look.
 * ─────────────────────────────────────────────────────────────── */
function renderMarkdown(md: string): string {
  if (!md) return '';
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let text = escape(md.replace(/\r\n?/g, '\n'));

  /* Class tokens for each markdown element — Tailwind utilities that
     roughly mimic the @tailwindcss/typography "prose" look without
     requiring the plugin. Kept here so the renderer stays one file. */
  const cls = {
    h1: 'text-3xl sm:text-4xl font-semibold text-[#141414] mt-10 mb-4 tracking-tight scroll-mt-[88px] md:scroll-mt-[152px]',
    h2: 'text-xl sm:text-2xl font-semibold text-[#141414] mt-11 mb-3 tracking-tight scroll-mt-[88px] md:scroll-mt-[152px]',
    h3: 'text-base sm:text-lg font-semibold text-[#141414] mt-7 mb-2 scroll-mt-[88px] md:scroll-mt-[152px]',
    h4: 'text-base font-semibold text-[#141414] mt-6 mb-2 scroll-mt-[88px] md:scroll-mt-[152px]',
    h5: 'text-base font-semibold text-[#141414] mt-5 mb-2',
    h6: 'text-sm font-semibold uppercase tracking-wider text-[#575757] mt-5 mb-2',
    p: 'text-[15.5px] text-[#3a3a3a] leading-[1.8] my-4',
    ul: 'list-disc pl-6 my-4 text-[#3a3a3a] space-y-2 marker:text-[#9aa37f]',
    ol: 'list-decimal pl-6 my-4 text-[#3a3a3a] space-y-2 marker:text-[#575757] marker:font-semibold',
    li: 'leading-[1.75] pl-1',
    blockquote: 'border-l-4 border-[#c8ff00] bg-[#fafbf8] pl-4 pr-3 py-2.5 my-5 italic text-[#3a3a3a] rounded-r-lg',
    hr: 'border-t border-[#eee] my-8',
    a: 'text-[#141414] font-medium underline decoration-[#c8ff00] decoration-2 underline-offset-2 hover:bg-[#eaffb0] transition-colors',
    code: 'bg-[#f3f4f2] rounded px-1.5 py-0.5 text-[0.92em] text-[#141414] font-mono',
    pre: 'bg-[#141414] text-white rounded-lg p-4 my-5 overflow-x-auto text-sm font-mono',
    strong: 'font-semibold text-[#141414]',
    table: 'w-full my-6 text-[14.5px] border border-[#e8e8e8] rounded-lg border-separate border-spacing-0 overflow-hidden',
    th: 'text-left font-semibold text-[#141414] bg-[#f6f7f3] px-4 py-2.5 border-b border-[#e8e8e8]',
    td: 'text-[#3a3a3a] px-4 py-2.5 border-b border-[#f0f0f0] align-top leading-relaxed',
  };

  // Fenced code blocks: ```lang\n...\n```
  text = text.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (_m, _lang, code) => {
    return `<pre class="${cls.pre}"><code>${code}</code></pre>`;
  });

  // Headings — h2/h3/h4 get an id so the ToC can deep-link to them.
  text = text.replace(/^###### (.+)$/gm, `<h6 class="${cls.h6}">$1</h6>`);
  text = text.replace(/^##### (.+)$/gm, `<h5 class="${cls.h5}">$1</h5>`);
  text = text.replace(/^#### (.+)$/gm, (_m, t) => `<h4 id="${headingSlug(t)}" class="${cls.h4}">${t}</h4>`);
  text = text.replace(/^### (.+)$/gm, (_m, t) => `<h3 id="${headingSlug(t)}" class="${cls.h3}">${t}</h3>`);
  text = text.replace(/^## (.+)$/gm, (_m, t) => `<h2 id="${headingSlug(t)}" class="${cls.h2}">${t}</h2>`);
  text = text.replace(/^# (.+)$/gm, `<h1 class="${cls.h1}">$1</h1>`);

  // Horizontal rule
  text = text.replace(/^---+$/gm, `<hr class="${cls.hr}"/>`);

  // Blockquote — single-line form
  text = text.replace(/^> (.+)$/gm, `<blockquote class="${cls.blockquote}">$1</blockquote>`);

  // Unordered lists — group consecutive "- " lines into one <ul>
  text = text.replace(/(?:^- .+(?:\n(?!\n).+)*\n?)+/gm, (match) => {
    const items = match
      .trim()
      .split(/\n(?=- )/)
      .map((line) => line.replace(/^- /, '').trim())
      .map((t) => `<li class="${cls.li}">${t}</li>`)
      .join('');
    return `<ul class="${cls.ul}">${items}</ul>`;
  });

  // Ordered lists — group consecutive "<n>. " lines into one <ol>
  text = text.replace(/(?:^\d+\. .+(?:\n(?!\n).+)*\n?)+/gm, (match) => {
    const items = match
      .trim()
      .split(/\n(?=\d+\. )/)
      .map((line) => line.replace(/^\d+\. /, '').trim())
      .map((t) => `<li class="${cls.li}">${t}</li>`)
      .join('');
    return `<ol class="${cls.ol}">${items}</ol>`;
  });

  // Tables (GitHub-flavoured): a header row, a | --- | separator row,
  // then one or more body rows. Converted to a styled <table>. Runs
  // before the inline pass so **bold** / [links] inside cells still work.
  text = text.replace(
    /^\|(.+)\|[ \t]*\n\|[ \t:|-]+\|[ \t]*\n((?:\|.*\|[ \t]*\n?)+)/gm,
    (_m, header, bodyRows) => {
      const cells = (row: string) =>
        row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(header)
        .map((c) => `<th class="${cls.th}">${c}</th>`)
        .join('');
      const rows = bodyRows
        .trim()
        .split('\n')
        .map((r: string) => {
          const tds = cells(r).map((c) => `<td class="${cls.td}">${c}</td>`).join('');
          return `<tr>${tds}</tr>`;
        })
        .join('');
      return `<table class="${cls.table}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    },
  );

  // Inline: bold, italic, code, links
  text = text.replace(/\*\*([^*]+)\*\*/g, `<strong class="${cls.strong}">$1</strong>`);
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/`([^`]+)`/g, `<code class="${cls.code}">$1</code>`);
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const isExternal = /^https?:\/\//i.test(url);
    const rel = isExternal ? ' target="_blank" rel="noreferrer"' : '';
    return `<a class="${cls.a}" href="${url}"${rel}>${label}</a>`;
  });

  // Paragraph wrap — split on blank lines, wrap each non-block chunk in <p>.
  const blocks = text.split(/\n{2,}/).map((chunk) => {
    const t = chunk.trim();
    if (!t) return '';
    if (/^<(h\d|ul|ol|blockquote|pre|hr|table)/.test(t)) return t;
    return `<p class="${cls.p}">${t.replace(/\n/g, '<br/>')}</p>`;
  });
  return blocks.join('\n');
}

/* Pull the `##` section headings out of the raw markdown to build the
 * "On this page" table of contents. Ids match what renderMarkdown stamps
 * onto each <h2> (see headingSlug). */
function buildToc(md: string): Array<{ id: string; text: string }> {
  if (!md) return [];
  const out: Array<{ id: string; text: string }> = [];
  const seen = new Set<string>();
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const text = m[1].replace(/\*\*/g, '').trim();
    let id = headingSlug(text);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text });
  }
  return out;
}

export default function ProsePage({
  params,
  initialPage = null,
}: {
  params: Promise<{ slug: string }>;
  // SSR-fetched page from the server page.tsx — the H1 (title) and
  // body are present in initial HTML for crawlers.
  initialPage?: Page | null;
}) {
  const { slug } = use(params);
  const [page, setPage] = useState<Page | null>(initialPage);
  const [loading, setLoading] = useState<boolean>(!initialPage);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Skip the refetch when the server already handed us THIS slug.
    //
    // It was a redundant request for content we had, and worse, it clobbered
    // server-side work on the body: the seller route rewrites in-content links
    // to the right property before rendering, and this refetch replaced that
    // with the raw authored body, resurrecting the broken links a moment after
    // hydration. It also produced a spurious 404 whenever the client request
    // resolved to a different site than the server did.
    //
    // Client-side navigation to another prose page changes `slug`, so the
    // guard lets that case through and still refetches.
    if (initialPage && initialPage.slug === slug) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    // Only show the spinner if we don't already have an SSR page —
    // keeps loaded content visible during hydration refresh.
    if (!page || page.slug !== slug) {
      setLoading(true);
    }
    setNotFound(false);
    api
      .get(`/pages/${encodeURIComponent(slug)}`).then(envelopeOrLegacy)
      .then(({ data }) => {
        if (!cancelled) setPage(data.page as Page);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, initialPage]);

  // Update <title> dynamically — keeps the tab name consistent without
  // needing Next.js's generateMetadata wiring (this is a client component).
  useEffect(() => {
    if (!page) return;
    const t = page.seoTitle || page.title;
    if (t) document.title = `${t} · THROTTLEIN`;
  }, [page]);

  const html = useMemo(() => renderMarkdown(page?.body || ''), [page?.body]);
  const toc = useMemo(() => buildToc(page?.body || ''), [page?.body]);

  // Scroll-spy — highlight the ToC entry for the section currently in view.
  // rootMargin top offset clears the sticky site header (~152px); the large
  // bottom inset means a heading becomes "active" once it nears the top.
  const [activeId, setActiveId] = useState<string>('');
  useEffect(() => {
    if (!toc.length) return;
    const els = toc
      .map((t) => document.getElementById(t.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActiveId((vis[0].target as HTMLElement).id);
      },
      { rootMargin: '-160px 0px -65% 0px', threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [toc, html]);

  if (loading) {
    return <ProsePageSkeleton />;
  }

  if (notFound || !page) {
    return (
      <div className="container py-24 text-center">
        <h1 className="text-3xl font-medium text-[#141414]">Page not found</h1>
        <p className="text-[#575757] mt-2">
          We couldn&apos;t find a page at{' '}
          <code className="bg-[#f3f4f2] rounded px-1.5 py-0.5">/{slug}</code>.
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

  const updated =
    page.updatedAt &&
    new Date(page.updatedAt).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

  return (
    <div className="bg-white">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="border-b border-[#eee]">
        <div className="container pt-6 pb-6 md:pt-8 md:pb-7">
          {/* Breadcrumb — same typography/colours as the products page
              strip (kept inline here because it lives inside the
              header band rather than its own bordered row). */}
          <nav className="flex items-center gap-1 font-poppins text-[14px] font-medium leading-none">
            <Link href="/" className="text-[#7e746e] hover:text-[#1a1410] transition">Home</Link>
            <span className="text-[#7e746e] mx-1" aria-hidden>/</span>
            <span className="text-[#1a1410]">{page.title}</span>
          </nav>
          <h1 className="mt-3.5 text-2xl sm:text-3xl font-semibold text-[#141414] tracking-tight leading-snug">
            {page.title}
          </h1>
          {updated && (
            <p className="mt-2 text-xs text-[#9a9a9a]">
              Last updated <span className="text-[#575757]">{updated}</span>
            </p>
          )}
        </div>
      </header>

      {/* ── Body — container width, ToC + content ───────────────── */}
      <div className="container py-10 md:py-14">
        <div
          className={
            toc.length > 0
              ? 'grid gap-8 lg:gap-12 lg:grid-cols-[240px_minmax(0,1fr)]'
              : ''
          }
        >
          {/* Table of contents — sticky on desktop, hidden on mobile */}
          {toc.length > 0 && (
            <aside className="hidden lg:block">
              <div className="sticky top-[152px] max-h-[calc(100vh-180px)] overflow-y-auto pr-1">
                <div className="text-[11px] uppercase tracking-[0.15em] font-bold text-[#9a9a9a] mb-3">
                  On this page
                </div>
                <nav className="flex flex-col border-l border-[#ececec]">
                  {toc.map((item) => {
                    const active = activeId === item.id;
                    return (
                      <a
                        key={item.id}
                        href={`#${item.id}`}
                        aria-current={active ? 'true' : undefined}
                        className={`text-[13px] leading-snug -ml-px pl-3 py-1.5 border-l-2 transition-colors ${
                          active
                            ? 'text-[#141414] font-semibold border-[#c8ff00]'
                            : 'text-[#575757] border-transparent hover:text-[#141414] hover:border-[#d6dbc4]'
                        }`}
                      >
                        {item.text}
                      </a>
                    );
                  })}
                </nav>
              </div>
            </aside>
          )}

          {/* Content */}
          <article className={`min-w-0 ${toc.length > 0 ? '' : 'max-w-3xl'}`}>
            {html ? (
              <div
                className="prose-policy"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
              />
            ) : (
              <p className="text-[#575757] italic">This page has no content yet.</p>
            )}
          </article>
        </div>
      </div>

      {/* First block (intro paragraph) shouldn't carry a big top margin.
          Smooth in-page scrolling for ToC anchor clicks. */}
      <style jsx global>{`
        html { scroll-behavior: smooth; }
        .prose-policy > :first-child { margin-top: 0; }
        .prose-policy table { display: table; }
        @media (max-width: 640px) {
          .prose-policy table { display: block; overflow-x: auto; white-space: nowrap; }
        }
      `}</style>
    </div>
  );
}
