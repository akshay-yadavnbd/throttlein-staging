'use client';

/**
 * Pieces every content editor (blog post, page, guide, home sections…)
 * is built from, in the workspace look: the page wrapper with the module
 * tabs, the back link, the identity header (same panel as the seller and
 * brand screens), loading skeleton, and the small building blocks the
 * form bodies share — labelled fields for non-HeroUI controls, character
 * counters, icon buttons, the dashed "add" button and accordion rows.
 *
 * Styles live in AdminForm.module.css (`form.*`) and the seller detail
 * module (`shared.*`), so an editor only needs these plus AdminInput /
 * AdminTextarea / AdminButton.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import ModuleTabs from '@/components/ModuleTabs';
import list from '@/components/WorkspaceList.module.css';
import form from '@/components/AdminForm.module.css';
import shared from '@/app/sellers/[slug]/detail.module.css';

export function EditorPage({ moduleKey, children }: { moduleKey?: string; children: ReactNode }) {
  return (
    <div className={list.page}>
      {moduleKey && <ModuleTabs moduleKey={moduleKey} />}
      {children}
    </div>
  );
}

export function BackLink({ href, onClick, children }: { href?: string; onClick?: () => void; children: ReactNode }) {
  if (href) return <Link href={href} className={shared.back}><IconBack /> {children}</Link>;
  return <button type="button" className={shared.back} onClick={onClick}><IconBack /> {children}</button>;
}

/** Identity header: avatar/icon, title with status chips, meta line, actions on the right. */
export function EditorHeader({
  icon, image, title, chips, meta, actions,
}: {
  icon?: ReactNode;
  /** Image URL for the avatar slot; takes precedence over `icon`. */
  image?: string;
  title: ReactNode;
  chips?: ReactNode;
  meta?: ReactNode[];
  actions?: ReactNode;
}) {
  return (
    <section className={`${shared.panel} ${shared.summary}`}>
      <span className={shared.avatar} aria-hidden style={image ? { background: 'white', border: '1px solid #e9edf0' } : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image ? <img src={image} alt="" /> : icon}
      </span>
      <div className={shared.who}>
        <h1>{title}{chips}</h1>
        {meta && meta.filter(Boolean).length > 0 && (
          <div className={shared.meta}>{meta.filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}</div>
        )}
      </div>
      {actions}
    </section>
  );
}

export function EditorSkeleton({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className={shared.skeleton} role="status" aria-label={label}>
      <span style={{ width: 120, height: 34, marginBottom: 20 }} />
      <span style={{ height: 92, marginBottom: 16 }} />
      <div className={form.layout}>
        <span style={{ height: 520 }} />
        <span style={{ height: 260 }} />
      </div>
    </div>
  );
}

/** Label + optional help for controls that don't carry their own (rich text, image tiles, native selects). */
export function Field({
  label, hint, required, htmlFor, children, className,
}: {
  label: ReactNode; hint?: ReactNode; required?: boolean; htmlFor?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={`${form.field} ${className || ''}`}>
      <label className={form.label} htmlFor={htmlFor}>{label}{required && <span className={form.required}> *</span>}</label>
      {children}
      {hint && <p className={form.help}>{hint}</p>}
    </div>
  );
}

/** Character counter under a meta field: neutral empty, green in range, amber near, red over. */
export function Counter({ value, max, hint }: { value: string; max: number; hint?: string }) {
  const n = (value || '').trim().length;
  const tone = n === 0 ? '' : n > max ? form.counterOver : n > max * 0.9 ? form.counterWarn : form.counterOk;
  return (
    <div className={form.counter}>
      <span>{hint}</span>
      <b className={tone}>{n}/{max}{n > max && ' · will be cut off'}</b>
    </div>
  );
}

export function IconButton({
  label, onClick, disabled, danger, children,
}: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={`${form.iconBtn} ${danger ? form.iconDanger : ''}`} onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {children}
    </button>
  );
}

export function AddButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" className={form.addRow} onClick={onClick} disabled={disabled}><IconPlus /> {children}</button>;
}

/** Move up / move down / remove, for repeater rows. */
export function RowTools({
  index, count, onMove, onRemove, noun = 'row',
}: { index: number; count: number; onMove?: (dir: -1 | 1) => void; onRemove: () => void; noun?: string }) {
  return (
    <div className={form.rowTools}>
      {onMove && <IconButton label={`Move ${noun} up`} disabled={index === 0} onClick={() => onMove(-1)}><IconUp /></IconButton>}
      {onMove && <IconButton label={`Move ${noun} down`} disabled={index === count - 1} onClick={() => onMove(1)}><IconDown /></IconButton>}
      <IconButton label={`Remove ${noun}`} danger onClick={onRemove}><IconTrash /></IconButton>
    </div>
  );
}

/** Collapsible row: numbered title bar with tools, body only when open. */
export function AccordionRow({
  open, onToggle, num, title, meta, tools, children,
}: {
  open: boolean; onToggle: () => void; num?: ReactNode; title: ReactNode; meta?: ReactNode; tools?: ReactNode; children: ReactNode;
}) {
  return (
    <div className={form.acc}>
      <div className={form.accHead}>
        <button type="button" className={form.accToggle} onClick={onToggle} aria-expanded={open}>
          <IconChevron />
          {num !== undefined && <span className={form.accNum}>{num}</span>}
          <span className={form.accTitle}>{title}</span>
          {meta && <span className={form.accMeta}>{meta}</span>}
        </button>
        {tools}
      </div>
      {open && <div className={form.accBody}>{children}</div>}
    </div>
  );
}

/* 14px by default; containers that want them larger (header avatar,
   modal icon, empty states) override through CSS. */
const svg = { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
export function IconBack() { return <svg {...svg}><line x1="19" y1="12" x2="5" y2="12" /><polyline points="11 18 5 12 11 6" /></svg>; }
export function IconPlus() { return <svg {...svg}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
export function IconUp() { return <svg {...svg}><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>; }
export function IconDown() { return <svg {...svg}><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>; }
export function IconTrash() { return <svg {...svg}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>; }
export function IconChevron() { return <svg {...svg}><polyline points="9 6 15 12 9 18" /></svg>; }
export function IconClose() { return <svg {...svg}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
export function IconExternal() { return <svg {...svg}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>; }
export function IconDoc() { return <svg {...svg}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>; }
export function IconImage() { return <svg {...svg}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>; }
export function IconUser() { return <svg {...svg}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>; }
export function IconHome() { return <svg {...svg}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>; }
export function IconLayout() { return <svg {...svg}><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="9" y1="10" x2="9" y2="20" /></svg>; }
export function IconHelp() { return <svg {...svg}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
export function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
