/**
 * Next.js proxy (formerly `middleware` — renamed per the Next 16
 * convention; runs on the Node.js runtime) — executes BEFORE Next
 * routing on every request that matches the `config.matcher` below.
 *
 * Today's job: consult the admin-managed redirect table (served by
 * the backend at `GET /api/redirects`) and 301 (or 302) when the
 * incoming pathname matches. Everything else falls through to the
 * normal route handler.
 *
 * Caching strategy
 *   The redirect list is fetched ONCE per cold start of the worker,
 *   then kept in a module-level Map for `CACHE_TTL_MS`. A
 *   stale-while-revalidate pattern would be slightly nicer but adds
 *   complexity for marginal benefit — admins rarely add a redirect
 *   and expect it live in <60 seconds.
 *
 * Why not next.config.js redirects()?
 *   Those are baked at build time. Admin-managed redirects need to
 *   take effect without a redeploy, which means the lookup happens
 *   at request time. The proxy is the right place for it.
 */

import { NextRequest, NextResponse } from 'next/server';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
const CACHE_TTL_MS = 60_000;

type RedirectRow = {
  _id: string;
  source: string;
  destination: string;
  statusCode: 301 | 302;
};

type SiteKey = 'main' | 'seller';

/** Redirects are per-property, so the cache is keyed by site — the two
 *  hosts have independent tables and must not share one map. */
const cache = new Map<
  SiteKey,
  { fetchedAt: number; map: Map<string, RedirectRow> }
>();

