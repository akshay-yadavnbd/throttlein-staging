'use client';

import { Table } from '@heroui-v3/react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { EmptyState, ErrorState, TableSkeleton } from './States';

/**
 * Row identity type.
 *
 * Deliberately NOT React's own `Key`. React widened `Key` to include
 * `bigint`, but React Aria's collection keys are `string | number` — so
 * importing `Key` from 'react' here fails to typecheck against
 * `Table.Row id`. This is the narrower, correct type.
 */
type RowKey = string | number;

/**
 * The data table for every admin list screen.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────
 * 23 table implementations in admin (21 HeroUI + 2 hand-rolled `<table>`)
 * and 8 more in the seller dashboard, with:
 *
 *   - THREE wrapper recipes: `Card + CardBody p-0 + Table removeWrapper`,
 *     bare `Card`, and no Card at all (3 tables kept HeroUI's own wrapper,
 *     so they visibly didn't match the other 18)
 *   - `classNames={{ th: 'bg-default-50 text-xs uppercase …' }}` inlined
 *     identically 7 times
 *   - header casing done three ways: SHOUTED in JSX, Title Case in JSX,
 *     or uppercased in CSS
 *   - `bottomContent` pagers with the wrapper class string duplicated
 *
 * ── THE BUGS IT FIXES, NOT JUST THE DUPLICATION ─────────────────────
 * 1. `overflow-x-auto` was present on 2 of 23 admin tables and 2 of 8
 *    seller tables. Worse, 18 used `removeWrapper`, which strips HeroUI
 *    v2's own scroll container, and 5 then added `min-w-full` — forcing
 *    overflow with nothing to scroll it. On a phone those tables clip.
 *    v3's `Table.ScrollContainer` is mandatory here, so it can't be
 *    forgotten.
 * 2. Zero `<caption>` and zero `scope` attributes across all 31 tables.
 *    `Table.Column isRowHeader` on the first column gives real row-header
 *    semantics, and `aria-label` is a required prop below.
 * 3. Loading, empty and error were each hand-rolled per page — or absent.
 *    All three are states of the table, so they live here.
 *
 * ── WHY A RENDER-PROP API ───────────────────────────────────────────
 * Columns are declared as data, rows as a render function. That keeps the
 * accessible structure (which column is the row header, what the header
 * text is) in one place, while leaving cell content completely free — the
 * audited tables render chips, avatars, buttons and truncated links in
 * cells, so anything more prescriptive wouldn't fit.
 */

export type DataTableColumn<T> = {
  /** Stable key. Also used as the React key. */
  id: string;
  /** Header text. Sentence case — the component uppercases visually. */
  header: ReactNode;
  /** Cell renderer. */
  cell: (row: T) => ReactNode;
  /**
   * Marks the column that identifies the row (name, title, order number).
   * Exactly one column should set this: it becomes the row's accessible
   * name, which is what a screen reader announces when navigating cells.
   */
  isRowHeader?: boolean;
  /** Minimum width in px, for columns that shouldn't collapse. */
  minWidth?: number;
  /** Extra classes on the cell (e.g. `text-right tabular-nums`). The
   *  text alignment in here is mirrored onto the header — see
   *  `headerAlign` below. */
  className?: string;
};

/**
 * Give the header the same alignment as its cells.
 *
 * `className` only ever reached Table.Cell, so a money column set to
 * `text-right` had right-aligned figures under a left-aligned heading:
 * "Expected payout" sat at the far left of a column whose numbers ended at
 * the far right, and no heading was over its own values. Reading the
 * intent back out of the cell classes fixes every table at once, without
 * a new prop that twenty existing call sites would have to pass.
 */
function headerAlign(className = ''): string {
  if (/\btext-right\b/.test(className)) return 'text-right';
  if (/\btext-center\b/.test(className)) return 'text-center';
  return '';
}

