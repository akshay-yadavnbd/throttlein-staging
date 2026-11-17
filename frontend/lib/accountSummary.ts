'use client';

/**
 * The counts in the account banner and tab bar (orders, cart, wishlist,
 * addresses), fetched once and shared by every /account page and /cart.
 *
 * Refreshes itself on the window events the rest of the storefront already
 * fires after a change — `cart:changed`, `wishlist:changed` — plus
 * `addresses:changed` (fire it via `addressesChanged()` after an address
 * add/edit/remove).
 */
import { useEffect, useState } from 'react';
import { customerApi } from '@/lib/customerApi';
import { unwrap } from '@/lib/api';
import { getWishlistIds } from '@/lib/wishlist';

export type AccountSummary = {
  orders: number;
  lastOrderAt?: string;
  cart: number;
  wishlist: number;
  addresses: number;
  defaultCity?: string;
};

const EVENTS = ['cart:changed', 'wishlist:changed', 'addresses:changed'] as const;

let cached: AccountSummary | null = null;
let inFlight: Promise<AccountSummary> | null = null;

function fetchSummary(): Promise<AccountSummary> {
  if (!inFlight) {
    // One failed part leaves its count at 0 rather than blanking the banner.
    const part = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    inFlight = Promise.all([
      part(customerApi.get('/orders', { params: { limit: 1 } }).then((r) => r.data), null as any),
      part(customerApi.get('/cart').then((r) => unwrap<any>(r)), null as any),
      part(getWishlistIds(), new Set<string>()),
      part(customerApi.get('/addresses').then((r) => unwrap<any>(r)), null as any),
    ])
      .then(([orders, cart, wishlist, addr]) => {
        const addresses: any[] = addr?.addresses || [];
        const def = addresses.find((a) => a.isDefault) || addresses[0];
        cached = {
          orders: Number(orders?.meta?.totalItems ?? orders?.data?.items?.length ?? 0),
          lastOrderAt: orders?.data?.items?.[0]?.createdAt,
          cart: cart?.cart?.items?.length || 0,
          wishlist: wishlist.size,
          addresses: addresses.length,
          defaultCity: def?.city,
        };
        return cached;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Tell the banner the saved addresses changed. */
export function addressesChanged() {
  window.dispatchEvent(new Event('addresses:changed'));
}

export function useAccountSummary(): AccountSummary | null {
  const [summary, setSummary] = useState<AccountSummary | null>(cached);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      fetchSummary().then((s) => {
        if (live) setSummary(s);
      });
    };
    refresh();
    EVENTS.forEach((e) => window.addEventListener(e, refresh));
    return () => {
      live = false;
      EVENTS.forEach((e) => window.removeEventListener(e, refresh));
    };
  }, []);

  return summary;
}
