/**
 * Small, safe renderer for the assistant's replies: **bold**, `code`,
 * bullets and GitHub pipe tables (drawn with HeroUI's Table). Everything
 * else is plain text — no HTML from the model is ever injected.
 */
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Chip, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@heroui/react';
import type { ColumnKind } from './types';

/* ---------- inline text ---------- */

export function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) parts.push(<b key={i++} className="font-semibold">{m[1]}</b>);
    else parts.push(<code key={i++} className="rounded bg-[#f3efff] px-1.5 py-px text-[13px] text-[#5b21b6]">{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/* ---------- shared cell helpers (also used by the paginated list table) ---------- */

export function money(v: unknown): string {
  const n = Number(v);
  return v == null || v === '' || Number.isNaN(n) ? '' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function statusColor(v: unknown): 'success' | 'warning' | 'danger' | 'default' {
  const s = String(v || '');
  if (/publish|active|live|deliver|paid|success|in stock/i.test(s)) return 'success';
  if (/out|cancel|fail|reject|unpublish|inactive|rto/i.test(s)) return 'danger';
  if (/draft|pending|placed|low|process|confirm/i.test(s)) return 'warning';
  return 'default';
}

// "Active"-type statuses get a fresh green chip with a small dot (instead of the theme's muted green).
const ACTIVE_CHIP = { base: 'h-6 gap-1 border border-[#bbf7d0] bg-[#dcfce7] pl-1.5', content: 'px-0.5 text-[11.5px] font-semibold capitalize text-[#15803d]', dot: 'h-1.5 w-1.5 bg-[#22c55e]' };

export function StatusChip({ value }: { value: unknown }) {
  if (statusColor(value) === 'success') {
    return (
      <Chip size="sm" variant="dot" classNames={ACTIVE_CHIP}>
        {String(value).replace(/[*`_]/g, ' ').trim()}
      </Chip>
    );
  }
  return (
    <Chip size="sm" variant="flat" color={statusColor(value)} classNames={{ base: 'h-6', content: 'px-1.5 text-[11.5px] font-medium capitalize' }}>
      {String(value).replace(/[*`_]/g, ' ').trim()}
    </Chip>
  );
}

export const CELL_CLASS: Record<ColumnKind | 'label' | 'idx', string> = {
  name: 'font-medium min-w-[200px] whitespace-normal',
  code: 'font-mono text-xs text-[#3d3d38] min-w-[150px] whitespace-normal break-words',
  num: 'text-right tabular-nums whitespace-nowrap',
  money: 'text-right tabular-nums whitespace-nowrap',
  status: 'whitespace-nowrap',
  text: 'min-w-[120px] whitespace-normal',
  label: 'w-[34%] text-[#6b6b65] font-medium bg-[#fafaf7]',
  idx: 'w-px text-right text-[#9a9a94] tabular-nums whitespace-nowrap',
};
export const HEAD_CLASS = 'bg-[#f5f3ff] text-[#5b21b6] text-[11px] font-semibold uppercase tracking-wide';
export const MIN_WIDTH: Record<ColumnKind, number> = { name: 220, code: 170, num: 80, money: 100, status: 110, text: 140 };

/* ---------- markdown tables ---------- */

function cells(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1');
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}
const isSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line) || (line.includes('|') && cells(line).length > 1);
const NUM = /^[-+]?\s*(₹|Rs\.?|\$)?\s*[\d,]+(\.\d+)?\s*(%|units?|pcs|g|kg)?$/i;

function MarkdownTable({ head, rows: raw }: { head: string[]; rows: string[][] }) {
  const n = head.length;
  // A name containing "|" splits into extra cells: fold the surplus back into the first column.
  const rows = raw.map((r) => {
    let row = r.slice();
    if (row.length > n) row = [row.slice(0, row.length - n + 1).join(' | '), ...row.slice(row.length - n + 1)];
    while (row.length < n) row.push('');
    return row;
  });
  const kv = n === 2 && /^(field|detail|property|attribute|key|item)s?$/i.test(head[0]);
  const kinds = head.map((h, c): ColumnKind | 'label' => {
    if (kv) return c === 0 ? 'label' : 'text';
    const vals = rows.map((r) => r[c].replace(/`/g, '')).filter((v) => v && v !== '—' && v !== '-');
    if (vals.length && vals.every((v) => NUM.test(v))) return 'num';
    if (/sku|code|id$/i.test(h) || (vals.length && vals.every((v) => /^\S+$/.test(v) && v.length > 6))) return 'code';
    if (/status|state/i.test(h)) return 'status';
    return c === 0 ? 'name' : 'text';
  });
  const minWidth = kinds.reduce((a, k) => a + (k === 'label' ? 120 : MIN_WIDTH[k]), 0);

  return (
    <Table
      aria-label="Table"
      isHeaderSticky
      isStriped
      radius="md"
      shadow="none"
      classNames={{
        base: 'my-2',
        wrapper: 'p-0 border border-[#e9e5fb] bg-white/90 max-h-[min(60vh,440px)] overflow-auto rounded-[10px]',
        table: 'text-[13px] min-w-[var(--tmin)]',
        th: HEAD_CLASS,
        td: 'py-2 align-middle group-data-[odd=true]/tr:before:!bg-[#f8f6ff]',
      }}
      style={{ '--tmin': `${minWidth}px` } as CSSProperties}
    >
      <TableHeader>
        {head.map((h, i) => (
          <TableColumn key={i} className={kinds[i] === 'num' ? 'text-right' : undefined}>
            <Inline text={h} />
          </TableColumn>
        ))}
      </TableHeader>
      <TableBody>
        {rows.map((r, ri) => (
          <TableRow key={ri}>
            {r.map((v, ci) => (
              <TableCell key={ci} className={CELL_CLASS[kinds[ci]]}>
                {!v ? <span className="text-[#b0b0aa]">—</span> : kinds[ci] === 'status' ? <StatusChip value={v} /> : <Inline text={v} />}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* ---------- whole message ---------- */

type Block = { kind: 'text'; lines: string[] } | { kind: 'table'; head: string[]; rows: string[][] };

export function hasMarkdownTable(md: string): boolean {
  const lines = md.split('\n');
  return lines.some((l, i) => isRow(l) && i + 1 < lines.length && isSep(lines[i + 1]));
}

/** Renders a reply. `skipTables` drops model-written tables when a real paged table is attached. */
export function Markdown({ text, skipTables = false }: { text: string; skipTables?: boolean }) {
  const lines = String(text).split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(lines[i]);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && isRow(lines[i]) && !isSep(lines[i])) rows.push(cells(lines[i++]));
      if (!skipTables) blocks.push({ kind: 'table', head, rows });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'text') last.lines.push(lines[i]);
    else blocks.push({ kind: 'text', lines: [lines[i]] });
    i++;
  }
  // Trim blank lines that only separated a text block from a table.
  for (const b of blocks) if (b.kind === 'text') { while (b.lines.length && !b.lines[0].trim()) b.lines.shift(); while (b.lines.length && !b.lines[b.lines.length - 1].trim()) b.lines.pop(); }

  return (
    <>
      {blocks.map((b, bi) => (b.kind === 'table'
        ? <MarkdownTable key={bi} head={b.head} rows={b.rows} />
        : b.lines.length ? (
          <div key={bi} className="whitespace-pre-wrap break-words">
            {b.lines.map((l, li) => {
              const bullet = /^\s*[-*•]\s+(.*)$/.exec(l);
              return (
                <Fragment key={li}>
                  {li > 0 && '\n'}
                  {bullet ? <>• <Inline text={bullet[1]} /></> : <Inline text={l} />}
                </Fragment>
              );
            })}
          </div>
        ) : null))}
    </>
  );
}
