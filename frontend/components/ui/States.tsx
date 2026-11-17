'use client';

import { Skeleton, Spinner } from '@heroui-v3/react';
import type { ReactNode } from 'react';

/**
 * The three states every data screen needs: loading, empty, error.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────
 * Loading — 8 different wrapper recipes for the SAME "page is loading"
 * state (`py-12`, `py-16 justify-center`, `py-10`, `py-6`, `p-10`,
 * `py-4`, no padding, inside a Card), and the `<Spinner size="sm" />
 * Loading…` pair copy-pasted 21 times. Also: ZERO uses of HeroUI's
 * Skeleton in either app, and three hand-written skeleton components that
 * duplicated each other.
 *
 * Empty — 8 distinct shapes, ~40 hand-written instances, from a bare
 * `<div className="text-center py-8 text-default-500 text-sm">` to a
 * 2px-dashed panel to a Chip.
 *
 * Error — 187 `toast.error` calls in admin with exactly ONE inline error
 * surface in the whole app. A toast that has already faded is not an
 * error state; a failed list needs something on the page and a way to
 * retry.
 *
 * ── WHY SKELETON OVER SPINNER FOR LISTS ─────────────────────────────
 * A skeleton preserves layout, so the page doesn't jump when data lands,
 * and it communicates "this is a table" before the table exists. The
 * spinner is kept only for short in-place waits (a button's own pending
 * state is handled by `Button isPending`).
 */

/* ──────────────────────────────────────────────────────────────────────
   LOADING
   ────────────────────────────────────────────────────────────────────── */

export type TableSkeletonProps = {
  /** Match the real table so the swap doesn't shift layout. */
  columns?: number;
  rows?: number;
  className?: string;
};

