'use client';

/**
 * MobileSearchSheet — the phone/tablet search, opened from the navbar's
 * magnifier (the desktop field is SearchDropdown).
 *
 * A full-screen sheet rather than a floating modal: a top bar with a
 * back button and the search field (auto-focused, with a clear button
 * and a spinner while fetching), then Trending pills while the query is
 * empty, live suggestions as you type (same /products/search-suggest
 * fetch and rows as desktop, via the pieces SearchDropdown exports), a
 * "See all results" action, and a "Search anyway" button when nothing
 * matches. Closes on back, Escape, picking anything, or route change.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Arrow from '@/components/common/Arrow';
import {
  CloseIcon, SearchIcon, SuggestionRows, TrendingPills, searchHref, suggestionHref, useSearchSuggest, type Suggestion,
} from '@/components/common/SearchDropdown';

export default function MobileSearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const { trimmed, suggestions, loading } = useSearchSuggest(query);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close on route change. This updates the PARENT's state (onClose), so
  // it has to happen in an effect, not during this component's render.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (open) onClose();
  }, [pathname, open, onClose]);
  // Start each opening with an empty box.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setQuery('');
  }

  // Focus the field and lock page scroll while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const go = (href: string) => { onClose(); router.push(href); };
  const pick = (s: Suggestion) => go(suggestionHref(s));
  const submit = () => go(searchHref(trimmed));
  const trendingMode = !trimmed;
  const hasResults = suggestions.length > 0;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white lg:hidden" role="dialog" aria-modal="true" aria-label="Search">
      <form
        role="search"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="flex items-center gap-2 border-b border-[#eee] px-3 py-2.5"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-[#141414] transition hover:bg-[#f3f4f2]"
        >
          <Arrow dir="left" className="text-[18px]" />
        </button>
        <div className="relative flex h-11 flex-1 items-center rounded-[10px] border border-[#141414] bg-white shadow-[0_0_0_3px_rgba(20,20,20,0.06)]">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#141414]">
            <SearchIcon className="h-[18px] w-[18px]" />
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search parts, gear, brands…"
            aria-label="Search the store"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            className="h-full w-full bg-transparent pl-10 pr-11 text-[16px] text-[#141414] placeholder:text-[#8a8a8a] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2">
            {loading ? (
              <span className="grid h-7 w-7 place-items-center" role="status" aria-label="Searching">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#d6d6d6] border-t-[#141414]" />
              </span>
            ) : query ? (
              <button
                type="button"
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                aria-label="Clear search"
                className="grid h-7 w-7 place-items-center rounded-md text-[#6b6b6b] hover:bg-[#f0f0f0] hover:text-[#141414]"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </span>
        </div>
      </form>

      <div className="flex-1 overflow-y-auto">
        {trendingMode && (
          <div className="p-4">
            <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#8a8a8a]">Trending</div>
            <TrendingPills onPick={(term) => go(searchHref(term))} />
          </div>
        )}

        {!trendingMode && loading && !hasResults && (
          <div className="px-4 py-3 text-xs text-[#6b6b6b]">Searching for &lsquo;{trimmed}&rsquo;…</div>
        )}

        {!trendingMode && hasResults && (
          <>
            <SuggestionRows suggestions={suggestions} highlightedIdx={-1} onPick={pick} />
            <button
              type="button"
              onClick={submit}
              className="flex w-full items-center justify-between gap-3 border-t border-[#eee] bg-[#fafafa] px-4 py-3 text-left text-sm font-semibold text-[#141414]"
            >
              <span className="truncate">See all results for &lsquo;{trimmed}&rsquo;</span>
              <Arrow className="shrink-0" />
            </button>
          </>
        )}

        {!trendingMode && !loading && !hasResults && (
          <div className="flex flex-col items-start gap-3 px-4 py-4">
            <span className="text-sm text-[#6b6b6b]">No quick matches for &lsquo;{trimmed}&rsquo;.</span>
            <button
              type="button"
              onClick={submit}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#141414] px-4 text-sm font-semibold text-white"
            >
              Search anyway <Arrow />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
