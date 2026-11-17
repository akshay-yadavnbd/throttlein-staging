'use client';

import { useState, useRef, useEffect } from 'react';
import {
  SITES,
  SITES_BY_KEY,
  type SiteKey,
} from '@/lib/site';
/* The open list wears the same menu styles as every other dropdown in
   the panel (AdminSelect / MultiPick): white panel, 1px border, compact
   rows, grey hover, lime-tinted selected row with a tick. */
import menu from '@/components/AdminSelect.module.css';

/**
 * Sidebar site switcher — picks which public property the CMS screens
 * (Pages, Blogs) are editing.
 *
 * Design notes:
 *   - Renders NOTHING when the user only has one site. A main-site-only
 *     editor sees exactly the panel they saw before multi-site shipped;
 *     no new concept is introduced for someone who doesn't need it.
 *   - The coloured dot + host line are deliberate. The failure mode this
 *     guards against is publishing to the wrong domain, which is
 *     invisible until a customer notices — so the current site is stated
 *     twice, in two different ways, right above the nav.
 *   - Changing site navigates to the module root rather than staying
 *     put: `/blogs/<id>` refers to a record that doesn't exist on the
 *     other property.
 */
export default function SiteSwitcher({
  active,
  available,
  onChange,
}: {
  active: SiteKey;
  available: SiteKey[];
  onChange: (site: SiteKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — a plain popover rather than a
  // HeroUI Dropdown so it can be styled against the dark sidebar
  // without fighting the theme.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Single-site users get no switcher at all.
  if (available.length < 2) return null;

  const current = SITES_BY_KEY[active];

  return (
    <div className="px-3 pt-3 shrink-0" ref={ref}>
      <div className="text-xs text-brand-cream/60 px-2 pb-1">
        Editing site
      </div>
      <div className="relative">
        {/* Trigger sits ON the espresso sidebar — translucent white well,
            cream text. The open list below stays a light overlay. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 border border-white/15 hover:bg-white/15 transition text-left"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${current.dotClass}`} />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-brand-cream truncate">
              {current.label}
            </span>
            <span className="block text-xs text-brand-cream/60 truncate">
              {current.host}
            </span>
          </span>
          <ChevronIcon open={open} />
        </button>

        {open && (
          <ul
            role="listbox"
            aria-label="Editing site"
            className={`${menu.popover} ${menu.listbox} absolute left-0 right-0 z-30 mt-1.5 flex flex-col`}
          >
            {SITES.filter((s) => available.includes(s.key)).map((s) => {
              const isActive = s.key === active;
              return (
                <li key={s.key} role="option" aria-selected={isActive} className={`${menu.option} flex items-center gap-2.5 cursor-pointer`}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!isActive) onChange(s.key);
                    }}
                    className="flex w-full items-center gap-2.5 text-left outline-none"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${s.dotClass}`} />
                    <span className="flex-1 min-w-0">
                      <span className={`${menu.optionText} block truncate font-medium`}>{s.label}</span>
                      <span className="block truncate text-[11px] leading-snug text-[#74808a]">{s.host}</span>
                    </span>
                    {isActive && <CheckIcon />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-brand-cream/60 transition-transform ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${menu.check}`}
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
