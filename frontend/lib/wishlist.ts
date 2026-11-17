'use client';

/**
 * Shared wishlist-membership cache.
 *
 * Every ProductCard on a listing page (and the navbar badge) needs to
 * know which product ids are currently wishlisted, but firing one
 * `GET /wishlist` per card would mean dozens of identical requests on a
 * single page. Instead, the first caller populates this module-level
 * cache (or shares the one in-flight request), and everyone else reads
 * the same result.
 *
 * Call `invalidateWishlist()` after any add/remove — it clears the
 * cache AND fires a `wishlist:changed` window event, so every mounted
 * card showing that product (it can appear in more than one rail) and
 * the navbar count badge update immediately, without a page reload.
 */

import { customerApi } from '@/lib/customerApi';
import { unwrap } from '@/lib/api';
import { getStoredCustomer } from '@/lib/customerAuth';

let cache: Set<string> | null = null;
let inFlight: Promise<Set<string>> | null = null;

export async function getWishlistIds(): Promise<Set<string>> {
  if (!getStoredCustomer()) return new Set();
  if (cache) return cache;
  if (!inFlight) {
    inFlight = customerApi
      .get('/wishlist')
      .then((r) => {
        const ids: string[] = (unwrap<{ wishlist?: { products?: any[] } }>(r).wishlist?.products || []).map((p: any) =>
          typeof p === 'string' ? p : p?._id,
        );
        cache = new Set(ids);
        return cache;
      })
      .catch(() => new Set<string>())
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function invalidateWishlist() {
  cache = null;
  inFlight = null;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('wishlist:changed'));
  }
}
