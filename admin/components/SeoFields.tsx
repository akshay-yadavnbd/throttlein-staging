'use client';

/**
 * Shared SEO editing primitives — the character counters and the Google
 * result preview used by every page that edits meta — so the static-route
 * editor and the home-page editor teach the admin the same thing about
 * the same job, with one set of limits.
 */
import { Counter } from '@/components/EditorShell';
import form from '@/components/AdminForm.module.css';

/* Google truncates by pixel width, not characters, but character counts
   are the workable proxy every SEO tool uses. These are the widely-cited
   safe ceilings. */
export const TITLE_MAX = 60;
export const DESC_MAX = 160;

/** Live character counter: neutral while empty, green in range, amber near the ceiling, red once Google would truncate. */
export function CharCount({ value, max }: { value: string; max: number }) {
  const n = (value || '').trim().length;
  const tone = n === 0 ? '' : n > max ? form.counterOver : n > max * 0.9 ? form.counterWarn : form.counterOk;
  return <b className={`${form.counter} ${tone}`} style={{ marginTop: 0 }}>{n}/{max}{n > max && ' · will be cut off'}</b>;
}

/** Counter paired with its guidance line — the row that sits under a field. */
export function FieldMeta({ hint, value, max }: { hint: string; value: string; max: number }) {
  return <Counter value={value} max={max} hint={hint} />;
}

/**
 * Google SERP preview: title / description / URL roughly as Google shows
 * them, including the truncation — so the counters have a visible
 * consequence. Blank fields show what the storefront falls back to.
 */
export function SerpPreview({
  title, description, route, origin, fallbackTitle,
}: {
  title: string;
  description: string;
  route: string;
  origin: string;
  /** Shown (italic) when `title` is blank — the value the storefront
   *  would actually fall back to, when the caller knows it. */
  fallbackTitle?: string;
}) {
  const t = (title || '').trim();
  const d = (description || '').trim();
  const blankTitle = fallbackTitle?.trim() || 'Using the built-in default title';
  const shownTitle = t
    ? (t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX)}…` : t)
    : blankTitle;
  const shownDesc = d
    ? (d.length > DESC_MAX ? `${d.slice(0, DESC_MAX)}…` : d)
    : 'Using the built-in default description.';
  const prettyUrl = `${origin.replace(/^https?:\/\//, '').replace(/\/$/, '')}${route === '/' ? '' : route}`;

  return (
    <div className={form.preview}>
      <div className={form.previewLabel}>Search preview</div>
      {/* Deliberately not on the panel's tokens — this simulates Google's
          own result styling, so it uses Google's colours. */}
      <div className="rounded-lg border border-[#e3e7eb] bg-white p-3 font-sans">
        <div className="truncate text-xs text-[#202124]">{prettyUrl}</div>
        <div className={`mt-0.5 text-[17px] leading-snug ${t ? 'text-[#1a0dab]' : 'italic text-[#5f6368]'}`}>{shownTitle}</div>
        <div className={`mt-0.5 text-[13px] leading-relaxed ${d ? 'text-[#4d5156]' : 'italic text-[#80868b]'}`}>{shownDesc}</div>
      </div>
    </div>
  );
}