/** Skeleton shaped like a data table. Use inside the table's own surface. */
export function TableSkeleton({ columns = 5, rows = 6, className = '' }: TableSkeletonProps) {
  return (
    // `skeleton--shimmer` on the parent + `animationType="none"` on children
    // runs ONE shimmer across the whole block instead of N independent
    // shimmers, which reads as a single loading surface rather than noise.
    <div
      aria-hidden
      className={`skeleton--shimmer relative overflow-hidden ${className}`}
    >
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton
                key={c}
                animationType="none"
                // First column wider — it's the row header in almost every
                // one of our tables (name / title / order number).
                className={`h-4 rounded ${c === 0 ? 'w-[22%]' : 'flex-1'}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton shaped like a card grid (media library, author cards). */
export function CardGridSkeleton({ count = 6, className = '' }: { count?: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={`skeleton--shimmer relative grid grid-cols-1 gap-4 overflow-hidden sm:grid-cols-2 lg:grid-cols-3 ${className}`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border bg-surface p-4">
          <Skeleton animationType="none" className="h-32 rounded-xl" />
          <div className="mt-3 space-y-2">
            <Skeleton animationType="none" className="h-3 w-3/5 rounded" />
            <Skeleton animationType="none" className="h-3 w-2/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for a whole detail / editor screen inside AdminShell or
 * SellerShell: the back pill and page title, then N form cards.
 *
 * ── WHY ─────────────────────────────────────────────────────────────
 * Ten routes across the seller dashboard and admin gated their ENTIRE
 * shell body on `if (loading) return <Spinner /> Loading…`, so the whole
 * screen was a centred spinner and then, in one frame, a dense form. The
 * shell chrome is not the page; replacing everything inside it with a
 * spinner throws away the fact that we know exactly what shape is coming.
 *
 * `cards` and `rows` exist so a call site can match its own screen rather
 * than settle for a generic block — a 6-card KYC page and a 1-card status
 * check should not produce the same skeleton.
 *
 * `aside` mirrors the detail screens that carry a sticky right rail
 * (order detail, return detail), so the two-column split is reserved and
 * the main column doesn't reflow to half width when data lands.
 */
export function DetailSkeleton({
  cards = 2,
  rows = 4,
  aside = false,
  backPill = true,
  className = '',
}: {
  cards?: number;
  rows?: number;
  aside?: boolean;
  backPill?: boolean;
  className?: string;
}) {
  const cardBlock = (key: number) => (
    <div key={key} className="rounded-2xl border border-border bg-surface p-5">
      <Skeleton animationType="none" className="h-4 w-40 rounded" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="space-y-2">
            <Skeleton animationType="none" className="h-3 w-24 rounded" />
            <Skeleton animationType="none" className="h-10 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className={`skeleton--shimmer relative overflow-hidden ${className}`}
    >
      <span className="sr-only">Loading</span>
      {backPill && <Skeleton animationType="none" className="mb-4 h-8 w-28 rounded-lg" />}
      <Skeleton animationType="none" className="mb-5 h-6 w-64 rounded" />

      <div className={aside ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]' : 'space-y-4'}>
        <div className="space-y-4">
          {Array.from({ length: cards }).map((_, i) => cardBlock(i))}
        </div>
        {aside && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-surface p-5">
              <Skeleton animationType="none" className="h-4 w-24 rounded" />
              <div className="mt-4 space-y-2">
                <Skeleton animationType="none" className="h-3 w-full rounded" />
                <Skeleton animationType="none" className="h-3 w-4/5 rounded" />
                <Skeleton animationType="none" className="h-3 w-3/5 rounded" />
              </div>
              <Skeleton animationType="none" className="mt-4 h-10 rounded-lg" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Skeleton for a dashboard overview: a row of stat tiles above a wide
 * panel. Separate from DetailSkeleton because a stat row is a genuinely
 * different shape — squat, equal-width tiles, no field labels — and
 * approximating it with form cards would reserve the wrong space.
 */
export function DashboardSkeleton({
  stats = 4,
  className = '',
}: {
  stats?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`skeleton--shimmer relative overflow-hidden ${className}`}
    >
      <span className="sr-only">Loading dashboard</span>
      <Skeleton animationType="none" className="mb-5 h-6 w-56 rounded" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: stats }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-surface p-5">
            <Skeleton animationType="none" className="h-3 w-20 rounded" />
            <Skeleton animationType="none" className="mt-3 h-7 w-24 rounded" />
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
        <Skeleton animationType="none" className="h-4 w-40 rounded" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, r) => (
            <Skeleton key={r} animationType="none" className="h-9 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * In-place spinner with a label, for short waits where a skeleton would be
 * heavier than the thing being waited on (saving, re-checking, a modal
 * body). Replaces the 21 copy-pasted spinner/text pairs.
 *
 * `role="status"` + `aria-live="polite"` announces the wait to a screen
 * reader — none of the 21 originals did.
 */
export function LoadingRow({
  label = 'Loading…',
  className = '',
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2 py-12 text-sm text-muted ${className}`}
    >
      <Spinner size="sm" />
      <span>{label}</span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   EMPTY
   ────────────────────────────────────────────────────────────────────── */

export type EmptyStateProps = {
  /** What isn't here. "No sellers yet", not "No data". */
  title: string;
  /** What to do about it. Optional but usually worth writing. */
  description?: ReactNode;
  /** Usually the same primary action as the page header. */
  action?: ReactNode;
  /** Decorative glyph. Kept aria-hidden. */
  icon?: ReactNode;
  /**
   * `true` when the list is empty because of a search/filter rather than
   * because nothing exists. The audit found four pages implementing this
   * distinction independently with four different layouts — and most pages
   * not distinguishing at all, so "no results for your filter" looked
   * identical to "you have no products".
   */
  filtered?: boolean;
  className?: string;
};

/* Default glyphs, so an empty panel always has a visual anchor without
   every call site hand-drawing one: a magnifier when a filter/search is
   responsible, an open tray when nothing exists yet. */
function DefaultEmptyIcon({ filtered }: { filtered: boolean }) {
  return filtered ? (
    <svg className="size-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
      <line x1="8" x2="14" y1="11" y2="11" />
    </svg>
  ) : (
    <svg className="size-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  filtered = false,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 px-6 py-14 text-center ${className}`}
    >
      <div aria-hidden className="grid size-11 place-items-center rounded-full bg-surface-secondary text-muted">
        {icon ?? <DefaultEmptyIcon filtered={filtered} />}
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {/* A filtered-empty list must not offer "create one" — the thing may
          already exist, just not in this filter. */}
      {action && !filtered && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   ERROR
   ────────────────────────────────────────────────────────────────────── */

export type ErrorStateProps = {
  /** Short, plain. "Couldn't load sellers." */
  title?: string;
  /** The API message, when there is one worth showing. */
  message?: string;
  /** Wire to the page's own refetch. Omit if there's nothing to retry. */
  onRetry?: () => void;
  className?: string;
};

/**
 * Inline error surface for a failed load.
 *
 * Deliberately NOT a toast. Toasts are for the result of an action the
 * user just took; a list that failed to load needs a persistent surface
 * with a retry, because by the time the user looks at the screen the toast
 * is gone and the page is just mysteriously empty.
 *
 * `role="alert"` so it's announced immediately.
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className = '',
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 px-6 py-14 text-center ${className}`}
    >
      <div
        aria-hidden
        className="grid size-11 place-items-center rounded-full bg-danger-soft text-danger-soft-foreground"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {message && <p className="max-w-md text-sm text-muted">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Try again
        </button>
      )}
    </div>
  );
}
