/**
 * Multi-site registry for the admin panel.
 *
 * The platform publishes two properties from one admin:
 *   - 'main'   → throttlein.com
 *   - 'seller' → seller.throttlein.com
 *
 * Pages and Blogs are scoped to one of them. The sidebar's site
 * switcher picks the ACTIVE site; `lib/api.ts` forwards it to the
 * backend on every request via the `X-Admin-Site` header, so individual
 * screens don't have to thread it through their own fetch calls.
 *
 * Keep this list in sync with `backend/src/constants/sites.js`.
 */

import type { AdminUser } from './auth';
import { STAFF_ASSIGNABLE_MODULES, permKeyFor } from './modules';

export type SiteKey = 'main' | 'seller';

export type SiteDef = {
  key: SiteKey;
  /** Shown in the switcher and on "Publishing to:" badges. */
  label: string;
  /** Public host, shown as the switcher's secondary line so nobody has
   *  to remember which label maps to which domain. */
  host: string;
  /** Tailwind classes for the colour dot — a fast visual cue that you
   *  are NOT on the site you usually work on. */
  dotClass: string;
};

export const SITES: SiteDef[] = [
  { key: 'main',   label: 'Throttlein', host: 'throttlein.com',        dotClass: 'bg-emerald-400' },
  { key: 'seller', label: 'Seller',     host: 'seller.throttlein.com', dotClass: 'bg-sky-400' },
];

export const DEFAULT_SITE: SiteKey = 'main';

export const SITES_BY_KEY: Record<SiteKey, SiteDef> = Object.fromEntries(
  SITES.map((s) => [s.key, s])
) as Record<SiteKey, SiteDef>;

export function isSiteKey(value: unknown): value is SiteKey {
  return value === 'main' || value === 'seller';
}

/**
 * Which sites can this user touch?
 *
 * Superadmin gets both. A staff user gets a site if they hold ANY
 * site-scoped permission for it — e.g. `seller-blogs` alone is enough
 * to make the Seller site appear in their switcher (they'll just see
 * Blogs and not Pages once they're there).
 */
export function sitesAvailableTo(user: AdminUser | null): SiteKey[] {
  if (!user) return [];
  if (user.role === 'superadmin') return SITES.map((s) => s.key);
  if (user.role !== 'staff') return [];
  const granted = new Set(user.permissions || []);
  const scoped = STAFF_ASSIGNABLE_MODULES.filter((m) => m.siteScoped);
  return SITES
    .map((s) => s.key)
    .filter((site) => scoped.some((m) => granted.has(permKeyFor(m, site))));
}

/* ─── Active-site persistence ─────────────────────────────────────── */

const SITE_KEY = 'admin_site';

/** Fired on `window` whenever the active site changes, so AdminShell
 *  (and anything else listening) can re-render without prop drilling
 *  through 47 page components. */
export const SITE_CHANGE_EVENT = 'admin-site-change';

export function getActiveSite(): SiteKey {
  if (typeof window === 'undefined') return DEFAULT_SITE;
  const raw = localStorage.getItem(SITE_KEY);
  return isSiteKey(raw) ? raw : DEFAULT_SITE;
}

export function setActiveSite(site: SiteKey) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SITE_KEY, site);
  window.dispatchEvent(new CustomEvent(SITE_CHANGE_EVENT, { detail: site }));
}

/**
 * Resolve the site to actually use for a given user.
 *
 * Guards against a stored value the user can no longer access — e.g.
 * a staffer who had `seller-pages` revoked but still has 'seller' in
 * localStorage. Falls back to their first available site so the panel
 * never renders in a site they can't act on.
 */
export function resolveActiveSite(user: AdminUser | null): SiteKey {
  const available = sitesAvailableTo(user);
  if (available.length === 0) return DEFAULT_SITE;
  const stored = getActiveSite();
  return available.includes(stored) ? stored : available[0];
}
