'use client';

import { useEffect, useState } from 'react';
import { getStoredAdmin } from './auth';
import { resolveActiveSite, SITE_CHANGE_EVENT, type SiteKey } from './site';

/**
 * The sidebar's currently-selected site, as reactive state.
 *
 * Any list or detail screen showing site-scoped data should take this
 * and put it in its data-fetching effect's dependency array:
 *
 *   const site = useActiveSite();
 *   useEffect(() => { load(); }, [site]);
 *
 * The fetch itself needs no change — `lib/api.ts` attaches the
 * `X-Admin-Site` header from the same source. What the dependency buys
 * you is the REFETCH: without it, flipping the switcher leaves the
 * previous property's rows on screen, which is worse than showing
 * nothing because it looks like real data for the site you just
 * selected.
 */
export function useActiveSite(): SiteKey {
  const [site, setSite] = useState<SiteKey>('main');

  useEffect(() => {
    const sync = () => setSite(resolveActiveSite(getStoredAdmin()));
    sync();
    window.addEventListener(SITE_CHANGE_EVENT, sync);
    return () => window.removeEventListener(SITE_CHANGE_EVENT, sync);
  }, []);

  return site;
}