export type DataTableProps<T> = {
  /**
   * Required. Names the table for assistive tech. All 21 v2 tables did
   * have this — it's the one thing that was uniformly correct, so it's
   * enforced rather than optional.
   */
  ariaLabel: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Stable row identity. Defaults to `row._id` / `row.id`. */
  rowKey?: (row: T) => RowKey;
  /** Minimum table width before horizontal scroll kicks in. */
  minWidth?: number;

  /* ── states ── */
  isLoading?: boolean;
  /** API error message. Presence switches the table to the error state. */
  error?: string | null;
  onRetry?: () => void;
  /** Shown when `rows` is empty and there's no error. */
  empty?: {
    title: string;
    description?: ReactNode;
    action?: ReactNode;
    icon?: ReactNode;
    /** True when a filter/search is responsible for the emptiness. */
    filtered?: boolean;
  };

  /** Pagination or a summary row, rendered in Table.Footer. */
  footer?: ReactNode;
  /**
   * Viewport-cap mode: the table renders at NATURAL height while its rows
   * fit on screen (no stretched empty band under a short list), and once
   * they'd overflow it shrinks to the parent's bound and the BODY scrolls
   * inside — header pinned to the top of the scroll area, footer always
   * visible below it. The parent must give the table a bounded height
   * (e.g. a `flex h-[…] flex-col` page wrapper), otherwise there is
   * nothing to cap and this is a no-op.
   */
  fillHeight?: boolean;
  className?: string;
  /**
   * Expandable rows — the HeroUI docs "Expandable Rows" pattern. When
   * set, a chevron column is prepended; clicking it toggles a full-width
   * detail row rendered directly beneath the data row.
   *
   * The installed HeroUI build (3.2.3) predates the native `treeColumn`
   * API from the current docs, so this emulates it with React Aria's
   * `colSpan` (which IS supported): detail content lives in a sibling
   * `Table.Row` whose single cell spans every column. Revisit when the
   * package is upgraded.
   */
  renderExpanded?: (row: T) => ReactNode;
  /**
   * Whole-row navigation (UX audit X4). Clicking anywhere on a row that
   * is not itself a control (link, button, input, menu) opens the row:
   * `rowHref` pushes a route, `onRowClick` runs a handler. Rows get a
   * pointer cursor and a hover tint so the affordance is visible. Keep
   * a visible primary action in the last column as well — row click is a
   * shortcut, not the only door (keyboard users tab to the button).
   */
  rowHref?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
};

/** True when the click started on something that handles its own clicks. */
function isInteractive(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest('a, button, input, select, textarea, label, [role="menu"], [role="menuitem"], [data-row-click="ignore"]');
}

function defaultRowKey(row: any, index: number): RowKey {
  return row?._id ?? row?.id ?? index;
}

