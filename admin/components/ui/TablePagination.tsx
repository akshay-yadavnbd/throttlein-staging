'use client';

import { Pagination } from '@heroui-v3/react';

/**
 * Pagination footer for DataTable — HeroUI v3 Pagination composed into
 * the one shape every list page uses: a "1 to 25 of 173 results" summary
 * on the left, windowed page links with Prev/Next on the right.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────
 * The audited v2 pages each hand-rolled `<Pagination total page onChange>`
 * centred under the table with the position/margin class string
 * duplicated per page — and no page showed WHERE in the result set you
 * were (no "x to y of N"). v3's Pagination is compositional (you own the
 * page state and the number window), which is exactly why it belongs in
 * a shared component rather than being re-composed per page.
 *
 * ── USAGE ───────────────────────────────────────────────────────────
 * Pass it as DataTable's `footer` — CONDITIONALLY: per product decision
 * a list that fits on one page shows no pagination at all, so gate at
 * the call site (`footer={total > PAGE_SIZE ? <TablePagination…/> :
 * undefined}`). Gating there rather than only here matters because
 * DataTable wraps whatever it's given in Table.Footer — a component
 * that renders null would still leave an empty footer band. This
 * component ALSO self-hides on a single page as a defence, so a
 * miswired call site degrades to an empty strip, never to a "Prev 1
 * Next" row with nowhere to go.
 */

export type TablePaginationProps = {
  /** Current page, 1-based. */
  page: number;
  /** Total number of pages (>= 1). */
  pages: number;
  /** Total records across all pages. */
  total: number;
  /** Records per page — used to compute the "x to y" summary. */
  pageSize: number;
  onChange: (page: number) => void;
  /** Plural noun for the summary: "orders", "sellers". */
  noun?: string;
  className?: string;
};

/**
 * Windowed page list: first and last always visible, one neighbour each
 * side of the current page, ellipsis for the gaps. Seven-or-fewer pages
 * render in full — an ellipsis hiding a single number is worse than the
 * number.
 */
function pageWindow(page: number, pages: number): Array<number | 'ellipsis'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: Array<number | 'ellipsis'> = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(pages - 1, page + 1);
  if (lo > 2) out.push('ellipsis');
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < pages - 1) out.push('ellipsis');
  out.push(pages);
  return out;
}

export default function TablePagination({
  page,
  pages,
  total,
  pageSize,
  onChange,
  noun = 'results',
  className = '',
}: TablePaginationProps) {
  // Single page → nothing to paginate; see the usage note above.
  if (pages <= 1) return null;

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <Pagination className={`w-full ${className}`} size="sm">
      <Pagination.Summary>
        {total === 0 ? `No ${noun}` : `${start} to ${end} of ${total} ${noun}`}
      </Pagination.Summary>
      <Pagination.Content>
        <Pagination.Item>
          {/* v3 buttons take onPress, not onClick. */}
          <Pagination.Previous isDisabled={page <= 1} onPress={() => onChange(page - 1)}>
            <Pagination.PreviousIcon />
            <span>Prev</span>
          </Pagination.Previous>
        </Pagination.Item>

        {pageWindow(page, pages).map((p, i) =>
          p === 'ellipsis' ? (
            /* Position-keyed: the two possible ellipses are distinguished
               by which side of the window they sit on (their index),
               since both would otherwise collide on one key. */
            <Pagination.Item key={`ellipsis-${i}`}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={p}>
              <Pagination.Link isActive={p === page} onPress={() => onChange(p)}>
                {p}
              </Pagination.Link>
            </Pagination.Item>
          ),
        )}

        <Pagination.Item>
          <Pagination.Next isDisabled={page >= pages} onPress={() => onChange(page + 1)}>
            <span>Next</span>
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  );
}
