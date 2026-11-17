'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Tabs that move between ROUTES inside one area — "Orders · Delivery
 * issues · Returns" — as opposed to `FilterTabs`, which filters the list
 * below it without leaving the page.
 *
 * ── WHY A SEPARATE COMPONENT (UX audit S1) ─────────────────────────
 * The seller sidebar listed NDR and Returns as top-level destinations
 * beside Orders, so a seller learnt three places to look for "what's
 * wrong with my parcels". Those screens are sub-views of Orders and now
 * sit under it as tabs; the routes themselves are unchanged, so old links
 * and bookmarks still land.
 *
 * Semantically these are links (each has its own URL, back button works,
 * Cmd-click opens a tab), so this is a `<nav>` of anchors with
 * `aria-current="page"` — NOT `role="tablist"`, which promises in-page
 * panel switching that navigation doesn't deliver.
 *
 * Visual language is the `.ft-underline` look from FilterTabs: quiet row,
 * 2px ink indicator under the active item. Drop it into `PageHeader`'s
 * `tabs` slot and the indicator sits on the header's own hairline.
 *
 * Kept byte-identical between admin/components/ui and
 * frontend/components/ui (scripts/check-theme-sync.js).
 */

export type SectionTab = {
  href: string;
  label: string;
  /**
   * Count shown after the label. `undefined` while loading — never show a
   * "0" you can't vouch for yet. `attention` renders a non-zero count as a
   * red pill (things waiting on the user); `default` is a muted number.
   */
  count?: number;
  tone?: 'default' | 'attention';
  /** Match the pathname exactly instead of by prefix (for the area root). */
  exact?: boolean;
};

export type SectionTabsProps = {
  /** Names the landmark: "Orders sections". Required. */
  ariaLabel: string;
  tabs: SectionTab[];
  className?: string;
};

export default function SectionTabs({ ariaLabel, tabs, className = '' }: SectionTabsProps) {
  const pathname = usePathname() || '';
  // Longest matching href wins so "/dashboard/orders" doesn't also light
  // up when "/dashboard/orders/returns" is the page.
  const active = tabs
    .filter((t) => (t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <nav aria-label={ariaLabel} className={`-mb-px flex gap-5 overflow-x-auto overflow-y-hidden ${className}`}>
      {tabs.map((t) => {
        const isActive = t === active;
        const showCount = typeof t.count === 'number';
        const hot = t.tone === 'attention' && (t.count ?? 0) > 0;
        return (
          <Link
            aria-current={isActive ? 'page' : undefined}
            className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
              isActive ? 'font-semibold text-foreground' : 'font-medium text-muted hover:text-foreground'
            }`}
            href={t.href}
            key={t.href}
          >
            {t.label}
            {showCount && (
              <span
                className={`tabular-nums ${
                  hot
                    ? 'rounded-full bg-danger px-1.5 py-px text-xs font-semibold leading-4 text-danger-foreground'
                    : 'text-muted'
                }`}
              >
                {t.count}
              </span>
            )}
            {isActive && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground" />}
          </Link>
        );
      })}
    </nav>
  );
}
