import type { Metadata } from 'next';
import { BlogIndexContent } from '@/components/blog/blogRouteShared';
import { buildStaticPageMetadata } from '@/lib/staticMeta';

/**
 * MAIN-site blog index — throttlein.com/blog.
 *
 * Delegates to `BlogIndexContent`, the same helper the seller property's
 * index uses (`app/seller/blog/page.tsx`), with `site="main"`.
 *
 * ── WHY THIS IS A THIN WRAPPER NOW ────────────────────────────────
 * This file used to carry its own copies of `fetchFeatured`,
 * `fetchPosts`, `fetchCategories`, `PAGE_SIZE` and the featured-post
 * de-dupe — about 60 lines duplicating `blogRouteShared` line for line.
 * Two consequences:
 *
 *   1. None of those forked fetchers sent `?site=`, relying on the
 *      backend defaulting to 'main'. That worked, but it meant the two
 *      properties reached the same API by different contracts, and only
 *      one of them was explicit about which site it wanted.
 *   2. Any fix to the shared helper silently skipped the main site.
 *
 * The rendered UI was already identical (both forks called the same
 * `BlogIndexPage`); this makes the data path identical too, so "is the
 * seller blog the same as the main blog?" has one answer instead of two.
 */

// Admin can override at /pages → Blog via Edit meta.
export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    route: '/blog',
    defaultTitle: 'Blog · THROTTLEIN',
    defaultDescription:
      'Riding tips, gear reviews, and buying guides for Indian motorcyclists — from helmets and jackets to touring and maintenance.',
  });
}

// Reads ?page=N from the URL so a direct/shared link to a given page
// (which the client pushes via router.push as the shopper paginates)
// renders that page's posts on the server instead of always page 1.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const pageNum = Math.max(1, Number(sp?.page) || 1);

  return <BlogIndexContent site="main" pageNum={pageNum} />;
}
