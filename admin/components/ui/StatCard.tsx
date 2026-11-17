'use client';

import type { ReactNode } from 'react';

/**
 * A KPI tile for dashboard headers.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────
 * `HeroStat` (admin), which was built for the dark hero — its
 * `bg-white/[0.06] border-white/10` only reads on a black parent, so it
 * became unusable the moment the hero went light. And the six inlined
 * tiles in `app/dashboard/page.tsx`, plus 16 more inlined in the seller
 * dashboard's home page.
 *
 * ── ACCESSIBILITY FIX CARRIED OVER ──────────────────────────────────
 * `HeroStat` distinguished tiles by an accent DOT alone
 * (`bg-blue-400`/`amber`/`emerald`/`indigo`/`rose`) with no text or label —
 * a WCAG 1.4.1 colour-only failure, and meaningless to a screen reader.
 * Here the accent is a thin top rule that is explicitly decorative, and
 * every tile carries a real text label.
 *
 * ── ON THE NUMBER ───────────────────────────────────────────────────
 * `tabular-nums` so a column of figures aligns and doesn't jitter as
 * values change. The audited tiles didn't set it.
 */

export type StatCardProps = {
  /** What's being counted. "Net revenue", not "Revenue (INR)". */
  label: string;
  /** The figure. Pre-formatted by the caller — currency and locale are the
   *  page's business, not this component's. */
  value: ReactNode;
  /** One line of context: "excl. 14 cancelled", "5 pending approval". */
  hint?: ReactNode;
  /** Small glyph, decorative. */
  icon?: ReactNode;
  /**
   * Optional semantic accent, shown as a top rule. Purely supplementary —
   * never the only carrier of meaning.
   */
  tone?: 'neutral' | 'positive' | 'attention' | 'negative' | 'info';
  /** Makes the whole tile a link target. */
  href?: string;
  className?: string;
};

const TONE_RULE: Record<NonNullable<StatCardProps['tone']>, string> = {
  neutral: 'bg-border',
  positive: 'bg-success',
  attention: 'bg-warning',
  negative: 'bg-danger',
  info: 'bg-accent',
};

/**
 * Icon chip tint per tone. Same explicit-token approach as StatusChip —
 * the tint reinforces the top rule so the tone reads twice (rule + icon)
 * without ever being the only carrier of meaning (the hint text is).
 */
const TONE_ICON: Record<NonNullable<StatCardProps['tone']>, string> = {
  neutral: 'bg-surface-secondary text-muted',
  positive: 'bg-success-soft text-success-soft-foreground',
  attention: 'bg-warning-soft text-warning-soft-foreground',
  negative: 'bg-danger-soft text-danger-soft-foreground',
  info: 'bg-accent-soft text-accent-soft-foreground',
};

export default function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  href,
  className = '',
}: StatCardProps) {
  const body = (
    <>
      {/* Decorative accent. aria-hidden because the label below already
          says what this is. */}
      <span aria-hidden className={`absolute inset-x-0 top-0 h-0.5 ${TONE_RULE[tone]}`} />

      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        {icon && (
          <span
            aria-hidden
            className={`grid size-9 shrink-0 place-items-center rounded-xl ${TONE_ICON[tone]}`}
          >
            {icon}
          </span>
        )}
      </div>

      {/* text-3xl: the figure is the whole point of the tile, so it leads. */}
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </p>

      {hint && <p className="mt-1.5 text-xs leading-relaxed text-muted">{hint}</p>}
    </>
  );

  const base =
    'relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-surface';

  if (href) {
    return (
      <a
        href={href}
        className={`${base} block transition-colors hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${className}`}
      >
        {body}
      </a>
    );
  }

  return <div className={`${base} ${className}`}>{body}</div>;
}
