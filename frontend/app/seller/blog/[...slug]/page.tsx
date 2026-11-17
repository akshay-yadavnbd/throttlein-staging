import type { Metadata } from 'next';
import {
  buildBlogDetailMetadata,
  BlogDetailContent,
} from '@/components/blog/blogRouteShared';

/**
 * SELLER-property blog post detail.
 *
 * Public URL:   seller.throttlein.com/blog/<chain>/<slug>
 * Internal path: /seller/blog/<chain>/<slug>   (rewritten by proxy.ts)
 *
 * Mirrors `app/blog/[...slug]` exactly — same renderers, same JSON-LD —
 * differing only in the `site` argument, which scopes the API query and
 * makes every canonical/OG URL point at the seller origin.
 */

type RouteProps = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug: segments } = await params;
  return buildBlogDetailMetadata(segments, 'seller');
}

export default async function Page(props: RouteProps) {
  const { slug: segments } = await props.params;
  return (
    <BlogDetailContent segments={segments} site="seller" routeProps={props} />
  );
}
