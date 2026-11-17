'use client';

import { useState } from 'react';
import { imageUrl } from '@/lib/api';

/**
 * Small shared pieces for the customer account pages, so every page under
 * /account reads as one set: the page header (title, one line of context,
 * optional actions), the white panel, and the inline notice under a form.
 * Tokens match the seller and admin redesign (#252c32 text, #e3e7eb borders).
 */
export function AccountHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-[#252c32] sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-[#74808a]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-[#e3e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          {title && <h2 className="text-sm font-semibold text-[#252c32]">{title}</h2>}
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/** A quiet text action in a panel header (Edit, Manage, View all). */
export const panelLinkClass =
  'text-xs font-semibold text-[#53632d] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#59656f] rounded';

/** Primary and secondary buttons that match the account pages (links or buttons). */
export const primaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#191d21] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#30383f] disabled:opacity-60 disabled:pointer-events-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#59656f]';
export const secondaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#e2e7eb] bg-white px-3.5 py-2 text-xs font-semibold text-[#303942] hover:border-[#c9d1d8] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#59656f]';

/** Inline message under a form; tone "error" is announced to screen readers. */
export function Notice({ tone = 'error', children }: { tone?: 'error' | 'success'; children: React.ReactNode }) {
  const style =
    tone === 'error' ? 'border-[#f0d6d2] bg-[#fff6f4] text-[#8c3a2e]' : 'border-[#dce9c4] bg-[#f6faee] text-[#4b6b16]';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${style}`}>
      {children}
    </p>
  );
}

/** Input look for the account forms (HeroUI v2 `classNames`). */
export const accountInputClasses = {
  label: 'text-xs font-medium text-[#39434c]',
  inputWrapper:
    'h-11 min-h-11 bg-white border border-[#e2e7eb] shadow-none rounded-lg data-[hover=true]:border-[#c9d1d8] group-data-[focus=true]:!border-[#59656f]',
  input: 'text-[13px] text-[#252c32]',
  description: 'text-[11px] text-[#74808a]',
};

/** Product thumbnail; a missing or broken image falls back to a parcel icon. */
export function Thumb({ src, alt, size = 'md' }: { src?: string; alt?: string; size?: 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  const box = size === 'sm' ? 'h-11 w-11' : size === 'lg' ? 'h-16 w-16' : 'h-12 w-12';
  return (
    <div className={`${box} shrink-0 overflow-hidden rounded-lg border border-[#edf0f2] bg-[#f6f7f9] grid place-items-center`}>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl(src)} alt={alt || ''} className="h-full w-full object-cover" loading="lazy"
          onError={() => setBroken(true)}
          // An image that failed before React attached onError (first paint) is caught here.
          ref={(el) => { if (el?.complete && el.naturalWidth === 0) setBroken(true); }}
        />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5 text-[#9aa3ab]" aria-hidden>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      )}
    </div>
  );
}
