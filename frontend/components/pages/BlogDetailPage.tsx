'use client';

/**
 * BlogDetailPage — Figma node 2455:3845.
 *
 * Layout (top → bottom):
 *   1. Cream banner block (#fafbf8)
 *        a. Breadcrumb (Home / Blog / Title) — max-w 1232
 *        b. Hero row (max-w 1232, gap-40):
 *             Left  (flex-1, pr-24): author chip → category pill + date · read-time
 *                                    → 64px Display title → 16px excerpt
 *             Right (562 × 453):     cover image
 *        c. Body row (max-w 1232, gap-40):
 *             Left  (850, pr-40, pt-40): article body — section headings 24px
 *                                        tracking -1, paragraphs 16px #424242
 *             Right (flex-1, sticky):    horizontal Share chip on a beige pill
 *                                        + "In this article" boxed ToC. Active
 *                                        item is a white shadowed card; rest
 *                                        are plain rows.
 *        d. "In short" author card (white, border, rounded-12, max-w 768):
 *             64px avatar + name 20px + role 14px tertiary, bio paragraph,
 *             credential pills (rounded-49, bg #f3f4f2).
 *   2. White FAQ block (py-80, max-w 1000, px-120):
 *        Lime label chip "FAQ" + H2 "Have any questions?", accordion items.
 *        Closed: bg white, plus icon. Open: bg #f3f4f2, cross icon, answer.
 *        Renders only when `post.faqs` is non-empty.
 *   3. Cream "You may also like" block (#fafbf8, py-80, max-w 1100):
 *        H2 + 3-up card grid — image (310 high), category pill, 20px title,
 *        date 14px tertiary.
 *   4. Comments block (kept from prior implementation — moderation pipeline
 *      is unchanged so we don't strand the existing comments UX).
 *
 * Mechanics:
 *   - ToC is derived from rendered h2/h3 — useEffect walks `articleRef`,
 *     slugifies headings, assigns IDs and `scroll-mt-28` for anchor offsets.
 *   - IntersectionObserver tracks the topmost visible heading so the rail
 *     can light up the active tab (white card with shadow).
 *   - The sticky rail uses `lg:sticky lg:top-6` so it pins on scroll within
 *     its grid parent (parent must have `items-start`).
 */

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Spinner, Button } from '@heroui/react';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';
import {
  buildPostUrl,
  buildPostUrlForSite,
  blogPathForSite,
  BLOG_NESTS_CATEGORY,
} from '@/lib/blogUrl';
import { originForSite, type SiteKey } from '@/lib/site';
import RichTextView from '@/components/common/RichTextView';
import { notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';

type Author = {
  _id: string;
  name: string;
  slug?: string;
  role?: string;
  bio?: string;
  avatarUrl?: string;
  credentials?: string[];
};
type Category = { _id: string; name: string; slug: string };
type Tag = { _id: string; name: string; slug: string };
type FAQ = { _id?: string; question: string; answer: string };

type Post = {
  _id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  featuredImage?: string;
  category?: Category | null;
  tags?: Tag[];
  author?: Author;
  publishedAt: string;
  readingMinutes: number;
  viewCount: number;
  faqs?: FAQ[];
  faqHeading?: string;
  // Storefront-rendered intro summary + citations. Both optional —
  // posts that don't set them just skip the section.
  keyTakeaways?: string;
  references?: { title: string; url: string }[];
  // root → leaf category breadcrumb returned by the backend.
  categoryChain?: { _id: string; name: string; slug: string }[];
};

function fmtDate(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function slugifyHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Pre-process the body HTML so every <h2>/<h3> gets a unique `id` and
 * `scroll-mt-28` class baked in. Doing this BEFORE the HTML is set via
 * dangerouslySetInnerHTML is more reliable than assigning IDs in a
 * useEffect — the useEffect approach was being silently undone by
 * subsequent renders, and duplicate headings ("Why Helmet Safety
 * Matters" appears 12× in the test article) ended up with the same id,
 * breaking anchor scrolling AND the active-section observer.
 *
 * Returns the rewritten HTML and the matching ToC entries in document
 * order.
 */
/**
 * Remove `nofollow` from internal-link rel attributes inside arbitrary
 * blog HTML. Runs on both server (SSR) and client paths, so already-saved
 * posts produced by the legacy editor (which emitted nofollow by default)
 * stop tripping Semrush's "internal links contain nofollow" check on the
 * very next render — no re-publish required.
 *
 * Internal = relative URLs (`href="/..."`) or absolute URLs pointing at
 * any throttlein.com host (apex, www, or any subdomain). External links
 * keep their nofollow attribute intact, because that's still the correct
 * SEO signal for outbound editorial citations.
 */
function stripInternalNofollow(html: string): string {
  if (!html) return html;
  return html.replace(/<a\b([^>]*?)>/gi, (full, attrs: string) => {
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (!hrefMatch) return full;
    const href = (hrefMatch[1] ?? hrefMatch[2] ?? '').trim();
    const isInternal =
      href.startsWith('/') ||
      href.startsWith('#') ||
      /^https?:\/\/([a-z0-9-]+\.)*throttlein\.com(?:[\/?#]|$)/i.test(href);
    if (!isInternal) return full;
    const relMatch = attrs.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (!relMatch) return full;
    const relRaw = (relMatch[1] ?? relMatch[2] ?? '').trim();
    const cleaned = relRaw
      .split(/\s+/)
      .filter((t) => t.toLowerCase() !== 'nofollow')
      .join(' ')
      .trim();
    const replaced = cleaned
      ? attrs.replace(/\brel\s*=\s*(?:"[^"]*"|'[^']*')/i, `rel="${cleaned}"`)
      : attrs.replace(/\s*\brel\s*=\s*(?:"[^"]*"|'[^']*')/i, '');
    return `<a${replaced}>`;
  });
}

function decodeHeadingEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

// Regex-based instead of DOMParser — DOMParser doesn't exist in Node, so
// the old implementation bailed out with an empty `toc` during SSR and
// only computed real headings once it ran again on the client. That made
// the mobile "In this article" drawer (which only renders when
// `toc.length > 0`) appear AFTER hydration, and React flagged the
// mismatch between the server and client HTML. Working on the raw HTML
// string instead means SSR and the client compute the exact same thing.
function buildHeadingsToc(html: string): {
  html: string;
  toc: Array<{ id: string; text: string; level: 2 | 3 }>;
} {
  if (!html) return { html, toc: [] };
  const seen = new Set<string>();
  const toc: Array<{ id: string; text: string; level: 2 | 3 }> = [];
  const rewritten = html.replace(
    /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (full: string, levelStr: string, attrs: string, inner: string) => {
      const text = decodeHeadingEntities(inner.replace(/<[^>]+>/g, '')).trim();
      if (!text) return full;
      let id = slugifyHeading(text) || 'section';
      let n = 2;
      while (seen.has(id)) id = `${slugifyHeading(text) || 'section'}-${n++}`;
      seen.add(id);
      // The sidebar ToC only lists top-level (h2) sections — h3
      // sub-headings still get IDs below for deep-linking, just no
      // entry in the rail. Keeps long articles scannable instead of
      // overwhelming the user with every nested heading.
      if (levelStr === '2') {
        toc.push({ id, text, level: 2 });
      }
      const classMatch = attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const existingClass = (classMatch?.[1] ?? classMatch?.[2] ?? '').trim();
      // scroll-mt-40 = 10rem = 160px — clears the 137px sticky site nav
      // (logo bar + category strip) plus a small visual buffer when the
      // user jumps to an anchor.
      const mergedClass = `${existingClass} scroll-mt-40`.trim();
      const attrsNoIdOrClass = attrs
        .replace(/\s+id\s*=\s*(?:"[^"]*"|'[^']*')/i, '')
        .replace(/\s+class\s*=\s*(?:"[^"]*"|'[^']*')/i, '');
      return `<h${levelStr}${attrsNoIdOrClass} id="${id}" class="${mergedClass}">${inner}</h${levelStr}>`;
    },
  );
  return { html: rewritten, toc };
}

export default function BlogDetailPage({
  params,
  initialPost = null,
  site = 'main',
}: {
  // Catch-all dynamic route: the URL is /blog/<chain>/<postSlug> where
  // <chain> can be 0..N category slug segments (root → leaf order).
  // The very last segment is always the post's own slug.
  params: Promise<{ slug: string[] }>;
  // SSR-fetched post passed in from the server `page.tsx` so the
  // initial HTML already contains the H1, body, author chip, etc.
  // Crawlers (and View Source) see real content immediately instead
  // of a skeleton. The client-side useEffect below still refetches
  // to refresh the data after hydration / when the slug changes.
  initialPost?: Post | null;
  /**
   * Which property is rendering. The layout is identical either way —
   * this decides which ORIGIN the share links use and which blog index
   * the internal links point at. Defaults to 'main' so the storefront's
   * existing call sites are unchanged.
   */
  site?: SiteKey;
}) {
  const { slug: pathSegments } = use(params);
  const postSlug = pathSegments[pathSegments.length - 1];
  const chainSegments = pathSegments.slice(0, -1);
  const [post, setPost] = useState<Post | null>(initialPost);
  const [related, setRelated] = useState<Post[]>([]);
  // `loading` starts false when we already have an SSR post — the
  // skeleton would otherwise flash on top of the real content during
  // the brief moment between hydration and the useEffect refetch.
  const [loading, setLoading] = useState<boolean>(!initialPost);
  // Set true when the URL's category chain doesn't match the post's
  // actual chain — we render the "Not found" view in that case.
  const [chainMismatch, setChainMismatch] = useState(false);

  // ToC + active-heading tracking. The ToC and the rewritten body
  // HTML (with id="…" baked into every h2/h3) are derived together so
  // they're guaranteed in sync. See `buildHeadingsToc` above.
  const articleRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string>('');

  // FAQ accordion — controlled, starts with first item open (matches Figma)
  const [openFaq, setOpenFaq] = useState<number>(0);

  // Share URL — built from the known post data instead of
  // `window.location.href`, so it's identical on the server and the
  // client. The old client-only version was '' during SSR and the real
  // URL after hydration, which made the `shareTargets &&` share buttons
  // below appear only post-hydration — the same server/client HTML
  // mismatch class as the ToC drawer fixed above.
  //
  // The ORIGIN must come from `originForSite(site)`, not the main-site
  // SITE_URL. This component serves both properties: with SITE_URL, every
  // Facebook/LinkedIn/WhatsApp share from a seller post published
  // `https://throttlein.com/blog/<slug>` — a URL that 404s, because the
  // post only exists on seller.throttlein.com. Canonical and JSON-LD were
  // already site-aware; only the share rail was wrong.
  const shareUrl = post ? `${originForSite(site)}${buildPostUrl(post)}` : '';
  /** This property's blog index — `/blog` on main, the seller-prefixed
   *  path in dev, the seller origin in production. */
  const blogIndexHref = blogPathForSite('/blog', site);
  /** Section name for this property — mirrors BlogIndexPage's crumb and
   *  the BreadcrumbList JSON-LD, so all three agree. */
  const blogLabel = site === 'seller' ? 'Seller Blog' : 'Blogs';

  useEffect(() => {
    // Show skeleton only when we don't already have an SSR post for
    // this slug — keeps the loaded layout visible during client-side
    // refetches and navigations between posts with the same prefix.
    if (!post || post.slug !== postSlug) {
      setLoading(true);
    }
    setChainMismatch(false);
    api.get(`/blog/${postSlug}`).then(envelopeOrLegacy)
      .then(async ({ data }) => {
        // Verify the URL's category chain matches the post's actual
        // chain (root → leaf). Strict equality, slug-by-slug. Mismatch
        // renders the "Not found" view so wrong-tree links don't show
        // duplicate-content for SEO.
        //
        // Skipped on properties whose post URLs are FLAT by design
        // (seller — see BLOG_NESTS_CATEGORY). There the canonical URL
        // carries no chain at all, so "chain must equal the post's
        // chain" would reject every legitimate URL: the page rendered
        // correct SSR metadata and then replaced the article with
        // "Post not found" the moment it hydrated.
        const actualChain: string[] = (data.post?.categoryChain || []).map(
          (c: { slug: string }) => c.slug
        );
        const chainMatches =
          !BLOG_NESTS_CATEGORY[site] ||
          (chainSegments.length === actualChain.length &&
            chainSegments.every((seg, i) => seg === actualChain[i]));
        if (!chainMatches) {
          setChainMismatch(true);
          setPost(null);
          return;
        }
        setPost(data.post);

        // ── "You may also like" — prefer same-category posts, then top
        //    up with random posts from any category so the section is
        //    always populated (up to 3 cards).
        const currentId = data.post?._id;
        const picks = new Map<string, Post>(); // _id → post (dedup)
        const take = (items: Post[]) => {
          for (const p of items) {
            if (picks.size >= 3) break;
            if (!p || !p._id || p._id === currentId || picks.has(p._id)) continue;
            picks.set(p._id, p);
          }
        };

        try {
          // Pass 1 — same category as the current post.
          if (data.post?.category?.slug) {
            const { data: rel } = await api.get('/blog', {
              params: { category: data.post.category.slug, limit: 6 },
            }).then(envelopeOrLegacy);
            take(rel.items || []);
          }
          // Pass 2 — fill remaining slots with any recent posts. The
          // backend list is roughly date-ordered; we shuffle client-side
          // to keep the strip from looking static if it's the only
          // available pool.
          if (picks.size < 3) {
            const { data: any } = await api.get('/blog', { params: { limit: 12 } }).then(envelopeOrLegacy);
            const pool = ([...(any.items || [])] as Post[]).sort(() => Math.random() - 0.5);
            take(pool);
          }
        } catch {
          /* swallow — related strip is non-critical */
        }
        setRelated(Array.from(picks.values()));
      })
      .catch(() => setPost(null))
      .finally(() => setLoading(false));
    // Re-fetch when the resolved post slug changes (e.g. user navigates
    // between blog posts). The chain segments influence validation but
    // not the network call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postSlug, chainSegments.join('/')]);

  // Pre-process the body HTML once per post — bake unique IDs into
  // every heading. Memoised so repeated parent renders don't redo the
  // regex pass. Runs identically during SSR and on the client (see
  // buildHeadingsToc), so `toc` is never empty-then-populated.
  const { html: bodyWithIds, toc } = useMemo(
    // Strip nofollow from internal-link rel attributes BEFORE heading-id
    // injection. The sanitiser is a pure regex pass (works in SSR + CSR),
    // so crawlers that hit the page get the cleaned HTML on the very
    // first render — no rehydration delay.
    () => buildHeadingsToc(stripInternalNofollow(post?.body || '')),
    [post?.body]
  );

  // Track which heading is currently in view via a throttled scroll
  // listener. CRITICAL: query the headings fresh inside compute() each
  // time — capturing them once in useEffect made the array reference
  // stale DOM nodes after Strict-Mode re-mounts (the captured nodes
  // were detached and their getBoundingClientRect() returned top:0,
  // which made every heading look "above the line" and stuck the
  // active state on the last item).
  useEffect(() => {
    if (!post) return;
    // Matches the scroll-mt-40 anchor offset baked onto each heading
    // (160px) so the "active" handoff happens right as the previous
    // heading clears the sticky nav band.
    const OFFSET = 160;
    let rafId: number | null = null;
    const compute = () => {
      const root = articleRef.current;
      if (!root) return;
      const headings = Array.from(
        // Active-section tracker only watches h2 — h3 sub-headings
        // are intentionally absent from the sidebar (see
        // buildHeadingsToc), so scrolling through them shouldn't
        // shift the active highlight.
        root.querySelectorAll('h2[id]')
      ) as HTMLHeadingElement[];
      if (!headings.length) return;
      // Tolerance of 8px on the active boundary — covers sub-pixel
      // rounding after smooth scrollIntoView (the heading's top can
      // land at 160.x instead of exactly 160) AND gives a small
      // anticipation window when the user manually scrolls a section
      // close to the line.
      const ACTIVE_TOLERANCE = 8;
      let current = headings[0].id;
      for (const h of headings) {
        if (h.getBoundingClientRect().top - OFFSET <= ACTIVE_TOLERANCE) {
          current = h.id;
        } else {
          break;
        }
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        compute();
      });
    };

    // Initial pass + listener.
    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [post, bodyWithIds]);

  const shareTargets = useMemo(() => {
    if (!post || !shareUrl) return null;
    const t = encodeURIComponent(post.title);
    const u = encodeURIComponent(shareUrl);
    return {
      // Figma shows three icons: FB · IG · LinkedIn. Instagram doesn't
      // support article-share URLs, so the IG button links to the brand
      // profile instead (override via NEXT_PUBLIC_INSTAGRAM_URL).
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
      instagram:
        process.env.NEXT_PUBLIC_INSTAGRAM_URL ||
        'https://www.instagram.com/throttlein_india/',
      linkedin: `https://www.linkedin.com/shareArticle?mini=true&url=${u}&title=${t}`,
    };
  }, [post, shareUrl]);

  // Kept for future use — copy-link button isn't in the Figma but is
  // useful muscle memory. Not currently rendered.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // Smooth-scroll handler for ToC anchor clicks. Native anchor jumps
  // are instant; this intercepts the click, calls scrollIntoView with
  // behavior: 'smooth', and updates the URL hash without triggering
  // another (instant) jump.
  function handleTocClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    // Immediate visual feedback — the scroll listener will continue
    // to drive subsequent updates as the user scrolls naturally.
    setActiveId(id);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Update the URL hash so deep-links/refresh still work, but without
    // the native jump.
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', `#${id}`);
    }
  }

  async function copyShareLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      notifySuccess(M.blogDetail.linkCopied);
    } catch {
      notifyWarning(M.blogDetail.couldNotCopy);
    }
  }

  if (loading) {
    return (
      <div className="blog-detail bg-white">
        <section className="bg-[#fafbf8] pb-20 space-y-10 animate-pulse">
          {/* Breadcrumb strip */}
          <div className="max-w-[1232px] mx-auto px-4 md:px-6 lg:px-10 xl:px-0 py-4">
            <div className="h-4 w-64 bg-default-200 rounded" />
          </div>

          {/* Hero — two-column grid mirroring the loaded layout */}
          <div className="max-w-[1232px] mx-auto px-4 md:px-6 lg:px-10 xl:px-0">
            <div className="grid items-stretch gap-6 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:grid-cols-[minmax(0,1fr)_562px] md:gap-10">
              <div className="flex flex-col gap-6 min-w-0 lg:pr-6 lg:justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-7 w-20 bg-default-200 rounded-md" />
                  <div className="h-3 w-48 bg-default-200 rounded" />
                </div>
                <div className="flex flex-col gap-3">
                  <div className="h-12 w-full bg-default-200 rounded" />
                  <div className="h-12 w-5/6 bg-default-200 rounded" />
                  <div className="h-12 w-3/4 bg-default-200 rounded" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-full bg-default-200" />
                  <div className="flex flex-col gap-2">
                    <div className="h-4 w-32 bg-default-200 rounded" />
                    <div className="h-3 w-24 bg-default-200 rounded" />
                  </div>
                </div>
              </div>
              <div className="w-full aspect-[562/453] rounded-[12px] bg-default-200" />
            </div>
          </div>

          {/* Body + sticky rail skeleton */}
          <div className="max-w-[1232px] mx-auto px-4 md:px-6 lg:px-10 xl:px-0">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,850px)_minmax(0,1fr)] gap-6 lg:gap-10">
              <div className="min-w-0 lg:pr-10 lg:pt-10">
                {/* In short card placeholder */}
                <div className="bg-white border border-[#e0e0e0] rounded-[12px] p-8 flex flex-col gap-4">
                  <div className="h-5 w-24 bg-default-200 rounded" />
                  <div className="space-y-2">
                    <div className="h-4 w-full bg-default-200 rounded" />
                    <div className="h-4 w-11/12 bg-default-200 rounded" />
                    <div className="h-4 w-3/4 bg-default-200 rounded" />
                  </div>
                </div>
                {/* Body paragraphs placeholder */}
                <div className="mt-10 space-y-3">
                  <div className="h-4 w-full bg-default-200 rounded" />
                  <div className="h-4 w-11/12 bg-default-200 rounded" />
                  <div className="h-4 w-10/12 bg-default-200 rounded" />
                  <div className="h-4 w-full bg-default-200 rounded" />
                  <div className="h-4 w-9/12 bg-default-200 rounded" />
                </div>
                <div className="mt-8 space-y-3">
                  <div className="h-6 w-1/2 bg-default-200 rounded" />
                  <div className="h-4 w-full bg-default-200 rounded" />
                  <div className="h-4 w-10/12 bg-default-200 rounded" />
                  <div className="h-4 w-11/12 bg-default-200 rounded" />
                </div>
              </div>

              {/* Sticky rail skeleton */}
              <div className="hidden lg:block">
                <div className="lg:pt-[120px] flex flex-col gap-10">
                  <div className="h-12 w-full bg-[#e2e3dd] rounded-[8px]" />
                  <div className="flex flex-col gap-4">
                    <div className="h-5 w-32 bg-default-200 rounded" />
                    <div className="flex flex-col gap-2">
                      <div className="h-10 w-full bg-default-200/60 rounded-md" />
                      <div className="h-10 w-full bg-default-200/60 rounded-md" />
                      <div className="h-10 w-full bg-default-200/60 rounded-md" />
                      <div className="h-10 w-full bg-default-200/60 rounded-md" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-center px-4">
        <h1 className="text-2xl font-semibold text-brand-black">Post not found</h1>
        <p className="text-default-500">
          {chainMismatch
            ? "This URL doesn't match the post's current category. It may have moved."
            : 'This article may have been moved or unpublished.'}
        </p>
        <Link href={blogIndexHref}>
          <Button className="font-semibold bg-brand-black text-white">Back to all blogs</Button>
        </Link>
      </div>
    );
  }

  const faqs = (post.faqs || []).filter((f) => f && f.question);

  return (
    <div className="blog-detail bg-white">
      {/* ════════════════════════════════════════════════════════════════
          1. BANNER — cream block holding breadcrumb, hero row, body row,
             sticky rail, and the "In short" author card.
          ══════════════════════════════════════════════════════════════ */}
      <div className='py-4 border-b border-[#EEE]'>
        <div className="container">
          <div className="flex items-center gap-1 font-poppins">
            {/* Both crumbs resolve against THIS property. On the seller
                blog, "Home" is the Seller Hub and "Blog" is the seller
                blog index — pointing either at the storefront would walk
                the reader off the property mid-article. */}
            <Link href={blogPathForSite('/', site)} className="text-[14px] font-medium leading-none text-[#7e746e] hover:text-brand-black">
              Home
            </Link>
            <Slash />
            <Link href={blogIndexHref} className="text-[14px] font-medium leading-none text-[#7e746e] hover:text-brand-black">
              {blogLabel}
            </Link>
            <Slash />
            <span className="text-[14px] font-medium leading-none text-[#1a1410] truncate max-w-[60vw]">
              {post.title}
            </span>
          </div>
        </div>
      </div>

      <section className="pt-10 space-y-10">
        {/* Breadcrumb — Figma puts the breadcrumb on its own row with
            16px internal padding. Sits at the very top of the cream
            banner. `space-y-10` on the section gives every child a
            40px top margin (except the first), matching the Figma
            flex-col gap-[40px] without using flex (`mx-auto` in a flex
            container shrinks the child to content width, which would
            make the short breadcrumb collapse and misalign it from
            the wider hero row). */}
        {/* Breadcrumb — Figma node 2576:899.
            Each crumb is 14px Poppins Medium, leading-none. Color
            tokens: intermediate crumbs use `content/tertiary` (#7e746e),
            the final/current crumb uses `content/primary` (#1a1410). */}


        {/* Hero row — explicit two-column grid so the image and text are
            reliably side-by-side at md+. Below md, the image stacks under
            the title (mobile). Figma calls for `gap-40` between columns. */}
        <div className="container" style={{ maxWidth: '1272px' }}>
          <div
            className={
              // `items-stretch` at lg+ lets the text column match
              // the image's 453px height; without it the text column
              // ends ~120px above the image and creates a big visual
              // gap before the body row. At mobile the columns stack
              // so stretch has no effect.
              'grid items-stretch gap-6 ' +
              (post.featuredImage
                ? 'grid-cols-1 md:gap-10'
                : 'grid-cols-1')
            }
          >
            {/* LEFT — text column. Figma node 2576:913.
                Order per Figma: category pill + meta line FIRST, then
                title, then author chip last. `gap-6` (24px) is the
                Figma's content-stretch gap-[24px]. `lg:pr-6` mirrors
                the design's internal pr-[24px].
                `lg:justify-between` distributes the three groups over
                the column height so the author chip baseline-aligns
                with the bottom of the image instead of floating ~120px
                above it. */}
            <div className="flex flex-col gap-6 min-w-0 lg:justify-between">
              {/* Category lime pill + "Published [date] · X min read"
                  Figma node 2576:919 — 16px gap between pill and meta
                  line, pill is #d4fa00, meta is 14px tertiary (#9e9e9e),
                  vertical hairline divider between date and reading
                  time. */}
              <div className="flex items-center gap-4 flex-wrap">
                {post.category && (
                  <Link
                    href={blogPathForSite(`/blog/category/${post.category.slug}`, site)}
                    className="inline-flex items-center bg-[#EAF4FF] text-[#2563EB] px-3 py-0.5 h-7 rounded-full text-[11px] font-semibold tracking-wider"
                  >
                    {post.category.name}
                  </Link>
                )}
                <div className="flex items-center gap-3 font-poppins text-sm leading-[1.52] text-[#424242]">
                  <span className='flex gap-2 items-center'> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg> Published {fmtDate(post.publishedAt)}</span>
                  <span className="w-px h-[11.4px] bg-[#d4d4d4]" />
                  <span>{post.readingMinutes} min read</span>
                </div>
              </div>

              {/* Title — Figma HL/HL-1: Poppins Medium 48px,
                  leading 1.38, tracking -1.8px. Color content/primary
                  (#111827). Scales down on smaller breakpoints. */}
              {/* 28px on phones (max ~30 requested), scaling up to the
                  Figma 40px from md. Tighter tracking only at the large
                  size — -2px looks cramped at 28px. */}
              <h1 className="font-poppins font-medium text-[#111827] text-[28px] tracking-[-1px] md:text-[40px] md:tracking-[-2px] leading-[1.35] m-0">
                {post.title}
              </h1>

              {/* Author chip — Figma node 2576:914. 56px avatar +
                  20/14 name+role stack. */}
              {(() => {
                const a = post.author;
                const name = a?.name || 'Throttlein Editorial';
                const role = a?.role || 'Bike accessories desk';
                return (
                  <div className="flex items-center gap-3">
                    {a?.avatarUrl ? (
                      <Image
                        src={imageUrl(a.avatarUrl)}
                        alt={name || 'Author avatar'}
                        width={56}
                        height={56}
                        className="w-12 h-12 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <span className="w-12 h-12 rounded-full bg-brand-black text-white grid place-items-center text-lg font-bold shrink-0 ring-2 ring-brand-lime/40">
                        {name[0]?.toUpperCase() || 'T'}
                      </span>
                    )}
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="font-poppins text-[16px] text-black font-semibold leading-[1.32]">
                        By {name}
                      </span>
                      <span className="font-poppins text-[12px] text-[#7E746E] leading-none">
                        {role}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* RIGHT — cover image. Aspect lock matches Figma's 562×453. */}
            {post.featuredImage && (
              <div className="p-2">
                <div className="relative w-full aspect-[237/107] max-h-[550px] rounded-xl overflow-hidden bg-default-100">
                  <Image
                    src={imageUrl(post.featuredImage)}
                    alt={post.title}
                    fill
                    // The hero spans the full article column (~1100px on
                    // desktop) — the old "562px" hint was from a retired
                    // two-column layout and made Next serve a ~640px file
                    // that the browser upscaled (visibly blurry).
                    sizes="(max-width: 768px) 100vw, (max-width: 1280px) 92vw, 1200px"
                    className="object-cover"
                    priority
                  />
                </div>
              </div>
            )}
          </div>
          {post.excerpt && (
            <aside
              aria-label="Article summary"
              /* Figma node 2576:931 — In Short card.
                 - border #e0e0e0 (Gray/300 in the Figma palette)
                 - 32px padding (matches the design's p-[32px])
                 - 16px vertical gap between heading and body
                 - heading is 20px regular, not bold (HS/HS-4) */
              className="bg-white mt-10 border border-[#E0E0E0] rounded-2xl p-5 md:p-8 flex flex-col gap-4"
            >
              <h2 className="font-poppins text-[20px] font-semibold text-black leading-[1.52] m-0">
                In short
              </h2>
              <p className="font-poppins text-[16px] text-[#424242] leading-[1.52]">
                {post.excerpt}
              </p>
            </aside>
          )}
        </div>

        {/* Body row — article body + sticky rail. At lg+ we use the
            exact Figma split (850px article column + flex-1 sidebar).
            `items-stretch` (default) lets the right grid item match the
            article column's height, which gives the sticky inner div
            room to travel for the full length of the article instead of
            popping out of view as soon as its short content ends.
            Top spacing comes from the section-level `gap-10`. */}
        <div className="container" style={{ maxWidth: '1272px' }}>
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
                            className={`block min-h-10 px-3 py-2 text-sm rounded-md hover:bg-default-100 ${item.level === 3
                              ? 'pl-6 text-[#7e746e]'
                              : 'text-[#424242]'
                              }`}
                          >
                            {item.text}
                          </a>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                {/* "In short" — excerpt rendered as an intro card so the
                  TL;DR is the first thing readers see when they land
                  on the article body. Same visual chrome as the
                  author card at the bottom of the page so the two
                  bookend the body. Only renders when excerpt is set. */}


                <div
                  ref={articleRef}
                  /* mt-10 = 40px gap below the In short card — matches
                     Figma's gap between the In short frame and the
                     first body section. The same 40px rhythm carries
                     through to References, Key Takeaways, and Tags
                     (each has `mt-10`). */
                  className="article-body mt-10 lg:mt-0 text-base text-[#424242] leading-[1.52]"
                >
                  <RichTextView html={bodyWithIds} />
                </div>

                {/* References &amp; Sources — Figma puts the citations
                  immediately after the body and BEFORE the Key
                  Takeaways box. Each row is a single-line link with
                  a small chain-link glyph on the left and an
                  external-arrow on the right; rows are separated by
                  thin dividers. Links open in a new tab with
                  rel="noopener nofollow" because they're external
                  URLs the editor curated, not arbitrary user input. */}
                {post.references && post.references.length > 0 && (
                  <section
                    aria-label="References and sources"
                    /* Figma node 2576:970 — same chrome as In Short.
                       mt-10 = 40px gap from the article body above and
                       from Key Takeaways below (also 40px per Figma). */
                    className="mt-10 bg-white border border-[#EEE] rounded-2xl p-6 flex flex-col gap-4"
                  >
                    <h2 className="font-poppins base font-semibold text-black leading-[1.52] m-0">
                      References &amp; Sources
                    </h2>
                    {/* Row list: 8px vertical gap between rows
                      (Figma's gap-[8px] in the rows container). */}
                    <ul className="flex flex-col gap-2">
                      {post.references.map((r, i) => (
                        <li key={i}>
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener nofollow"
                            /* Per Figma: rounded-4, px-6 py-8, full-width
                               row with #fafbf8 hover background. 12px gap
                               between icon, title, arrow. Color tokens
                               come straight from the Figma palette. */
                            className="group flex items-center gap-3 px-4 py-2 rounded-lg text-black hover:bg-[#EAF4FF] hover:text-[#1D4ED8] transition"
                          >
                            {/* Icon wrapper: 33×33 centre-aligned (Figma's
                              `size-[33px]`). The chain-link SVG inside is
                              26.4px — the user's preferred glyph at the
                              exact size the Figma component uses. */}
                            <span className="flex items-center justify-center shrink-0 w-[33px] h-[33px]">
                              <svg
                                aria-hidden
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 27 27"
                                fill="none"
                                className="w-[26.4px] h-[26.4px]"
                              >
                                <path
                                  d="M9.90052 16.5L16.5005 9.89999M12.1005 6.59999L12.6098 6.01039C13.6414 4.97895 15.0405 4.39956 16.4993 4.39966C17.958 4.39976 19.357 4.97936 20.3885 6.01094C21.4199 7.04253 21.9993 8.4416 21.9992 9.90038C21.9991 11.3592 21.4195 12.7582 20.3879 13.7896L19.8005 14.3M14.3005 19.8L13.8638 20.3874C12.8202 21.4194 11.4117 21.9982 9.944 21.9982C8.47628 21.9982 7.06777 21.4194 6.02415 20.3874C5.50974 19.8788 5.10135 19.2731 4.82263 18.6056C4.54391 17.938 4.40039 17.2218 4.40039 16.4983C4.40039 15.7749 4.54391 15.0587 4.82263 14.3911C5.10135 13.7236 5.50974 13.1179 6.02415 12.6093L6.60055 12.1"
                                  stroke="currentColor"
                                  strokeWidth="1.2375"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                            <span className="flex-1 min-w-0 font-poppins text-[16px] leading-[1.52] truncate">
                              {r.title}
                            </span>
                            {/* External-link arrow — Figma uses a 16×16
                              `arrow-up-right` icon on the right. */}
                            <svg
                              aria-hidden
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 16 16"
                              fill="none"
                              className="w-4 h-4 shrink-0"
                            >
                              <path
                                d="M11.3327 4.66675L4.66602 11.3334M11.3327 10.6667V4.66675H5.33268"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* Key Takeaways — Figma places this after the References
                  block as the final summary card before the author
                  bio. White card, simple "Key takeaways" heading, and
                  a bullet list rendered from the author's TipTap HTML
                  (.article-body styling matches the main body so
                  bullets, bold, links all look consistent). */}
                {post.keyTakeaways && post.keyTakeaways.trim() && (
                  <section
                    aria-label="Key takeaways"
                    /* Figma node 2576:1000 — same chrome as the other
                       two cards. mt-10 = 40px gap from References. */
                    className="mt-10 bg-white border border-[#EEE] rounded-2xl p-6 flex flex-col gap-4"
                  >
                    <h2 className="font-poppins text-base font-semibold text-black leading-[1.52] m-0">
                      Key takeaways
                    </h2>
                    <div className="article-body font-poppins text-sm text-[#424242] leading-[1.52]">
                      <RichTextView html={post.keyTakeaways} />
                    </div>
                  </section>
                )}

                {/* Tags row — kept under the article body, above the in-short author card */}
                {post.tags && post.tags.length > 0 && (
                  <div className="mt-10 flex items-center gap-2 flex-wrap">
                    <span className="text-xs uppercase tracking-wider font-bold text-default-500">
                      Tags
                    </span>
                    {post.tags.map((t) => (
                      <Link
                        key={t._id}
                        // NOTE: BlogIndexPage does not read a `tag` search
                        // param, so this filters nothing — it just lands on
                        // the blog index. Pre-existing on both properties;
                        // made site-aware here so it at least lands on the
                        // RIGHT index. Wire up tag filtering to make it real.
                        href={blogPathForSite(`/blog?tag=${t.slug}`, site)}
                        className="text-xs px-2.5 py-1 rounded-full bg-default-100 text-[#3a3a3a] hover:bg-default-200 hover:text-brand-black transition"
                      >
                        #{t.name}
                      </Link>
                    ))}
                  </div>
                )}
                {/* Author bio card — Figma node 2576:1045.
            max-w 768, border `border/default` (#eee), rounded-12,
            p-24, gap-24. 64px avatar, 20/14 name+role, 16px bio in
            #575757, tag pills bg `surface/tertiary` (#f3f4f2)
            rounded-49 with 12px text in #1a1410. */}
                {post.author && (post.author.bio || (post.author.credentials && post.author.credentials.length)) && (
                  <div className=" border border-[#EEE] rounded-[12px] p-6 flex flex-col gap-6 mt-10">
                    <div className="flex items-center gap-3">
                      {post.author.avatarUrl ? (
                        <Image
                          src={imageUrl(post.author.avatarUrl)}
                          alt={post.author.name || 'Author avatar'}
                          width={64}
                          height={64}
                          className="w-12 h-12 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <span className="w-12 h-12 rounded-full bg-brand-black text-white grid place-items-center text-xl font-bold shrink-0 ring-2 ring-brand-lime/40">
                          {post.author.name?.[0]?.toUpperCase() || 'T'}
                        </span>
                      )}
                      <div className="flex flex-col gap-1.5 min-w-0">
                        <span className="font-poppins font-semibold text-sm text-black leading-[1.52]">
                          By {post.author.name}
                        </span>
                        {post.author.role && (
                          <span className="font-poppins text-xs text-[#7e746e] leading-[1.52]">
                            {post.author.role}
                          </span>
                        )}
                      </div>
                    </div>
                    {post.author.bio && (
                      <p className="font-poppins text-sm text-[#575757] leading-[1.65] m-0">
                        {post.author.bio}
                      </p>
                    )}
                    {post.author.credentials && post.author.credentials.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        {post.author.credentials.map((c, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center h-7 justify-center bg-[#F3F4F2] text-[#1a1410] font-semibold font-poppins text-[12px] leading-[1.52] px-3 py-1 rounded-[49px]"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </main>

              {/* RIGHT — sticky rail. Figma node 2576:1008.
                pt-[120px] (Figma's top padding inside the rail) gives
                the sticky child room to clear the sticky nav. gap-10
                (40px) between Share chip and ToC matches the design's
                flex-col gap-[40px]. */}
              <aside className="hidden lg:block">
                <div className="lg:sticky lg:top-24 flex flex-col gap-6 lg:pt-10 lg:pb-6">
                  {/* Share chip — Figma node 2576:1009.
                    bg `background/tertiary` (#e2e3dd), rounded-8.
                    pl-4 (16px) pr-3 (12px) py-3 (12px) per Figma. */}
                  {shareTargets && (
                    <div className="pb-4 flex items-center gap-2 border-b border-[#E0E0E0]">
                      <span className="flex-1 min-w-0 font-poppins text-sm text-[#757575] leading-[1.65]">
                        Share this article
                      </span>
                      <ShareIconButton href={shareTargets.facebook} label="Share on Facebook">
                        <FacebookIcon />
                      </ShareIconButton>
                      <ShareIconButton href={shareTargets.instagram} label="Follow on Instagram">
                        <InstagramIcon />
                      </ShareIconButton>
                      <ShareIconButton href={shareTargets.linkedin} label="Share on LinkedIn">
                        <LinkedInIcon />
                      </ShareIconButton>
                    </div>
                  )}

                  {/* In this article — Figma node 2576:1017.
                    Heading is 20px Regular leading 1.52 (NOT bold),
                    not text-xl + font-semibold like before. */}
                  {toc.length > 0 && (
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
                                /* Each tab — Figma node 2576:1020.
                                   min-h-10 (40px) px-3 (12px) py-2 (8px).
                                   Active tab: bg-white, rounded-8, drop-shadow
                                   0px 1px 1px rgba(0,0,0,0.25), text black.
                                   Inactive tab: no bg, rounded-4, text #424242. */
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
                  )}
                </div>
              </aside>
            </div>
        </div>

      </section>

      {/* ════════════════════════════════════════════════════════════════
          2. FAQ — accordion section.
             Renders only when faqs is non-empty so existing posts that
             don't have FAQ data don't show an empty section.
          ══════════════════════════════════════════════════════════════ */}
      {faqs.length > 0 && (
        <section className="bg-white py-16 md:py-20">
          <div className="max-w-[1000px] mx-auto px-6 md:px-16 lg:px-[120px] flex flex-col gap-10">
            <div className="flex flex-col items-center gap-4">
              <span className="inline-flex items-center justify-center h-8 px-2 rounded bg-[#d4fa00] text-black text-sm font-semibold tracking-[1px] leading-[22px]">
                FAQ
              </span>
              <h2 className="text-[#141414] text-3xl md:text-[32px] font-medium tracking-[-1px] leading-[1.52] text-center">
                {post.faqHeading?.trim() || 'Have any questions?'}
              </h2>
            </div>

            <div className="flex flex-col gap-4">
              {faqs.map((f, i) => {
                const open = openFaq === i;
                return (
                  <div
                    key={f._id || i}
                    className={`rounded-2xl border border-[#eee] transition ${open ? 'bg-[#EEE]' : 'bg-white hover:bg-[#F5F5F5]'
                      }`}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(open ? -1 : i)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-4 p-4 sm:px-6 sm:py-4 text-left"
                    >
                      <span className="text-base leading-[1.52] text-black font-semibold">
                        {f.question}
                      </span>
                      <span className="w-6 h-6 grid place-items-center text-[#141414] shrink-0">
                        {open ? <MinusIcon /> : <PlusIcon />}
                      </span>
                    </button>
                    {open && f.answer && (
                      <div className="p-4 pt-0 sm:px-6 sm:pb-4 -mt-1">
                        {/* FAQ answers are authored as HTML via the
                            admin's RichTextEditor. RichTextView sanitises
                            and styles inline links / lists / bold. */}
                        <RichTextView html={f.answer} className='text-sm text-[#575757] leading-[1.52] [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold' />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════
          3. YOU MAY ALSO LIKE
          ══════════════════════════════════════════════════════════════ */}
      {related.length > 0 && (
        <section className="bg-[#FFF] py-16 md:py-20 !pt-0">
          <div className="container">
            <div className="max-w-[1232px] mx-auto flex flex-col gap-10">
              <h2 className="text-[#141414] text-3xl md:text-[32px] font-medium tracking-[-1px] leading-[1.52]">
                You may also like
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {related.map((p) => (
                  <Link
                    key={p._id}
                    href={buildPostUrlForSite(p, site)}
                    className="group block rounded-2xl overflow-hidden border p-2 border-[#eee] hover:bg-white hover:shadow-[0_4px_8px_-2px_rgba(0,0,0,0.12)] hover:border-[#E0E0E0] transition"
                  >
                    {/* Updated Figma card — 2.34:1 cover image inside
                        the 8px card padding, compact chip/title/date
                        stack (no divider). Mirrors BlogIndexPage. */}
                    <div className="relative aspect-[368/157] bg-default-100 overflow-hidden rounded-xl">
                      {p.featuredImage ? (
                        <Image
                          src={imageUrl(p.featuredImage)}
                          alt={p.title}
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
                    <div className="px-2 pt-3 pb-2 flex flex-col gap-2">
                      {p.category && (
                        <span className="self-start inline-flex items-center bg-[#EAF4FF] h-6 text-[#2563EB] px-3 rounded-full text-[11px] leading-none font-semibold tracking-wider">
                          {p.category.name}
                        </span>
                      )}
                      <h3 className="text-[15px] md:text-base font-semibold text-[#000] line-clamp-2 leading-[1.45]">
                        {p.title}
                      </h3>
                      <div className="leading-[1.52] flex items-center justify-between text-xs text-[#424242]">
                        <span>{fmtDate(p.publishedAt)}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
      {/* Poppins — loaded just for this page so the blog detail matches
          the Figma typography exactly, without forcing Poppins on the
          rest of the storefront. Falls back to Inter (the site default)
          if Google Fonts fails. */}
      <style jsx global>{`
        .blog-detail,
        .blog-detail h1,
        .blog-detail h2,
        .blog-detail h3,
        .blog-detail h4,
        .blog-detail p,
        .blog-detail a,
        .blog-detail span,
        .blog-detail button,
        .blog-detail input,
        .blog-detail textarea {
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
        .article-body .rt-view ol { margin: 0 0 1rem; }
        .article-body .rt-view li { margin: 0.35rem 0; color: #424242; }
        .article-body .rt-view blockquote {
          border-left: 3px solid #BDFF00;
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
          text-decoration-color: #BDFF00;
          text-decoration-thickness: 2px;
          text-underline-offset: 3px;
        }
        .article-body .rt-view a:hover {
          background: #BDFF00;
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────────── helpers ─────────────────────────── */

function Slash() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4 text-[#7e746e]" aria-hidden>
      <path d="M5 13 L11 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function ShareIconButton({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  // Filled black circle with white icon glyph — matches Figma 2466:1047-1049
  // (FB / IG / LinkedIn). 32px instead of Figma's 36px to leave room for
  // "Share this article" on a single line in the narrower live sidebar
  // column. Slight lighten on hover for affordance.
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="w-8 h-8 shrink-0 grid place-items-center rounded-full bg-brand-black text-white hover:bg-[#2a2a2a] transition"
    >
      {children}
    </a>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden>
      <path d="M19 3A2 2 0 0 1 21 5v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14zM8.27 18.27v-7.5H5.77v7.5h2.5zM7.02 9.6a1.45 1.45 0 1 0 0-2.9 1.45 1.45 0 0 0 0 2.9zm11.25 8.67v-4.1c0-2.2-1.18-3.22-2.75-3.22-1.27 0-1.84.7-2.16 1.2v-1.03h-2.4c.03.68 0 7.5 0 7.5h2.4v-4.18c0-.22.02-.43.08-.59.18-.43.57-.88 1.24-.88.87 0 1.22.66 1.22 1.63v4.02h2.37z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden>
      <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.77l-.44 2.89h-2.33v6.99A10 10 0 0 0 22 12z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 1 0-7.07-7.07L11 5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07L13 19" />
    </svg>
  );
}
