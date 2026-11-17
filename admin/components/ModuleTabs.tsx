'use client';

import { usePathname, useRouter } from 'next/navigation';
import { FilterTabs } from '@/components/ui';
import {
  MODULES_BY_KEY,
  isMainOnlyPath,
  isSellerOnlyPath,
} from '@/lib/modules';
import { useActiveSite } from '@/lib/useActiveSite';

/**
 * In-page section tabs for a module whose sidebar submenu was collapsed
 * to a single entry (`childrenAsTabs` in lib/modules.ts) — Orders, Pages
 * and Blogs all use this.
 *
 * The tabs ARE the module's registry children, so adding a sub-screen in
 * lib/modules.ts updates the sidebar label logic, the staff URL guard
 * AND these tabs in one edit. Children are filtered by the active site
 * with the same rule buildNav uses (main-only children hidden off the
 * main site, seller-only children hidden on it), so the tabs never offer
 * a link the URL guard would bounce — e.g. Pages' "Seller home" appears
 * only while editing the seller property.
 *
 * Each tab is a real route (deep links and refreshes keep working); the
 * active tab derives from the pathname, deepest prefix match winning so
 * '/orders' doesn't claim '/orders/failed-pushes'.
 */
export default function ModuleTabs({
  moduleKey,
  className = 'mb-4',
}: {
  /** Key in the MODULES registry, e.g. 'orders' | 'pages' | 'blogs'. */
  moduleKey: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname() || '';
  const site = useActiveSite();

  const mod = MODULES_BY_KEY[moduleKey];
  const tabs = (mod?.children ?? [])
    .filter((c) =>
      site === 'main' ? !isSellerOnlyPath(c.href) : !isMainOnlyPath(c.href),
    )
    .map((c) => ({ id: c.href, label: c.label }));

  // A module with fewer than two reachable sections has nothing to
  // switch between — render nothing rather than a one-tab bar.
  if (tabs.length < 2) return null;

  const active = tabs
    .filter((t) => pathname === t.id || pathname.startsWith(`${t.id}/`))
    .sort((a, b) => b.id.length - a.id.length)[0]?.id ?? mod.href;

  return (
    <FilterTabs
      ariaLabel={`${mod.label} section`}
      className={className}
      onChange={(id) => { if (id !== active) router.push(id); }}
      tabs={tabs}
      value={active}
    />
  );
}
