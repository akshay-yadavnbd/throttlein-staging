/**
 * A list the assistant attached to a reply (products, orders…), paged from
 * the assistant service's POST /table — the rows never pass through the
 * model, so every matching row is reachable. 10 rows per page.
 *   ‹ ›  one page   « »  two pages (clamped)   numbers  jump straight there
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import NextLink from 'next/link';
import { Button, Link, Pagination, Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@heroui/react';
import type { AssistantApi } from './api';
import type { AssistantLinks, TablePage, TableRef } from './types';
import { CELL_CLASS, HEAD_CLASS, MIN_WIDTH, StatusChip, money } from './format';

const PAGE_SIZE = 10;

interface Props {
  api: AssistantApi;
  refData: TableRef;
  /** Wide layout (full screen on desktop): show page numbers. */
  wide: boolean;
  /** Full-screen panel: let the table use more of the height. */
  tall?: boolean;
  /** Dashboard routes rows open in (product name / order number become links). */
  links?: AssistantLinks;
  /** Called after a row link is followed (lets the chat get out of the way). */
  onNavigate?: () => void;
  /** Called once when the first page has rendered (lets the chat scroll to it). */
  onFirstLoad?: () => void;
}

export default function ListTable({ api, refData, wide, tall = false, links, onNavigate, onFirstLoad }: Props) {
  const [data, setData] = useState<TablePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);
  const first = useRef(true);
  const scroller = useRef<HTMLDivElement | null>(null);

  const load = useCallback((page: number) => {
    const id = ++req.current;
    // The request counter must bump synchronously (ordering); the state
    // flip can wait a tick so the mount effect isn't setting state inline.
    Promise.resolve().then(() => { if (id === req.current) { setLoading(true); setError(null); } });
    api.table(refData, page, PAGE_SIZE)
      .then((b) => { if (id === req.current) { setData(b); scroller.current?.querySelector('.lt-scroll')?.scrollTo({ top: 0 }); } })
      .catch((e: Error) => { if (id === req.current) setError(e.message || 'Could not load this table.'); })
      .finally(() => { if (id === req.current) setLoading(false); });
  }, [api, refData]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => {
    if (data && first.current) { first.current = false; onFirstLoad?.(); }
  }, [data, onFirstLoad]);

  if (!data) {
    return (
      <div className="mt-2.5 rounded-[10px] border border-[#e9e5fb] bg-white/90 p-3.5 text-[13px] text-[#6b6b65]">
        {error ? (
          <span>{error} <Button size="sm" variant="bordered" className="ml-1.5 h-7 min-w-0" onPress={() => load(1)}>Retry</Button></span>
        ) : (
          <span className="inline-flex items-center gap-2"><Spinner size="sm" color="default" /> Loading table…</span>
        )}
      </div>
    );
  }

  const last = Math.max(1, Math.ceil(data.total / data.pageSize));
  const firstRow = (data.page - 1) * data.pageSize;
  const from = data.total ? firstRow + 1 : 0;
  const to = Math.min(data.total, firstRow + data.rows.length);
  const minWidth = 44 + data.columns.reduce((a, c) => a + (MIN_WIDTH[c.kind] || 140), 0);
  const go = (p: number) => { if (!loading && p >= 1 && p <= last && p !== data.page) load(p); };
  const jumpBtn = 'h-8 w-8 min-w-8 bg-white text-[15px]';
  // The column that opens the row: the product name, or the order number.
  const hrefOf = data.link ? links?.[data.link] : undefined;
  const linkKey = data.link === 'order' ? 'orderNumber' : 'name';

  const pager = (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1 text-[12.5px] text-[#55554f]">
      <span><b className="font-semibold text-[#1a1a1a]">{from}–{to}</b> of <b className="font-semibold text-[#1a1a1a]">{data.total.toLocaleString('en-IN')}</b></span>
      <div className="flex items-center gap-1">
        <Button isIconOnly size="sm" variant="bordered" radius="sm" className={jumpBtn} isDisabled={data.page <= 1 || loading} aria-label="Back 2 pages" title="Back 2 pages" onPress={() => go(Math.max(1, data.page - 2))}>«</Button>
        <Pagination
          size="sm"
          radius="sm"
          variant="bordered"
          showControls
          isCompact={!wide}
          siblings={wide ? 1 : 0}
          boundaries={1}
          total={last}
          page={data.page}
          onChange={go}
          isDisabled={loading}
          classNames={{ cursor: 'bg-[#141414] text-white', wrapper: 'gap-1', item: 'bg-white', prev: 'border-medium border-default bg-white', next: 'border-medium border-default bg-white' }}
        />
        <Button isIconOnly size="sm" variant="bordered" radius="sm" className={jumpBtn} isDisabled={data.page >= last || loading} aria-label="Forward 2 pages" title="Forward 2 pages" onPress={() => go(Math.min(last, data.page + 2))}>»</Button>
      </div>
    </div>
  );

  return (
    <div ref={scroller} className={`mt-2.5 transition-opacity ${loading ? 'pointer-events-none opacity-50' : ''}`}>
      <Table
        aria-label="Results table"
        isHeaderSticky
        isStriped
        shadow="none"
        radius="md"
        // Pagination only when there is more than one page.
        bottomContent={last > 1 ? pager : undefined}
        bottomContentPlacement="outside"
        style={{ '--tmin': `${minWidth}px` } as CSSProperties}
        classNames={{
          wrapper: `lt-scroll p-0 border border-[#e9e5fb] bg-white/90 overflow-auto rounded-[10px] ${tall ? 'max-h-[calc(80dvh-260px)] max-md:max-h-[calc(100dvh-260px)]' : 'max-h-[min(55vh,460px)]'}`,
          table: 'text-[13px] min-w-[var(--tmin)]',
          th: HEAD_CLASS,
          td: 'py-2 align-middle group-data-[odd=true]/tr:before:!bg-[#f8f6ff]',
        }}
      >
        <TableHeader>
          {[
            <TableColumn key="__idx" className="w-px text-right">#</TableColumn>,
            ...data.columns.map((c) => (
              <TableColumn key={c.key} className={c.kind === 'num' || c.kind === 'money' ? 'text-right' : undefined}>{c.label}</TableColumn>
            )),
          ]}
        </TableHeader>
        <TableBody emptyContent="No rows on this page.">
          {data.rows.map((r, i) => (
            <TableRow key={firstRow + i}>
              {[
                <TableCell key="__idx" className={CELL_CLASS.idx}>{firstRow + i + 1}</TableCell>,
                ...data.columns.map((c) => {
                  const v = r[c.key];
                  const empty = v == null || v === '';
                  const ref = r.ref == null ? '' : String(r.ref);
                  if (!empty && hrefOf && ref && c.key === linkKey) {
                    return (
                      <TableCell key={c.key} className={CELL_CLASS[c.kind]}>
                        <Link
                          as={NextLink}
                          href={hrefOf(ref)}
                          underline="always"
                          title={data.link === 'order' ? 'Open this order' : 'Open this product'}
                          className={`text-[13px] text-[#141414] decoration-[#c4b5fd] underline-offset-[3px] hover:text-[#6d28d9] hover:decoration-[#7c3aed] ${c.kind === 'name' ? 'font-medium' : 'font-mono text-xs'}`}
                          onClick={(e: ReactMouseEvent) => { if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) onNavigate?.(); }}
                        >
                          {String(v)}
                        </Link>
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={c.key} className={CELL_CLASS[c.kind]}>
                      {empty ? <span className="text-[#b0b0aa]">—</span>
                        : c.kind === 'money' ? money(v)
                          : c.kind === 'status' ? <StatusChip value={v} />
                            : String(v)}
                    </TableCell>
                  );
                }),
              ]}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
