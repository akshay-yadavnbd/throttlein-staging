import type { Metadata } from 'next';
import BlogIndexPage from '@/components/pages/BlogIndexPage';
import BlogDetailPage from '@/components/pages/BlogDetailPage';
import JsonLd from '@/components/seo/JsonLd';
import { absoluteImageUrl, DEFAULT_OG_IMAGE } from '@/lib/jsonLd';
import { API_URL, dataOf } from '@/lib/api';
import { originForSite, type SiteKey } from '@/lib/site';
import { postPathForSite, BLOG_BASE, BLOG_NESTS_CATEGORY } from '@/lib/blogUrl';

/**
 * Shared blog route implementation, parameterised by site.
 *
 * Both properties run the same blog — same renderers, same SEO shape —
 * against different content:
 *
 *   throttlein.com/blog/...         → app/blog/**          (site='main')
 *   seller.throttlein.com/blog/...  → app/seller/blog/**   (site='seller')
 *
 * The route files themselves are thin wrappers around the functions
 * here. Keeping ONE implementation matters because the JSON-LD and
 * OpenGraph blocks below are the fiddliest, most easily-broken part of
 * the storefront; two copies would drift within a release or two.
 *
 * Every URL is built from `originForSite(site)` rather than the
 * build-time SITE_URL constant. Getting that wrong is the failure mode
 * that quietly de-indexes the seller blog: pages would canonicalise to
 * throttlein.com URLs that return 404.
 */

/**
 * Posts per page. MUST stay a multiple of 6 — the grid is 1 / 2 / 3
 * columns (sm / lg), so only a multiple of 6 fills complete rows at
 * every breakpoint. At 10 the desktop grid rendered three rows of three
 * plus a single orphaned card, which read as a missing card.
 *
 * Keep in sync with PAGE_SIZE in components/pages/BlogIndexPage.tsx —
 * SSR renders the first page and the client refetches on navigation, so
 * a mismatch would change the page size mid-session.
 */
const PAGE_SIZE = 12;

/** Site-scoped API fetch. Server components always pass ?site=
 *  explicitly — they know statically which property they belong to. */
function apiUrl(path: string, site: SiteKey, extra?: Record<string, string | number>) {
  const qs = new URLSearchParams({ site });
  for (const [k, v] of Object.entries(extra || {})) qs.set(k, String(v));
  return `${API_URL}${path}?${qs.toString()}`;
}

/* ── fetchers ─────────────────────────────────────────────────────── */

export async function fetchFeatured(site: SiteKey) {
  try {
    const r = await fetch(apiUrl('/blog/featured', site), { next: { revalidate: 60 } });
    if (!r.ok) return null;
    const d = dataOf(await r.json());
    return d?.post || null;
  } catch { return null; }
}

export async function fetchPosts(
  site: SiteKey,
  params: Record<string, string | number>,
) {
  try {
    const r = await fetch(apiUrl('/blog', site, params), { next: { revalidate: 60 } });
    if (!r.ok) return { items: [], total: 0 };
    const d = dataOf(await r.json());
    return {
      items: Array.isArray(d?.items) ? d.items : [],
      total: typeof d?.total === 'number' ? d.total : (d?.items?.length || 0),
    };
  } catch { return { items: [], total: 0 }; }
}

export async function fetchCategories(site: SiteKey) {
  try {
    const r = await fetch(apiUrl('/blog/categories', site), { next: { revalidate: 60 } });
    if (!r.ok) return [];
    const d = dataOf(await r.json());
    return Array.isArray(d?.items) ? d.items : [];
  } catch { return []; }
}

export async function fetchPost(slug: string, site: SiteKey): Promise<any | null> {
  try {
    const r = await fetch(
      apiUrl(`/blog/${encodeURIComponent(slug)}`, site),
      { next: { revalidate: 60 } },
    );
    if (!r.ok) return null;
    const d = dataOf(await r.json());
    return d?.post || null;
  } catch { return null; }
}

/* ── index ────────────────────────────────────────────────────────── */

