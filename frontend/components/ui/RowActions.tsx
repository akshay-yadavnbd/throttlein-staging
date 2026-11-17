'use client';

import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './RowActions.module.css';

/**
 * One primary action + a ⋯ menu for everything else, for table rows.
 *
 * ── WHY (UX audit X4) ──────────────────────────────────────────────
 * Rows used to end in a strip of 3–5 controls: a text button, two
 * icon-only buttons (one of them "sign in as this seller", one of them
 * "delete"), and a View link. Destructive and privileged actions sat one
 * pixel from routine ones, unlabeled, and every table invented its own
 * strip. A row now shows ONE labelled primary action; the rest live in a
 * menu where each item has a full label, and dangerous ones are red and
 * grouped last. The caller still owns confirmation dialogs.
 *
 * Deliberately hand-rolled rather than a HeroUI popover: it is ~80 lines,
 * has no positioning dependency, and its keyboard behaviour (Escape,
 * arrows, outside click, focus return) is exactly what a menu button
 * needs and nothing more. Swap for `Menu` from @heroui-v3 once its API is
 * confirmed stable in the installed build.
 *
 * Kept byte-identical between admin/components/ui and
 * frontend/components/ui (scripts/check-theme-sync.js).
 */

/** useLayoutEffect warns during SSR; the placement it does is client-only
 *  anyway, so fall back to useEffect where there is no layout to read. */
const useLayoutEffectSafe = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export type RowAction = {
  key: string;
  /** Verb phrase: "Send reminder", "Delete seller…". Ellipsis = opens a dialog. */
  label: string;
  /** One short line under the label when the action needs context. */
  hint?: string;
  onSelect: () => void;
  /** `danger` renders red and is moved to the end of the menu. */
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** Replaces the label with this while an async action runs. */
  busyLabel?: string;
  busy?: boolean;
};

export type RowActionsProps = {
  /**
   * Names the menu for assistive tech, e.g. "More actions for Revv Gearz".
   * Required: an unnamed ⋯ button is the exact failure this replaces.
   */
  ariaLabel: string;
  /** The one thing most people do on this row. Rendered as a small button. */
  primary?: { label: string; href?: string; onPress?: () => void; disabled?: boolean };
  /** Everything else. An empty list hides the ⋯ button. */
  items?: RowAction[];
  className?: string;
};

const PRIMARY_CLASS =
  'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-foreground transition-colors hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60';

function ActionIcon({ action }: { action: RowAction }) {
  const paths: Record<string, string> = {
    view: 'M14 3h7v7 M21 3 10 14 M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
    copy: 'M9 9h12v12H9z M5 15H3V3h12v2',
    edit: 'm16 3 5 5-12 12-6 1 1-6Z M13 6l5 5',
    delete: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
    cancel: 'm6 6 12 12 M18 6 6 18',
    hide: 'M3 3l18 18 M10 10a3 3 0 0 0 4 4 M9 5a11 11 0 0 1 12 7l-3 4 M6 6a15 15 0 0 0-5 6c5 9 13 9 18 3',
  };
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[action.key] || 'M5 12h14 m-5-5 5 5-5 5'} /></svg>;
}

export default function RowActions({ ariaLabel, primary, items = [], className = '' }: RowActionsProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  /* The menu is rendered into <body>, not next to the button.
   *
   * DataTable wraps rows in a scroll container so wide tables can scroll
   * sideways, and that container clips anything absolutely positioned
   * inside it — so the menu opened correctly and was invisible, sliced off
   * at the row's edge. A portal has no clipping ancestor; the trade is that
   * the menu no longer inherits the row's position, so it is placed from
   * the button's own rect and re-placed whenever anything moves. */
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

  // Danger last, so the eye never has to cross "Delete" to reach "Edit".
  const ordered = [...items.filter((i) => i.tone !== 'danger'), ...items.filter((i) => i.tone === 'danger')];

  /* Place (and keep placing) the menu under the button. useLayoutEffect so
   * the first paint is already in the right spot — with useEffect the menu
   * renders at 0,0 for a frame and visibly jumps. */
  useLayoutEffectSafe(() => {
    if (!open) { setCoords(null); return; }
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      // Flip above when the menu would run past the viewport's bottom.
      const height = menuRef.current?.offsetHeight ?? 0;
      const below = window.innerHeight - r.bottom;
      const top = height && below < height + 8 ? Math.max(8, r.top - height - 4) : r.bottom + 4;
      const width = menuRef.current?.offsetWidth ?? 240;
      setCoords({ top, right: Math.min(Math.max(8, window.innerWidth - r.right), Math.max(8, window.innerWidth - width - 8)) });
    };
    place();
    // `true` catches scrolling in the table's own container, not just the page.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, ordered.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      // The menu lives outside rootRef now, so it has to be asked too —
      // otherwise mousedown on an item counts as "outside", closes the
      // menu, and the click never lands on the item.
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[active];
    el?.focus();
  }, [open, active]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % ordered.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + ordered.length) % ordered.length); }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    if (e.key === 'End') { e.preventDefault(); setActive(ordered.length - 1); }
    if (e.key === 'Tab') setOpen(false);
  };

  const select = (item: RowAction) => {
    if (item.disabled || item.busy) return;
    setOpen(false);
    buttonRef.current?.focus();
    item.onSelect();
  };

  return (
    // stopPropagation: the row itself is clickable (DataTable.onRowClick);
    // acting on the row's controls must not also open the row.
    <div ref={rootRef} className={`relative inline-flex items-center justify-end gap-2 ${className}`} onClick={(e) => e.stopPropagation()}>
      {primary && (primary.href ? (
        <Link className={PRIMARY_CLASS} href={primary.href}>{primary.label}</Link>
      ) : (
        <button className={PRIMARY_CLASS} disabled={primary.disabled} onClick={primary.onPress} type="button">{primary.label}</button>
      ))}

      {ordered.length > 0 && (
        <>
          <button
            ref={buttonRef}
            aria-controls={open ? menuId : undefined}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label={ariaLabel}
            className={styles.trigger}
            onClick={() => { setActive(0); setOpen((o) => !o); }}
            onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive(0); setOpen(true); } }}
            type="button"
          >
            <svg aria-hidden fill="currentColor" height="16" viewBox="0 0 24 24" width="16">
              <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>

          {open && typeof document !== 'undefined' && createPortal((
            <div
              ref={menuRef}
              aria-label={ariaLabel}
              className={styles.menu}
              id={menuId}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={onMenuKey}
              role="menu"
              style={{ top: coords?.top ?? -9999, right: coords?.right ?? -9999 }}
            >
              {ordered.map((item, i) => {
                const danger = item.tone === 'danger';
                const firstDanger = danger && (i === 0 || ordered[i - 1].tone !== 'danger');
                return (
                  <div key={item.key}>
                    {firstDanger && i > 0 && <div className={styles.separator} role="separator" />}
                    <button
                      aria-disabled={item.disabled || item.busy || undefined}
                      className={`${styles.item} ${danger ? styles.danger : ''}`}
                      onClick={() => select(item)}
                      role="menuitem"
                      tabIndex={-1}
                      type="button"
                    >
                      <span className={styles.icon}><ActionIcon action={item} /></span>
                      <span className={styles.copy}>
                        <span className={styles.label}>{item.busy && item.busyLabel ? item.busyLabel : item.label}</span>
                        {item.hint && <span className={styles.hint}>{item.hint}</span>}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          ), document.body)}
        </>
      )}
    </div>
  );
}
