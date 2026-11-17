'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The page header for every admin screen.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────
 * The audit found SEVEN header patterns across 53 admin pages, plus six
 * more in the seller dashboard:
 *
 *   1. dark `bg-brand-black` hero with a diagonal-stripe overlay — copied
 *      into 17 pages, ~20 lines each, and the overlay gradient colour was
 *      even wrong in one of them (#141414 instead of #FFFFFF)
 *   2. a near-miss of (1) with different spacing and tracking
 *   3. light eyebrow + h1 + subtitle — 11 pages, with FOUR different
 *      eyebrow spellings (10px/11px × 0.25em/0.3em × bold/semibold)
 *   4. plain h1 + paragraph, no eyebrow — 8 pages
 *   5. small h1, no hero — 5 pages
 *   6. header inside a Card — 3 detail pages
 *   7. form-wrapper header — 4 pages
 *
 * Plus six hand-rolled breadcrumb strips, all `text-xs text-default-500`
 * with a `/` separator, none of them using the Breadcrumbs component that
 * already existed.
 *
 * ── THE DARK HERO IS GONE ───────────────────────────────────────────
 * That's the point of the redesign. It's replaced by a light surface with
 * a bottom rule: the same visual separation, without a 17×-duplicated
 * black block that fought the nude palette and forced `text-white` on
 * everything inside it.
 *
 * ── ONE H1 PER PAGE ─────────────────────────────────────────────────
 * `title` renders the page's only `<h1>`. Several audited pages had none
 * at all (the blog index's h1 was commented out) or had an h1 inside a
 * card competing with a hero. This makes the document outline correct by
 * construction.
 */

export type Crumb = {
  label: string;
  /** Omit on the last crumb — the current page isn't a link. */
  href?: string;
};

export type PageHeaderProps = {
  /** The page's single <h1>. */
  title: string;
  /**
   * Small uppercase label above the title ("CONTENT", "OPERATIONS").
   * Optional — it's orientation, not decoration, so skip it when the
   * breadcrumb already says where you are.
   */
  eyebrow?: string;
  /** One sentence on what this page is for. Keep it short. */
  description?: ReactNode;
  /** Primary/secondary actions, right-aligned. Pass HeroUI Buttons. */
  actions?: ReactNode;
  /** Breadcrumb trail. Last item should have no href. */
  breadcrumbs?: Crumb[];
  /**
   * Stats or filters that belong to the header rather than the body —
   * rendered below the title row, above the rule.
   */
  children?: ReactNode;
  /**
   * Route tabs for an area with sub-pages (see SectionTabs). Rendered
   * flush above the rule so the active tab's indicator sits on it.
   */
  tabs?: ReactNode;
  className?: string;
};

export default function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  breadcrumbs,
  children,
  tabs,
  className = '',
}: PageHeaderProps) {
  return (
    <header className={`mb-6 ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        /* `aria-label` is required for a nav landmark to be distinguishable
           — all six hand-rolled strips this replaces omitted it. */
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {breadcrumbs.map((c, i) => {
              const last = i === breadcrumbs.length - 1;
              return (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
                  {c.href && !last ? (
                    <Link
                      href={c.href}
                      className="rounded transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      {c.label}
                    </Link>
                  ) : (
                    /* aria-current tells a screen reader which crumb is the
                       page you're on. */
                    <span aria-current={last ? 'page' : undefined} className="text-foreground">
                      {c.label}
                    </span>
                  )}
                  {!last && (
                    <span aria-hidden className="text-border">
                      /
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            /* ONE eyebrow spelling. The audit found four variants of this
               single line across 11 pages. */
            <p className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
              {eyebrow}
            </p>
          )}
          {/* font-semibold (600), not bold. The old global
              `.font-bold { font-weight: 600 !important }` clamp made
              semibold/bold/extrabold render identically; now that the clamp
              is gone, the weight here is deliberate. */}
          <h1 className="mt-0.5 truncate text-2xl font-semibold text-foreground sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
          )}
        </div>

        {actions && (
          /* `shrink-0` so a long title never squashes the buttons, and
             `flex-wrap` so two actions stack rather than overflow on a
             narrow viewport. */
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>

      {children && <div className="mt-5">{children}</div>}

      {tabs && <div className="mt-4">{tabs}</div>}

      {/* A single hairline instead of a 17×-duplicated black hero. */}
      <div className={`${tabs ? '' : 'mt-5 '}h-px bg-separator`} />
    </header>
  );
}