export async function BlogIndexContent({
  site,
  pageNum,
  categorySlug,
}: {
  site: SiteKey;
  pageNum: number;
  categorySlug?: string;
}) {
  // A category archive has no featured hero — it would show a post
  // from outside the category being browsed.
  const featured = categorySlug ? null : await fetchFeatured(site);

  const listParams: Record<string, string | number> = { page: pageNum, limit: PAGE_SIZE };
  if (categorySlug) listParams.category = categorySlug;
  /* Exclude the hero post from the grid QUERY rather than filtering the
   * results afterwards. The old order (fetch, then drop) removed one
   * card from whichever page the featured post fell on, so page 1
   * rendered PAGE_SIZE−1 cards and every other page rendered PAGE_SIZE
   * — in a 3-column grid that read as a missing card on pages 2+.
   * Excluding server-side also keeps `total` and the page count right. */
  if (featured?._id) listParams.exclude = featured._id;

  const [postsResult, categories] = await Promise.all([
    fetchPosts(site, listParams),
    fetchCategories(site),
  ]);

  // Server already excluded it; belt-and-braces for an older API.
  const posts = featured?._id
    ? postsResult.items.filter((p: any) => p?._id !== featured._id)
    : postsResult.items;

  const activeCategory = categorySlug
    ? categories.find((c: any) => c?.slug === categorySlug) || null
    : null;

  return (
    <BlogIndexPage
      categorySlug={categorySlug}
      initialFeatured={featured}
      initialPosts={posts}
      initialTotal={postsResult.total}
      initialCategories={categories}
      initialActiveCategory={activeCategory}
      initialPage={pageNum}
      // Layout is identical across sites; `site` only steers link
      // construction so cards and crumbs stay on this property.
      site={site}
    />
  );
}

/* ── detail ───────────────────────────────────────────────────────── */

