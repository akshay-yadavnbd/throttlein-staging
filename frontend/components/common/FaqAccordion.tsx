'use client';

import { useState, type ReactNode } from 'react';

/**
 * Single-open FAQ accordion.
 *
 * Extracted from `SellPage.tsx`, where it lived as a local `FaqList`.
 * There were already two hand-rolled accordions in the codebase (the
 * other in `FaqsPage.tsx`, two-level); this is the shared one so a third
 * copy doesn't appear. Visual language matches the Figma FAQ block:
 * rounded-2xl, `#e0e0e0` border, open card fills `#EEE`, plus/cross
 * toggle on the right.
 *
 * `answers` accepts plain strings. If you need rich text, render it
 * outside and pass a node — don't add `dangerouslySetInnerHTML` here.
 */
/** `a` accepts a plain string or a pre-rendered node (e.g. a RichTextView
 *  for CMS HTML answers) — per the note above, HTML never renders here. */
export type FaqItem = { q: string; a: ReactNode };

export default function FaqAccordion({
  items,
  /** Index open on first render. Pass `null` for all-closed. */
  defaultOpen = 0,
}: {
  items: FaqItem[];
  defaultOpen?: number | null;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(defaultOpen);

  return (
    <div className="flex flex-col gap-4">
      {items.map((it, i) => {
        const open = openIdx === i;
        return (
          <div
            key={it.q}
            className={`rounded-2xl border border-[#e0e0e0] transition ${
              open ? 'bg-[#EEE]' : 'bg-white hover:bg-[#F5F5F5]'
            }`}
          >
            <button
              type="button"
              onClick={() => setOpenIdx(open ? null : i)}
              className="w-full flex items-center justify-between gap-4 p-4 sm:px-6 sm:py-4 text-left"
              aria-expanded={open}
            >
              <span className="font-poppins text-base leading-[1.52] text-[#141414] font-semibold">
                {it.q}
              </span>
              <span className="shrink-0 w-6 h-6 text-[#141414]">
                {open ? <CrossIcon /> : <PlusIcon />}
              </span>
            </button>
            {open && (
              <div className="p-4 pt-0 sm:px-6 sm:pb-4 -mt-1 font-poppins text-sm text-[#575757] leading-[1.52]">
                {it.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PlusIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CrossIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
