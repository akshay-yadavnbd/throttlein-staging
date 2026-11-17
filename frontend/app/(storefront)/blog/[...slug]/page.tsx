import type { Metadata } from 'next';
import {
  buildBlogDetailMetadata,
  BlogDetailContent,
} from '@/components/blog/blogRouteShared';

/**
 * Catch-all route for MAIN-SITE blog posts (throttlein.com/blog/...).
 *
 * The trailing segment is the post slug; preceding segments (if any)
 * are the category chain from root → leaf. E.g.
 *   /blog/touring/india/helmet-guide
 *   → params.slug = ['touring','india','helmet-guide'], post = 'helmet-guide'
 *
 * The implementation — fetching, OpenGraph, and the Article /
 * BreadcrumbList / FAQPage JSON-LD — lives in `blogRouteShared` and is
 * shared with the seller property's mirror of this route at
 * `app/seller/blog/[...slug]`. Only the `site` argument differs.
 */

type RouteProps = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug: segments } = await params;
  return buildBlogDetailMetadata(segments, 'main');
}

export default async function Page(props: RouteProps) {
  const { slug: segments } = await props.params;
  return (
    <BlogDetailContent segments={segments} site="main" routeProps={props} />
  );
}