function plainText(html?: string): string {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Canonical path for a post on a given property.
 *
 *  Delegates to the shared helper so the canonical, the sitemap and
 *  every rendered link derive from ONE rule — main nests under the
 *  category chain, seller is flat at /seller-blogs/<slug>. When this
 *  was computed locally it silently disagreed with lib/blogUrl.ts and
 *  the canonical pointed at a URL the site never linked to. */
function postPath(post: any, site: SiteKey): string {
  return postPathForSite(post, site);
}

export async function buildBlogDetailMetadata(
  segments: string[],
  site: SiteKey,
): Promise<Metadata> {
  const origin = originForSite(site);
  const siteName = site === 'seller' ? 'THROTTLEIN Sellers' : 'THROTTLEIN';
  const postSlug = segments[segments.length - 1];
  const post = await fetchPost(postSlug, site);
  if (!post) return {};

  const title = post.metaTitle?.trim() || post.title || `${siteName} — Blog`;
  const description = post.metaDescription?.trim() || post.excerpt?.trim() || undefined;
  // OG image: admin `ogImage` override > featured image > site default.
  const ogImage =
    absoluteImageUrl(post.ogImage) ||
    absoluteImageUrl(post.featuredImage) ||
    DEFAULT_OG_IMAGE;
  const canonical = `${origin}${postPath(post, site)}`;

  // Tags + categories feed both OG (article:section / article:tag) and
  // the Article JSON-LD below (articleSection, keywords).
  const tagNames: string[] = Array.isArray(post.tags)
    ? post.tags.map((t: { name?: string }) => t?.name).filter(Boolean)
    : [];
  const sectionName =
    (Array.isArray(post.categoryChain) && post.categoryChain.length > 0
      ? post.categoryChain[post.categoryChain.length - 1]?.name
      : null) ||
    post.category?.name ||
    undefined;
  const keywordsList = [...(sectionName ? [sectionName] : []), ...tagNames];

  return {
    title,
    description,
    // `keywords` is loosely weighted by Google but still useful for
    // Bing, DuckDuckGo, and search-snippet hint extraction.
    keywords: keywordsList.length ? keywordsList : undefined,
    // `authors` at the metadata root surfaces `<meta name="author">`,
    // which several scrapers consume independently of OG.
    authors: post.author?.name ? [{ name: post.author.name }] : undefined,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title,
      description,
      url: canonical,
      siteName,
      locale: 'en_IN',
      images: [{ url: ogImage }],
      publishedTime: post.publishedAt || undefined,
      // Real edit date, else the publish date — see the dateModified
      // note below; `updatedAt` is polluted by the view counter.
      modifiedTime: post.contentUpdatedAt || post.publishedAt || undefined,
      authors: post.author?.name ? [post.author.name] : undefined,
      section: sectionName,
      tags: tagNames.length ? tagNames : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}

export async function BlogDetailContent({
  segments,
  site,
  routeProps,
}: {
  segments: string[];
  site: SiteKey;
  /** The original route props, forwarded to the client component which
   *  reads `params` to re-resolve the slug after hydration. */
  routeProps: any;
}) {
  const origin = originForSite(site);
  const postSlug = segments[segments.length - 1];
  // Deduped by Next's request-level fetch cache — same call
  // generateMetadata already made.
  const post = await fetchPost(postSlug, site);

  // Build Article + BreadcrumbList JSON-LD. Article is the strongest
  // E-E-A-T signal Google supports for blog posts.
  let articleJsonLd: Record<string, unknown> | null = null;
  let breadcrumbJsonLd: Record<string, unknown> | null = null;
  if (post) {
    const canonical = `${origin}${postPath(post, site)}`;
    // Same fallback chain as the metadata above — keeps OG + JSON-LD in sync.
    const ogImage =
      absoluteImageUrl(post.ogImage) ||
      absoluteImageUrl(post.featuredImage) ||
      DEFAULT_OG_IMAGE;

    const plainBody = plainText(post.body);
    const wordCount = plainBody ? plainBody.split(' ').filter(Boolean).length : 0;

    const tagNames: string[] = Array.isArray(post.tags)
      ? post.tags.map((t: { name?: string }) => t?.name).filter(Boolean)
      : [];
    const sectionName =
      (Array.isArray(post.categoryChain) && post.categoryChain.length > 0
        ? post.categoryChain[post.categoryChain.length - 1]?.name
        : null) ||
      post.category?.name ||
      undefined;

    articleJsonLd = {
      '@context': 'https://schema.org',
      // `BlogPosting` is a more specific subtype of Article; Google
      // treats it identically for rich-result eligibility while giving
      // a clearer semantic hint that this is editorial content.
      '@type': 'BlogPosting',
      headline: post.title,
      ...(post.excerpt ? { description: post.excerpt } : {}),
      image: [ogImage],
      ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
      /* dateModified must be a real EDIT date. `updatedAt` moves on any
       * document write — the view counter included — so an unedited post
       * claimed to be modified every time someone read it. Google treats
       * a dateModified that never matches actual content change as a
       * freshness signal to discount. Falls back to the publish date,
       * which for an unedited post is the truthful answer. */
      ...(post.contentUpdatedAt || post.publishedAt
        ? { dateModified: post.contentUpdatedAt || post.publishedAt }
        : {}),
      ...(sectionName ? { articleSection: sectionName } : {}),
      ...(tagNames.length ? { keywords: tagNames.join(', ') } : {}),
      ...(wordCount ? { wordCount } : {}),
      inLanguage: 'en-IN',
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      author: post.author?.name
        ? {
            '@type': 'Person',
            name: post.author.name,
            ...(post.author.bio ? { description: post.author.bio } : {}),
            ...(post.author.role ? { jobTitle: post.author.role } : {}),
          }
        : undefined,
      // Reference the Organization emitted by the root layout by @id so
      // Google merges the nodes instead of seeing two publishers.
      publisher: { '@id': `${origin}/#organization` },
    };

    // Breadcrumb mirrors the URL hierarchy: Home › Blog › <cat> › … › Post.
    const items: Array<{ '@type': string; position: number; name: string; item: string }> = [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
      // Matches the visible breadcrumb label in BlogIndexPage — a
      // JSON-LD crumb that disagrees with the on-page one is a
      // structured-data mismatch Google flags.
      {
        '@type': 'ListItem',
        position: 2,
        name: site === 'seller' ? 'Seller Blog' : 'Blogs',
        item: `${origin}${BLOG_BASE[site]}`,
      },
    ];
    // Category rungs only exist on properties whose URLs nest them —
    // emitting them for the flat seller blog would describe a hierarchy
    // the URLs don't have, and point at paths that 301 away.
    if (BLOG_NESTS_CATEGORY[site]) {
      let runningPath = `${origin}${BLOG_BASE[site]}`;
      for (const cat of post.categoryChain || []) {
        if (!cat?.slug || !cat?.name) continue;
        runningPath += `/${cat.slug}`;
        items.push({
          '@type': 'ListItem',
          position: items.length + 1,
          name: cat.name,
          item: runningPath,
        });
      }
    }
    items.push({
      '@type': 'ListItem',
      position: items.length + 1,
      name: post.title,
      item: canonical,
    });
    breadcrumbJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items,
    };
  }

  // FAQPage JSON-LD — emitted only when the post has at least one
  // non-empty Q&A row. Google can render an expandable FAQ block in the
  // SERP entry, which lifts CTR noticeably on long-tail queries.
  let faqJsonLd: Record<string, unknown> | null = null;
  if (post && Array.isArray(post.faqs) && post.faqs.length > 0) {
    const mainEntity = post.faqs
      .filter((f: { question?: string }) => f?.question?.trim())
      .map((f: { question: string; answer?: string }) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: {
          '@type': 'Answer',
          // Plain text — Google's parser accepts HTML but rich-result
          // eligibility is more reliable without it.
          text: plainText(f.answer),
        },
      }));
    if (mainEntity.length > 0) {
      faqJsonLd = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity,
      };
    }
  }

  return (
    <>
      {articleJsonLd && <JsonLd data={articleJsonLd} />}
      {breadcrumbJsonLd && <JsonLd data={breadcrumbJsonLd} />}
      {faqJsonLd && <JsonLd data={faqJsonLd} />}
      {/* Pass the SSR-fetched `post` down so the H1, body, author chip
          and other content are in the initial HTML rather than waiting
          on a client useEffect. `post` may be null if the API call
          failed; the client retries on hydration. */}
      {/* `site` steers the share-link origin and the internal blog links.
          Without it a seller post's share buttons published a
          throttlein.com URL that 404s. */}
      <BlogDetailPage {...routeProps} initialPost={post} site={site} />
    </>
  );
}