async function loadRedirects(site: SiteKey): Promise<Map<string, RedirectRow>> {
  const hit = cache.get(site);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.map;
  try {
    const res = await fetch(`${API_URL}/redirects?site=${site}`, {
      // `fetch` calls can be cached by the runtime — turn that off
      // here because we manage our own TTL via the module-level
      // `cache` above. Using `no-store` ensures we get a fresh list
      // on each cold-start miss.
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    // `{ data: { items } }` from the envelope, or the older bare `{ items }`.
    // Inline rather than lib/api's dataOf: the proxy runtime should not pull in axios.
    const data = body && typeof body === 'object' && 'data' in body && !('items' in body) ? body.data : body;
    const map = new Map<string, RedirectRow>();
    for (const r of (data?.items as RedirectRow[]) || []) {
      // Source is already normalised to start with `/` in the model,
      // but be defensive in case an old record sneaks through.
      const key = r.source.startsWith('/') ? r.source : `/${r.source}`;
      map.set(key, r);
    }
    cache.set(site, { fetchedAt: Date.now(), map });
    return map;
  } catch {
    // Don't break the site if the API is briefly unreachable — return
    // whatever stale cache we have, or an empty map.
    return hit?.map || new Map();
  }
}

/**
 * Which property is this request for?
 *
 * MUST behave identically to `siteFromHost` in lib/site.ts — that
 * function decides the `X-Site` header the browser bundle sends, and
 * this one decides what the server rendered. A disagreement between
 * them is a hydration content mismatch, not merely a cosmetic one, so
 * the two rules below are deliberate rather than defensive:
 *
 *   - strip the port, so `seller.throttlein.com:3000` in a Host header
 *     still resolves to the seller property
 *   - fall back to the `seller.` prefix when NEXT_PUBLIC_SELLER_URL is
 *     unset, matching the client's fallback
 *
 * Kept inlined (rather than imported) because the proxy runs on every
 * request and stays import-light on purpose.
 */
function siteForRequest(request: NextRequest): SiteKey {
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];
  if (!host) return 'main';
  const sellerHost = SELLER_URL.replace(/^https?:\/\//, '')
    .split('/')[0]
    .toLowerCase()
    .split(':')[0];
  if (sellerHost && host === sellerHost) return 'seller';
  if (host.startsWith('seller.')) return 'seller';
  return 'main';
}

// Fire-and-forget hit counter. Awaiting it would tie up the
// response by ~50ms; we don't care about the result.
//
// `site` is REQUIRED even though this is a fire-and-forget call: the
// backend scopes the increment by site, and this request carries no
// Origin, Referer or auth header for it to infer one from. Omit it and
// every seller redirect's hitCount silently stays at zero — silently
// because the endpoint always answers 204. Admins use hitCount to
// decide which redirects are dead and can be pruned.
function recordHit(redirectId: string, site: SiteKey) {
  fetch(`${API_URL}/redirects/${redirectId}/hit?site=${site}`, {
    method: 'POST',
    cache: 'no-store',
  }).catch(() => {});
}

/* ─── Seller subdomain routing ────────────────────────────────────
   The SAME Next app serves both hosts. `seller.<domain>` maps its
   clean URLs onto the app's /seller and /dashboard routes; the main
   domain 301s all seller paths over to the subdomain so existing
   links keep working. Controlled by NEXT_PUBLIC_SELLER_URL — when
   unset (local dev), everything behaves exactly as before. */
const SELLER_URL = (process.env.NEXT_PUBLIC_SELLER_URL || '').replace(/\/$/, '');

/**
 * Real route files under `app/seller/**`. Anything else after `/seller/` is a
 * candidate CMS page. Kept as one regex used by BOTH the seller-host branch and
 * the local-dev branch, so the two can't drift into disagreeing about what is a
 * route and what is content.
 */
const SELLER_REAL_ROUTES =
  /^\/(login|register|verify|guide|blog|sell-online|c|robots\.txt|sitemap\.xml|llms\.txt)(\/|$)/;

/**
 * `/sell-online/<slug>` — a seller-category CMS page nested under the Sell
 * Online page. Must be tested BEFORE SELLER_REAL_ROUTES: `sell-online` is
 * itself a real route, so the generic rule would pass this through to
 * app/seller/sell-online/page.tsx, which takes no child segment and 404s.
 * `/sell-online` with no child still belongs to the real route.
 */
const SELLER_CATEGORY_PATH = /^\/sell-online\/[^/]+$/;

/**
 * Local-dev clean URLs for seller CMS pages.
 *
 * On the real seller host, `seller.throttlein.com/<slug>` already reaches the
 * CMS catch-all via the rewrite in handleSellerHosts. Locally there is no
 * seller host, so the same page had to be linked as `/seller/c/page/<slug>` —
 * an internal path leaking into public URLs, and different from production.
 *
 * This makes dev mirror production: `/seller/<slug>` serves the same content
 * that `seller.throttlein.com/<slug>` will, by rewriting into the same internal
 * `/seller/c/**` namespace. The internal path is deliberately unchanged so the
 * backend's `pageToRoute()` + revalidatePath keep targeting the same string.
 */
function handleLocalSellerPaths(request: NextRequest): NextResponse | null {
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];
  if (!/localhost|127\.0\.0\.1/.test(host)) return null;

  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/seller/')) return null;

  const rest = pathname.slice('/seller'.length); // keeps the leading slash

  // Blog rename, dev equivalent of the production rule in
  // handleSellerHosts(): the public path is /seller-blogs but the route
  // files still live at app/seller/blog/**. Without this the dev URL
  // /seller/seller-blogs would fall through to the CMS catch-all and
  // 404, so links built by blogPathForSite() would be dead locally
  // while working in production — exactly the kind of dev/prod split
  // this helper exists to prevent.
  if (rest === '/seller-blogs' || rest.startsWith('/seller-blogs/')) {
    const tail = rest.slice('/seller-blogs'.length);
    const segs = tail.split('/').filter(Boolean);
    // Same flattening as production (see handleSellerHosts) so a
    // chained dev URL doesn't render a second copy of the post.
    if (segs.length > 1 && segs[0] !== 'category') {
      const url = request.nextUrl.clone();
      url.pathname = `/seller/seller-blogs/${segs[segs.length - 1]}`;
      return NextResponse.redirect(url, 301);
    }
    const url = request.nextUrl.clone();
    url.pathname = `/seller/blog${tail}`;
    return NextResponse.rewrite(url);
  }

  // Nested category pages first — see the note on SELLER_CATEGORY_PATH.
  if (!SELLER_CATEGORY_PATH.test(rest) && SELLER_REAL_ROUTES.test(rest)) return null;

  const url = request.nextUrl.clone();
  url.pathname = `/seller/c${rest}`;
  return NextResponse.rewrite(url);
}

function handleSellerHosts(request: NextRequest): NextResponse | null {
  if (!SELLER_URL) return null;
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];
  const { pathname, search } = request.nextUrl;

  // Host matching goes through the SAME helper the redirect-table
  // lookup uses. They were separate once, with subtly different rules,
  // and that let the two disagree: with a port in the Host header
  // (common behind some load balancers) one would classify the request
  // as the seller property and the other as main — so the proxy served
  // one property's redirects over the other property's routing.
  if (siteForRequest(request) === 'seller') {
    // ── We're ON the seller subdomain ──
    // /             → seller landing page
    // /login etc.   → /seller/login etc. (clean URLs, no /seller prefix)
    // /dashboard/*  → passes through unchanged
    // /seller/*     → normalise to the clean URL (no double-prefix)
    // /blog, /blog/* → the seller property's own blog
    // anything else → seller CMS page, or a bounce to main if none
    if (pathname === '/') {
      const url = request.nextUrl.clone();
      url.pathname = '/seller';
      return NextResponse.rewrite(url);
    }
    // Hard-coded seller-property routes. These map 1:1 onto real route
    // files under app/seller/**, so they must be matched BEFORE the CMS
    // catch-all at the bottom — otherwise /sell-online would be looked
    // up as an admin-authored page, miss, and 404.
    // Nested category pages BEFORE the real-route rule — `sell-online` is a
    // real route, so /sell-online/<slug> would otherwise be handed to a page
    // that takes no child segment. See SELLER_CATEGORY_PATH.
    if (SELLER_CATEGORY_PATH.test(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = `/seller/c${pathname}`;
      return NextResponse.rewrite(url);
    }
    if (/^\/(login|register|verify|guide|sell-online)(\/|$)/.test(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = `/seller${pathname}`;
      return NextResponse.rewrite(url);
    }
    // `/seller/c/...` is the INTERNAL content namespace, never a public
    // URL. If someone types it directly, strip the whole prefix rather
    // than only `/seller` — otherwise the generic rule below would send
    // them to `/c/about`, which just bounces around.
    if (pathname === '/seller/c' || pathname.startsWith('/seller/c/')) {
      const clean = pathname.slice('/seller/c'.length) || '/';
      return NextResponse.redirect(`${SELLER_URL}${clean}${search}`, 301);
    }
    if (pathname === '/seller' || pathname.startsWith('/seller/')) {
      const clean = pathname === '/seller' ? '/' : pathname.slice('/seller'.length);
      return NextResponse.redirect(`${SELLER_URL}${clean}${search}`, 301);
    }
    if (pathname.startsWith('/dashboard')) {
      return NextResponse.next();
    }

    // Legacy `/page/<slug>` shape → the clean `/​<slug>` URL. Prose pages used
    // to be linked as /page/<slug>; both shapes resolve, so without a 301 the
    // same content would sit on two URLs and compete as duplicates.
    if (/^\/page\/[^/]+$/.test(pathname)) {
      const clean = pathname.slice('/page'.length);
      return NextResponse.redirect(`${SELLER_URL}${clean}${search}`, 301);
    }

    // ── Seller-property blog ─────────────────────────────────────────
    // Public path is /seller-blogs (see lib/blogUrl.ts BLOG_BASE); the
    // internal route is still app/seller/blog/**. Matched BEFORE the CMS
    // catch-all so blog URLs never get looked up as admin-authored
    // pages.
    if (pathname === '/seller-blogs' || pathname.startsWith('/seller-blogs/')) {
      /**
       * Seller post URLs are FLAT — /seller-blogs/<slug> — so collapse
       * any category segments a legacy link still carries. The detail
       * route resolves by the last segment either way, so without this
       * both /seller-blogs/seller-guide/<slug> and /seller-blogs/<slug>
       * would render the same post at two URLs and compete as
       * duplicates. `/category/<slug>` is the archive listing, not a
       * post, so it's left alone.
       */
      const rest = pathname.slice('/seller-blogs'.length); // '' | '/a' | '/a/b/c'
      const segs = rest.split('/').filter(Boolean);
      if (segs.length > 1 && segs[0] !== 'category') {
        const flat = `/seller-blogs/${segs[segs.length - 1]}`;
        return NextResponse.redirect(`${SELLER_URL}${flat}${search}`, 301);
      }
      const url = request.nextUrl.clone();
      url.pathname = `/seller/blog${rest}`;
      return NextResponse.rewrite(url);
    }
    // Legacy shape — the seller blog lived at /blog until the rename,
    // and those URLs are in the published sitemap. 301 rather than
    // rewrite so the canonical URL is unambiguous and the ranking
    // follows the redirect.
    if (pathname === '/blog' || pathname.startsWith('/blog/')) {
      // Rebase AND flatten in one hop — the indexed URLs are
      // /blog/seller-guide/<slug>, whose flat equivalent is
      // /seller-blogs/<slug>. Chaining two 301s instead would leak
      // link equity for no reason.
      const rest = pathname.slice('/blog'.length);
      const segs = rest.split('/').filter(Boolean);
      const moved =
        segs.length > 1 && segs[0] !== 'category'
          ? `/seller-blogs/${segs[segs.length - 1]}`
          : `/seller-blogs${rest}`;
      return NextResponse.redirect(`${SELLER_URL}${moved}${search}`, 301);
    }

    // Per-host SEO files. Each has a seller-specific generator under
    // app/seller/<file>/route.ts; without this rewrite they'd fall into
    // the CMS catch-all below and be looked up as admin-authored pages.
    //
    // llms.txt is here for the same reason as the other two, and matters
    // more than it looks: `config.matcher` does not exclude `.txt`, so a
    // static public/llms.txt would never be reached on this host anyway.
    if (
      pathname === '/sitemap.xml' ||
      pathname === '/robots.txt' ||
      pathname === '/llms.txt'
    ) {
      const url = request.nextUrl.clone();
      url.pathname = `/seller${pathname}`;
      return NextResponse.rewrite(url);
    }

    // Everything else is a candidate CMS page. We CANNOT know here
    // whether a matching Page exists — that needs a database lookup,
    // and doing one in the proxy would put a network round-trip on
    // every request. So we rewrite optimistically into the seller
    // content namespace and let the catch-all route decide: it either
    // renders the page or permanently redirects to the main origin,
    // which preserves the behaviour this branch used to have.
    //
    // The path is preserved verbatim under the prefix, which is what
    // keeps it aligned with `pageToRoute()` on the backend so ISR
    // revalidation targets the same string.
    const url = request.nextUrl.clone();
    url.pathname = `/seller/c${pathname}`;
    return NextResponse.rewrite(url);
  }

  // ── We're on the MAIN domain (but not in local dev) ──
  // Send every seller-related path to the subdomain. Skip when the
  // request host is localhost so `npm run dev` keeps working with
  // /seller and /dashboard paths directly.
  if (!/localhost|127\.0\.0\.1/.test(host)) {
    // Internal seller-content namespace leaked onto the main host —
    // strip the full prefix, same reasoning as on the seller branch.
    if (pathname === '/seller/c' || pathname.startsWith('/seller/c/')) {
      const clean = pathname.slice('/seller/c'.length) || '/';
      return NextResponse.redirect(`${SELLER_URL}${clean}${search}`, 301);
    }
    if (pathname === '/seller' || pathname.startsWith('/seller/')) {
      const clean = pathname === '/seller' ? '/' : pathname.slice('/seller'.length);
      return NextResponse.redirect(`${SELLER_URL}${clean}${search}`, 301);
    }
    if (pathname.startsWith('/dashboard')) {
      return NextResponse.redirect(`${SELLER_URL}${pathname}${search}`, 301);
    }
    if (pathname === '/login' || pathname === '/register') {
      return NextResponse.redirect(`${SELLER_URL}${pathname}${search}`, 301);
    }
  }
  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const site = siteForRequest(request);

  // The admin redirect table is consulted FIRST, and against the site
  // this request belongs to.
  //
  // Ordering note: this used to run AFTER the seller-host routing. It
  // had to move, because that routing now ends in a catch-all rewrite
  // that matches every path — so a redirect configured for the seller
  // property would never have been reached. An admin-configured 301
  // should win over the implicit content lookup either way.
  const map = await loadRedirects(site);
  const match = map.get(pathname);
  if (!match) {
    // No redirect — fall through to host-based seller-subdomain routing,
    // then to the local-dev equivalent (which is a no-op off localhost).
    const sellerRouted = handleSellerHosts(request);
    if (sellerRouted) return sellerRouted;
    const devRouted = handleLocalSellerPaths(request);
    if (devRouted) return devRouted;
    return NextResponse.next();
  }

  // Build the destination URL. If `destination` is an absolute URL
  // (starts with http(s)://) use it verbatim; otherwise treat it as
  // a path relative to the current origin.
  const dest = /^https?:\/\//i.test(match.destination)
    ? new URL(match.destination)
    : new URL(match.destination, request.url);

  recordHit(match._id, site);
  return NextResponse.redirect(dest, match.statusCode || 301);
}

export const config = {
  // Skip the proxy for Next.js internals, API calls, and the
  // most common static asset extensions. Keeps the redirect-table
  // lookup off the hot path for images/fonts/_next/static/etc.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|api/|images/|.+\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf)$).*)',
  ],
};