export default function DataTable<T>({
  ariaLabel,
  columns,
  rows,
  rowKey,
  minWidth = 720,
  isLoading = false,
  error = null,
  onRetry,
  empty,
  footer,
  fillHeight = false,
  className = '',
  renderExpanded,
  rowHref,
  onRowClick,
}: DataTableProps<T>) {
  const router = useRouter();
  const clickable = Boolean(rowHref || onRowClick);
  const openRow = (row: T, e: React.MouseEvent) => {
    if (!clickable || isInteractive(e.target)) return;
    const href = rowHref?.(row);
    if (onRowClick) onRowClick(row);
    if (href) {
      // Cmd/Ctrl-click keeps the browser's "open in new tab" habit.
      if (e.metaKey || e.ctrlKey) window.open(href, '_blank', 'noopener');
      else router.push(href);
    }
  };
  /* Expanded-row state is internal — pages only supply the detail
     renderer. Multiple rows can be open at once so two records can be
     compared side by side. */
  const [expandedKeys, setExpandedKeys] = useState<Set<RowKey>>(new Set());
  const toggleExpanded = (key: RowKey) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  /* Error and first-load states replace the table entirely — rendering an
     empty grid plus a message reads as "0 results", which is a different
     and misleading claim. */
  if (error) {
    return (
      <div className={`overflow-hidden rounded-2xl border border-border bg-surface ${className}`}>
        <ErrorState message={error} onRetry={onRetry} title="Couldn’t load this list" />
      </div>
    );
  }

  if (isLoading && rows.length === 0) {
    return (
      <div className={`overflow-hidden rounded-2xl border border-border bg-surface ${className}`}>
        <TableSkeleton columns={columns.length} />
      </div>
    );
  }

  return (
    /* `variant="primary"` (the default) IS the container: HeroUI's grey
       surface with a card-style body and inset rounded header band —
       the exact look of the docs examples. The earlier draft wrapped a
       `secondary` table in our own border, which produced a flat,
       full-bleed header that visibly didn't match HeroUI. Per the docs,
       primary must NOT be nested inside another Card/Surface. */
    /* fillHeight: NO flex-1 anywhere — growth is what painted a stretched
       empty band under short lists. `min-h-0` + default flex-shrink lets
       the table SHRINK into the parent's bound when rows overflow, while
       a short table keeps its natural height. */
    <Table
      className={`${fillHeight ? 'flex min-h-0 flex-col' : ''} ${className}`}
      variant="primary"
    >
        {/* NOT optional. This is the scroll container 29 of 31 audited
            tables were missing. In fillHeight mode it also scrolls
            VERTICALLY once the table is squeezed (min-h-0), the thead
            pins to its top, and Table.Footer — a sibling outside this
            container — stays put. The scrollbar itself is HIDDEN
            (scrollbar-hidden) per product decision — wheel/touch/keys
            still scroll, and the pagination summary in the footer
            carries the "where am I" signal the bar would have. */}
        <Table.ScrollContainer
          className={
            fillHeight
              ? 'scrollbar-hidden min-h-0 overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10'
              : undefined
          }
        >
          <Table.Content aria-label={ariaLabel} style={{ minWidth }}>
            <Table.Header>
              {/* Chevron column first, like the docs example — narrow,
                  no header text. */}
              {renderExpanded && (
                <Table.Column id="__expand" className="w-12">
                  <span className="sr-only">Expand row</span>
                </Table.Column>
              )}
              {columns.map((col) => (
                <Table.Column
                  key={col.id}
                  className={headerAlign(col.className)}
                  id={col.id}
                  isRowHeader={col.isRowHeader}
                  minWidth={col.minWidth}
                >
                  {col.header}
                </Table.Column>
              ))}
            </Table.Header>

            <Table.Body
              items={rows.flatMap((row, i) => {
                /* React Aria needs an `id` on each item to track rows. */
                const id = (rowKey ? rowKey(row) : defaultRowKey(row, i)) as RowKey;
                const items: { id: RowKey; row: T; detail?: boolean }[] = [{ id, row }];
                /* Expanded → a synthetic sibling item that renders as the
                   full-width detail row directly beneath. */
                if (renderExpanded && expandedKeys.has(id)) {
                  items.push({ id: `${String(id)}__detail`, row, detail: true });
                }
                return items;
              })}
              renderEmptyState={() => (
                /* HeroUI drops the empty state straight onto the primary
                   variant's cream container — floating text with no
                   surface. Wrap it in the same white rounded card the
                   row body would occupy, so the empty table still reads
                   as a table. */
                <div className="rounded-2xl bg-surface">
                  {empty ? (
                    <EmptyState
                      action={empty.action}
                      description={empty.description}
                      filtered={empty.filtered}
                      icon={empty.icon}
                      title={empty.title}
                    />
                  ) : (
                    <EmptyState title="Nothing here yet" />
                  )}
                </div>
              )}
            >
              {(item: { id: RowKey; row: T; detail?: boolean }) =>
                item.detail ? (
                  /* Full-width detail row — one cell spanning every
                     column (incl. the chevron column). */
                  <Table.Row id={item.id}>
                    <Table.Cell
                      className="bg-surface-secondary/40 px-6 py-4"
                      colSpan={columns.length + 1}
                    >
                      {renderExpanded!(item.row)}
                    </Table.Cell>
                  </Table.Row>
                ) : (
                  <Table.Row className={clickable ? 'transition-colors hover:bg-surface-tertiary/60' : undefined} id={item.id}>
                    {renderExpanded && (
                      <Table.Cell className="w-12">
                        <button
                          aria-expanded={expandedKeys.has(item.id)}
                          aria-label={
                            expandedKeys.has(item.id) ? 'Collapse row' : 'Expand row'
                          }
                          className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                          type="button"
                          onClick={() => toggleExpanded(item.id)}
                        >
                          <svg
                            aria-hidden
                            className={`transition-transform ${expandedKeys.has(item.id) ? 'rotate-90' : ''}`}
                            fill="none"
                            height="14"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2.4"
                            viewBox="0 0 24 24"
                            width="14"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      </Table.Cell>
                    )}
                    {columns.map((col) => (
                      <Table.Cell key={col.id} className={`${col.className || ''} ${clickable ? 'cursor-pointer' : ''}`}>
                        {/* `display: contents` keeps layout identical; the
                            div only exists to receive the row click, since
                            the React Aria cell does not forward onClick. */}
                        {clickable ? (
                          <div className="contents" onClick={(e) => openRow(item.row, e)}>
                            {col.cell(item.row)}
                          </div>
                        ) : (
                          col.cell(item.row)
                        )}
                      </Table.Cell>
                    ))}
                  </Table.Row>
                )
              }
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>

        {/* Table.Footer is a SIBLING of ScrollContainer inside <Table> —
            the official slot for pagination ("Use Table.Footer to add a
            pagination component below the table"). It renders outside the
            <table> element, so no colSpan games. */}
        {/* shrink-0: when the scroll container is squeezed, the footer
            must keep its height rather than compress with it. */}
        {footer && <Table.Footer className={fillHeight ? 'shrink-0' : undefined}>{footer}</Table.Footer>}
      </Table>
  );
}
