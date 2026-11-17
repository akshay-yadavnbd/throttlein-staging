import { API_URL, dataOf } from '@/lib/api';
import { originForSite } from '@/lib/site';
import { sellerDynamicPagePath } from '@/lib/sellerPageRoutes';

/**
 * Sitemap for the SELLER property.
 *
 * Served at `seller.throttlein.com/sitemap.xml` via the rewrite in
 * proxy.ts. Written as a route handler rather than a `sitemap.ts`
 * because Next's convention-based sitemap is per-path, not per-host,
 * and one app serves both properties.
 *
 * Only seller-scoped content appears here — the main site has its own
 * at `app/sitemap.ts`. Keeping them disjoint is what stops Google
 * seeing each post under two hostnames.
 */

export const revalidate = 3600;

const ORIGIN = originForSite('seller');

type Entry = { loc: string; lastmod?: string; changefreq?: string; priority?: string };

async function safeFetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return dataOf(await res.json());
  } catch {
    return null;
  }
}

function iso(value?: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Post URL from its populated category chain — mirrors lib/blogUrl.ts.
 *  Base is /seller-blogs on this property (BLOG_BASE.seller); the old
 *  /blog shape 301s there via proxy.ts. */
function postPath(post: any): string | null {
  if (!post?.slug) return null;
  // FLAT on this property — the category chain is deliberately not in
  // the URL (BLOG_NESTS_CATEGORY.seller === false). Emitting the
  // chained shape here would list URLs that 301 to the flat one, which
  // Search Console reports as soft errors.
  return `/seller-blogs/${post.slug}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toXml(entries: Entry[]): string {
  const urls = entries
    .map((e) => {
      const parts = [`    <loc>${xmlEscape(e.loc)}</loc>`];
      if (e.lastmod) parts.push(`    <lastmod>${e.lastmod}</lastmod>`);
      if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
      if (e.priority) parts.push(`    <priority>${e.priority}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

export async function GET() {
  const now = new Date().toISOString();
  const entries: Entry[] = [
    { loc: `${ORIGIN}/`, lastmod: now, changefreq: 'weekly', priority: '1.0' },
    // The long-form onboarding guide — the property's main SEO surface
    // after the landing page.
    { loc: `${ORIGIN}/sell-online`, lastmod: now, changefreq: 'monthly', priority: '0.9' },
    { loc: `${ORIGIN}/seller-blogs`, lastmod: now, changefreq: 'daily', priority: '0.8' },
    // NOT listed: /register.
    //
    // robots.txt disallows it (see app/seller/robots.txt/route.ts, the
    // "Authentication & checkout" block). Submitting a URL in the sitemap
    // that robots.txt blocks is a contradiction Search Console reports as
    // "Submitted URL blocked by robots.txt" — the sitemap is a request to
    // crawl, so the two files have to agree.
    //
    // If /register should rank later (it is, after all, the property's
    // conversion page), remove the Disallow FIRST, then re-add it here.
  ];

  // ─── Blog posts ─────────────────────────────────────────────────
  const blogData = await safeFetchJson(`${API_URL}/blog?limit=500&site=seller`);
  for (const post of blogData?.items || []) {
    const path = postPath(post);
    if (!path) continue;
    entries.push({
      /* `contentUpdatedAt` before `publishedAt`, and `updatedAt` only as
       * a last resort: `updatedAt` moves on ANY write to the post —
       * including the storefront's view counter — so it reported every
       * post as modified today on every request. See the note on
       * BlogPost.contentUpdatedAt. */
      loc: `${ORIGIN}${path}`,
      lastmod:
        iso(post.contentUpdatedAt) ||
        iso(post.publishedAt) ||
        iso(post.updatedAt) ||
        now,
      changefreq: 'monthly',
      priority: '0.6',
    });
  }

  // ─── Seller guides ──────────────────────────────────────────────
  // The seller property's main content type after the landing page.
  // `SellerGuide` is not site-scoped (there's one set of guides and it
  // belongs to this property), so no `site` param here — unlike the
  // fetches above and below.
  const guideData = await safeFetchJson(`${API_URL}/seller-guides?active=1`);
  for (const g of guideData?.items || []) {
    if (!g?.slug) continue;
    entries.push({
      loc: `${ORIGIN}/guide/${g.slug}`,
      lastmod: iso(g.updatedAt || g.publishedAt) || now,
      changefreq: 'monthly',
      priority: '0.6',
    });
  }

  // ─── Blog categories ────────────────────────────────────────────
  const catData = await safeFetchJson(`${API_URL}/blog/categories?site=seller`);
  for (const cat of catData?.items || []) {
    if (!cat?.slug) continue;
    entries.push({
      loc: `${ORIGIN}/seller-blogs/category/${cat.slug}`,
      // Real category date when the API exposes one, not request time.
      lastmod: iso(cat.updatedAt) || now,
      changefreq: 'weekly',
      priority: '0.5',
    });
  }

  // ─── CMS pages ──────────────────────────────────────────────────
  // The canonical shape is the bare slug at the property root. The older
  // /page/<slug> form now 301s here (see proxy.ts), so only this one is
  // listed — advertising both would compete as duplicates.
  const proseData = await safeFetchJson(`${API_URL}/pages?type=prose&site=seller`);
  for (const p of proseData?.items || []) {
    if (!p?.slug) continue;
    entries.push({
      loc: `${ORIGIN}/${p.slug}`,
      lastmod: iso(p.updatedAt) || now,
      changefreq: 'monthly',
      priority: '0.5',
    });
  }

  // Dynamic pages sit at the property root EXCEPT the seller-category
  // templates, which are nested under Sell Online at `/sell-online/<slug>`.
  // Emitting those as a bare root slug advertises a URL that 404s — the
  // proxy only rewrites `/sell-online/<slug>` into the CMS namespace, never
  // the bare form. `sellerDynamicPagePath` is the single definition that
  // mirrors `pageToRoute()` on the backend; testing the template inline here
  // is what let template 2 slip through as a root slug.
  const dynData = await safeFetchJson(`${API_URL}/pages?type=dynamic&site=seller`);
  for (const p of dynData?.items || []) {
    const path = sellerDynamicPagePath(p);
    if (!path) continue;
    entries.push({
      loc: `${ORIGIN}${path}`,
      lastmod: iso(p.updatedAt) || now,
      changefreq: 'weekly',
      priority: '0.6',
    });
  }

  return new Response(toXml(entries), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  });
}
