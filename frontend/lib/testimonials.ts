import { API_URL, imageUrl, dataOf } from '@/lib/api';
import { TESTIMONIALS as FALLBACK_TESTIMONIALS } from '@/lib/sellOnlineContent';

/**
 * Seller success stories — the quote carousel on the Sell Online page
 * and on every seller-category page.
 *
 * These used to be a hardcoded array in `sellOnlineContent.ts` with a
 * single entry. They're now admin-managed (Testimonials tab in the super
 * admin panel), fetched per site, with the original hardcoded card kept
 * as the fallback so the section never renders empty on a fresh
 * database — an empty white card under a "Seller Success Stories"
 * heading looks broken in a way that no content at all does not.
 */

export type TestimonialItem = {
  /** Absent on the fallback entry, which has no database row. */
  _id?: string;
  name: string;
  company: string;
  /**
   * The quote. From the API this is rich-text HTML; the fallback is
   * plain text. RichTextView handles both — it has a plain-text branch
   * for values with no tags — so consumers render it the same way
   * regardless of origin.
   */
  quote: string;
  /**
   * Either a bare S3 key (admin-uploaded) or a Next `public/` path (the
   * fallback). Resolve with `testimonialAvatarSrc`, never `imageUrl`
   * directly — see that function for why.
   */
  avatar: string;
};

/**
 * Resolve an avatar to something an <img>/next-image can load.
 *
 * `imageUrl()` prefixes any root-relative path with the BACKEND origin,
 * which is right for `/uploads/...` and `/api/files/...` but wrong for a
 * file that lives in the frontend's own `public/` folder. The fallback
 * avatar is exactly that case, so root-relative `/images/...` paths pass
 * through untouched and everything else goes through `imageUrl`.
 */
export function testimonialAvatarSrc(avatar?: string): string {
  const value = String(avatar || '').trim();
  if (!value) return '';
  if (value.startsWith('/images/')) return value;
  return imageUrl(value);
}

/** Initials shown when a testimonial has no photo. Two words max. */
export function testimonialInitials(name: string): string {
  return (
    String(name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || '')
      .join('')
      .toUpperCase() || '?'
  );
}

/** The hardcoded card, in the API's shape. */
export const FALLBACK_ITEMS: TestimonialItem[] = FALLBACK_TESTIMONIALS.map((t) => ({
  name: t.name,
  company: t.company,
  quote: t.quote,
  avatar: t.avatar,
}));

/** True when the rich-text value carries no words — TipTap stores an
 *  empty document as `<p></p>`, so a length check isn't enough. */
function hasText(html: string): boolean {
  return !!String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Published testimonials for a site, newest schema first, falling back
 * to the built-in card.
 *
 * Server-side only (uses `fetch` with Next's revalidate). 60s window
 * matches promo blocks: short enough that an admin edit shows up while
 * they're still looking, long enough not to hammer the API per render.
 *
 * Every failure path returns the fallback rather than throwing — one
 * flaky API call should not blank a section of a landing page.
 */
export async function fetchTestimonials(
  site: 'main' | 'seller' = 'seller',
): Promise<TestimonialItem[]> {
  try {
    const res = await fetch(
      `${API_URL}/testimonials?active=1&site=${encodeURIComponent(site)}`,
      {
        next: { revalidate: 60 },
        // Node's fetch has no default timeout — fail fast to the built-in
        // card rather than hanging the page on a slow API.
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return FALLBACK_ITEMS;
    const data = dataOf(await res.json());
    const items: TestimonialItem[] = (Array.isArray(data?.items) ? data.items : [])
      .filter((t: any) => t && t.name && hasText(t.quote))
      .map((t: any) => ({
        _id: String(t._id || ''),
        name: String(t.name || ''),
        company: String(t.company || ''),
        quote: String(t.quote || ''),
        avatar: String(t.avatar || ''),
      }));
    return items.length ? items : FALLBACK_ITEMS;
  } catch {
    return FALLBACK_ITEMS;
  }
}
