/**
 * Build the hierarchical /blog/<chain>/<post-slug> URL for a blog post.
 *
 * `categoryChain` (root → leaf) decorates the URL with the post's full
 * category hierarchy. When the post has no category (or the chain isn't
 * populated yet), falls back to /blog/<post-slug>.
 *
 * The detail page validates that the URL chain matches the post's
 * actual chain — so the same helper MUST be used everywhere we link to
 * posts, otherwise links 404.
 */
import { sellerUrl } from './sellerUrl';
import type { SiteKey } from './site';

export type PostLike = {
  slug: string;
  categoryChain?: { slug: string }[] | null;
};

export function buildPostUrl(post: PostLike | null | undefined): string {
  if (!post?.slug) return '/blog';
  const chain = (post.categoryChain || [])
    .map((c) => c?.slug)
    .filter(Boolean) as string[];
  if (chain.length === 0) return `/blog/${post.slug}`;
  return `/blog/${chain.join('/')}/${post.slug}`;
}

/**
 * Public base path for each property's blog.
 *
 * The seller property's blog lives at `/seller-blogs`, not `/blog`, per
 * product decision — "Blogs" on the seller hub is seller-education
 * content and the URL should say so. The INTERNAL Next route is still
 * `app/seller/blog/**`; `proxy.ts` maps the public path onto it and
 * 301s the old `/blog/**` shape so already-indexed seller posts keep
 * resolving.
 *
 * Keep in sync with:
 *   - proxy.ts → handleSellerHosts() / handleLocalSellerPaths()
 *   - app/seller/sitemap.xml/route.ts
 */
export const BLOG_BASE: Record<SiteKey, string> = {
  main: '/blog',
  seller: '/seller-blogs',
};

/**
 * Does the property nest posts under their category chain?
 *
 * MAIN keeps `/blog/<cat>/<sub>/<slug>` — its taxonomy is deep
 * (helmets, riding gear, rides & travel…) and the chain carries real
 * navigational and SEO weight.
 *
 * SELLER is flat: `/seller-blogs/<slug>`, per product decision. That
 * property has a single "Seller Guide" category, so the segment added
 * length without adding information.
 *
 * The detail route resolves a post by the LAST segment either way, so
 * flat URLs need no route changes — but every canonical, sitemap entry
 * and internal link has to agree, or the two shapes both resolve and
 * compete as duplicates. `proxy.ts` 301s the chained shape to the flat
 * one for anything already indexed.
 */
export const BLOG_NESTS_CATEGORY: Record<SiteKey, boolean> = {
  main: true,
  seller: false,
};

/**
 * Site-aware blog path.
 *
 * `buildPostUrl` above returns the MAIN property's public path —
 * `/blog/...`. Two things have to happen for the seller property:
 *
 * 1. Rebase `/blog` → `/seller-blogs` (see BLOG_BASE).
 * 2. Map through `sellerUrl`, because in local dev the seller property
 *    has no hostname of its own and is served under a `/seller` prefix.
 *    Without this a seller post card linking to `/seller-blogs/<slug>`
 *    would land on the MAIN host — the same class of bug as the earlier
 *    `/seller/c/page/<slug>` routing break, and equally invisible until
 *    someone clicks.
 */
export function blogPathForSite(path: string, site: SiteKey = 'main'): string {
  if (site !== 'seller') return path;
  const rebased = path === '/blog' || path.startsWith('/blog/')
    ? `${BLOG_BASE.seller}${path.slice('/blog'.length)}`
    : path;
  return sellerUrl(rebased);
}

/**
 * Post URL for a given property — the canonical shape.
 *
 * Honours BLOG_NESTS_CATEGORY, so seller posts come out flat
 * (`/seller-blogs/<slug>`) while main keeps its category chain.
 */
export function postPathForSite(
  post: PostLike | null | undefined,
  site: SiteKey = 'main',
): string {
  if (!post?.slug) return BLOG_BASE[site] ?? '/blog';
  const base = BLOG_BASE[site] ?? '/blog';
  if (!BLOG_NESTS_CATEGORY[site]) return `${base}/${post.slug}`;
  const chain = (post.categoryChain || [])
    .map((c) => c?.slug)
    .filter(Boolean) as string[];
  return chain.length > 0
    ? `${base}/${chain.join('/')}/${post.slug}`
    : `${base}/${post.slug}`;
}

/** `postPathForSite` mapped through `sellerUrl` — the common case for
 *  links rendered in the UI. */
export function buildPostUrlForSite(
  post: PostLike | null | undefined,
  site: SiteKey = 'main',
): string {
  const path = postPathForSite(post, site);
  return site === 'seller' ? sellerUrl(path) : path;
}
