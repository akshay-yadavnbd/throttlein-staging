'use client';

import { Tabs } from '@heroui-v3/react';
import type { ReactNode } from 'react';

/**
 * The filter/view switcher for list screens.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────
 * Six hand-rolled pill rows — three in admin (`app/blogs/page.tsx`,
 * `app/pages/page.tsx`, `app/brands/page.tsx`) and three in the seller
 * dashboard (`DashboardProductsPage`, `DashboardProductNewPage`,
 * `ProductForm`) — each with its own class recipe:
 *
 *   - `px-3.5 h-9 rounded-full text-[13px] font-semibold border`
 *   - `px-3 py-1.5 rounded-full text-xs font-semibold`
 *   - a segmented control in a `border-2 p-0.5` shell
 *   - `px-3 py-1.5 rounded-full text-xs font-bold border`
 *   - `px-3 h-8 rounded-full text-xs font-medium border`
 *
 * ── THE ACCESSIBILITY PROBLEM IT FIXES ──────────────────────────────
 * All six are semantically a tab set — a mutually-exclusive view switch —
 * but were built as rows of plain `<button>`s with:
 *
 *   - no `role="tablist"` / `role="tab"` / `aria-selected`
 *   - no arrow-key navigation (a keyboard user must Tab through every
 *     option instead of arrowing within the group)
 *   - no `aria-pressed` either, so nothing announced which was active
 *   - no focus treatment at all
 *
 * v3's `Tabs` is built on React Aria, so roles, `aria-selected`, arrow
 * keys, Home/End and focus management all come for free. That's the whole
 * argument for using it rather than restyling the pills.
 *
 * ── WHY NO PANELS ───────────────────────────────────────────────────
 * These filter the list BELOW them; they don't swap between separate
 * panels of content. Rendering `Tabs.Panel` per option would duplicate the
 * table N times. So this is the tab LIST only, driven by `value` /
 * `onChange`, with the page owning what it renders underneath.
 */

export type FilterTab = {
  /** Stable key, sent to `onChange`. Usually the status/filter value. */
  id: string;
  label: string;
  /**
   * Result count. Rendered as a muted suffix.
   *
   * Pass `undefined` while loading rather than `0` — showing "(0)" before
   * the request lands tells the user there's nothing there, which is a
   * claim you can't make yet. Four of the six originals did exactly that.
   */
  count?: number;
  isDisabled?: boolean;
};

export type FilterTabsProps = {
  /**
   * Required. Names the group for assistive tech ("Order status",
   * "Post status"). None of the six hand-rolled rows had one.
   */
  ariaLabel: string;
  tabs: FilterTab[];
  /** Currently selected tab id. */
  value: string;
  onChange: (id: string) => void;
  /**
   * `secondary` (default) is the underlined row — the right choice above a
   * table, because it reads as a section boundary. `primary` is the filled
   * pill indicator, for a compact segmented control.
   */
  variant?: 'primary' | 'secondary';
  className?: string;
  /** Right-aligned content on the same row, e.g. a search field. */
  actions?: ReactNode;
};

export default function FilterTabs({
  ariaLabel,
  tabs,
  value,
  onChange,
  variant = 'secondary',
  className = '',
  actions,
}: FilterTabsProps) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <Tabs
        /* ft-underline / ft-pills: EXPLICIT variant styling via CSS in
           each app's globals.css. HeroUI's own `variant` prop emits no
           class or data-attribute on this build (verified in the DOM:
           primary and secondary rendered identically), so the two looks
           are pinned by hand — `secondary` = underlined section row,
           `primary` = segmented pill track for tabs NESTED under a
           section row. The prop is still passed for the day it works. */
        className={`min-w-0 ${variant === 'primary' ? 'ft-pills' : 'ft-underline'}`}
        selectedKey={value}
        variant={variant}
        onSelectionChange={(key) => onChange(String(key))}
      >
        {/* ListContainer handles overflow itself — it renders scroll
            chevrons and fading edges when the tabs exceed the width. Two of
            the rows this replaces used `overflow-x-auto scrollbar-hide`,
            which scrolls but gives no affordance that more exists. */}
        <Tabs.ListContainer>
          {/* `whitespace-nowrap` on each Tab: multi-word labels ("Revenue &
              orders") otherwise wrap to two lines and that tab grows taller
              than its siblings, which reads as a rendering fault. The
              ListContainer already handles the resulting overflow by
              scrolling. */}
          <Tabs.List aria-label={ariaLabel}>
            {tabs.map((t) => (
              <Tabs.Tab key={t.id} className="whitespace-nowrap" id={t.id} isDisabled={t.isDisabled}>
                {t.label}
                {typeof t.count === 'number' && (
                  /* Inside the tab so it's part of the accessible name —
                     "Draft 4" reads correctly. `tabular-nums` stops the row
                     jittering as counts update. */
                  <span className="ms-1.5 tabular-nums text-muted">{t.count}</span>
                )}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>

      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
