import { API_URL, dataOf } from '@/lib/api';
import { sellerUrl } from '@/lib/sellerUrl';
import { isSellerCategoryTemplate } from '@/lib/sellerPageRoutes';

/**
 * The published seller-category landing pages, as link rows.
 *
 * Two places list them, and they must agree:
 *   - "Choose Your Categories" inside the Sell Online guide
 *   - "Popular categories to sell across India" in the seller footer
 *
 * Both previously used their own hardcoded arrays of sixteen labels. The
 * footer's were worse than stale: they pointed at `/<slug>` on the
 * property root, while real category pages live at `/sell-online/<slug>`,
 * so all sixteen footer links 404'd. Deriving both from this one fetch
 * means a page created in the admin appears in both places, correctly
 * linked, with no code change.
 */

export type SellerCategoryLink = {
  /** Short label for the link — `sellerCategory.linkTitle`, or the page
   *  title when that's blank. */
  label: string;
  /** Public href, already resolved for dev vs the seller host. */
  href: string;
  slug: string;
};

/**
 * Hard cap on how many links either section renders.
 *
 * Both grids are four across, so sixteen fills exactly four rows — the
 * shape both designs were drawn at. Beyond that the block stops being a
 * scannable shortlist and starts being a sitemap, so extra pages are
 * simply not listed rather than allowed to grow the band indefinitely.
 */
export const MAX_SELLER_CATEGORY_LINKS = 16;

/**
 * Fetch the links. Never throws — a failed call returns an empty array so
 * callers fall back to their static copy rather than blanking a section
 * or, in the footer's case, breaking every page on the property.
 */
export async function fetchSellerCategoryLinks(): Promise<SellerCategoryLink[]> {
  try {
    const res = await fetch(`${API_URL}/pages?type=dynamic&site=seller`, {
      next: { revalidate: 300 },
      // Runs in the seller LAYOUT, so it is on the critical path of every
      // page on the property. Node's fetch has no default timeout; without
      // this a slow backend hangs every seller page rather than falling
      // back to the static labels.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = dataOf(await res.json());
    return (Array.isArray(data?.items) ? data.items : [])
      .filter((p: any) => isSellerCategoryTemplate(p?.template) && p?.slug)
      .map((p: any) => ({
        // linkTitle is the point of the field; title is the safety net for
        // pages created before it existed.
        label: String(p?.sellerCategory?.linkTitle || p.title || '').trim(),
        href: sellerUrl(`/sell-online/${p.slug}`),
        slug: String(p.slug),
      }))
      .filter((l: SellerCategoryLink) => l.label)
      .slice(0, MAX_SELLER_CATEGORY_LINKS);
  } catch {
    return [];
  }
}
