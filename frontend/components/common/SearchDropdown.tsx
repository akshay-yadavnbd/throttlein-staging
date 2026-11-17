'use client';

/**
 * SearchDropdown — autocomplete search for the storefront navbar
 * (desktop). The mobile sheet (MobileSearchSheet) shares the pieces
 * exported from here: TRENDING, useSearchSuggest and SuggestionRows.
 *
 * The field: a white, bordered 44px input (same chrome as the header's
 * Login/Signup button), search icon on the left, and on the right a
 * spinner (fetching) or a clear button (typed). Pressing "/" anywhere on
 * the page focuses it; the shortcut is deliberately not advertised.
 *
 * States:
 *   - focused + empty query  → "Trending" pills.
 *   - focused + typing       → debounced 200ms fetch of /products/search-suggest,
 *                              renders thumbnail + name + category.
 *   - focused + no results   → hint row with a "Search anyway" action.
 *
 * Dismissal:
 *   - click outside (mousedown listener on document)
 *   - Escape key
 *   - route change (render-time reset on pathname)
 *   - submit (Enter, or clicking a suggestion)
 *
 * Keyboard:
 *   - ArrowDown / ArrowUp navigates the suggestion list, wrapping at ends.
 *   - Enter selects the highlighted suggestion, or — if nothing is highlighted —
 *     submits the typed query to `/products?q=<encoded>`.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';
import Arrow from '@/components/common/Arrow';

export type Suggestion = {
  _id: string;
  name: string;
  slug: string;
  image: string | null;
  category: { name: string; slug: string } | null;
};

export const TRENDING = [
  'helmets',
  'jackets',
  'gloves',
  'boots',
  'auxiliary lights',
  'mounts',
  'saddle bags',
  'crash guards',
];

/* One shared empty list, so "no suggestions" is referentially stable
   across renders (callers compare the array to spot a new result set). */
const NO_SUGGESTIONS: Suggestion[] = [];

/** Product page for a suggestion (search-suggest ships catalog.slug). */
export const suggestionHref = (s: Suggestion) => `/product/${s.slug}?id=${s._id}`;
/** Full search results for a typed query. */
export const searchHref = (q: string) => (q ? `/products?q=${encodeURIComponent(q)}` : '/products');

/**
 * Debounced /products/search-suggest for a query. `suggestions` and
 * `loading` derive from the last completed fetch, so there is no state
 * to sync in the effect; a stale response can never overwrite a newer
 * one (sequence check).
 */
export function useSearchSuggest(query: string) {
  const trimmed = query.trim();
  const [results, setResults] = useState<{ q: string; items: Suggestion[] }>({ q: '', items: [] });
  const fetchSeq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const seq = ++fetchSeq.current;
    const t = setTimeout(async () => {
      let items: Suggestion[] = [];
      try {
        const { data } = await api.get('/products/search-suggest', { params: { q } }).then(envelopeOrLegacy);
        items = Array.isArray(data?.items) ? data.items : [];
      } catch {
        items = [];
      }
      if (seq !== fetchSeq.current) return; // stale
      setResults({ q, items });
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  return {
    trimmed,
    suggestions: trimmed && results.q === trimmed ? results.items : NO_SUGGESTIONS,
    loading: !!trimmed && results.q !== trimmed,
  };
}

/** The suggestion rows: thumbnail, name, category, arrow on the highlighted one. */
export function SuggestionRows({
  suggestions, highlightedIdx, onPick, onHover, listboxId,
}: {
  suggestions: Suggestion[];
  highlightedIdx: number;
  onPick: (s: Suggestion) => void;
  onHover?: (i: number) => void;
  listboxId?: string;
}) {
  return (
    <ul id={listboxId} role="listbox" className="p-1.5">
      {suggestions.map((s, i) => (
        <li key={s._id} role="option" aria-selected={i === highlightedIdx}>
          <button
            type="button"
            onClick={() => onPick(s)}
            onMouseEnter={onHover ? () => onHover(i) : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
              i === highlightedIdx ? 'bg-[#f3f4f2]' : 'hover:bg-[#f3f4f2]'
            }`}
          >
            <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-[#eee] bg-[#f6f6f6]">
              {s.image ? <Image src={imageUrl(s.image)} alt="" fill sizes="44px" className="object-cover" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[#141414]">{s.name}</span>
              {s.category ? <span className="block truncate text-xs text-[#6b6b6b]">in {s.category.name}</span> : null}
            </span>
            <Arrow className={`shrink-0 text-[#8a8a8a] transition ${i === highlightedIdx ? 'opacity-100' : 'opacity-0'}`} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SearchIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export default function SearchDropdown() {
  const router = useRouter();
  const pathname = usePathname();

  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const { trimmed, suggestions, loading } = useSearchSuggest(query);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close and clear on route change: the dropdown lives in a sticky
  // navbar, so a navigation from a suggestion would otherwise leave it
  // open over the new page. A render-time adjustment, not an effect.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setFocused(false);
    setQuery('');
    setHighlightedIdx(-1);
  }
  // A new result set starts with nothing highlighted.
  const [seenSuggestions, setSeenSuggestions] = useState(suggestions);
  if (seenSuggestions !== suggestions) {
    setSeenSuggestions(suggestions);
    setHighlightedIdx(-1);
  }

  // Outside-click dismissal. mousedown (not click) so a click that started
  // outside but released inside doesn't accidentally keep us open.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // "/" focuses the search from anywhere that isn't already a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function reset() {
    setFocused(false);
    setQuery('');
    setHighlightedIdx(-1);
  }
  function submitTyped() {
    const q = trimmed;
    reset();
    router.push(searchHref(q));
  }
  function gotoSuggestion(s: Suggestion) {
    reset();
    router.push(suggestionHref(s));
  }
  function gotoTrending(term: string) {
    reset();
    router.push(searchHref(term));
  }
  function clear() {
    setQuery('');
    setHighlightedIdx(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setFocused(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      if (!suggestions.length) return;
      e.preventDefault();
      setHighlightedIdx((idx) => (idx + 1) % suggestions.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!suggestions.length) return;
      e.preventDefault();
      setHighlightedIdx((idx) => (idx <= 0 ? suggestions.length - 1 : idx - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIdx >= 0 && suggestions[highlightedIdx]) gotoSuggestion(suggestions[highlightedIdx]);
      else submitTyped();
    }
  }

  const showDropdown = focused;
  const trendingMode = !trimmed;
  const hasResults = suggestions.length > 0;
  const listboxId = 'site-search-suggestions';

  return (
    <div ref={wrapRef} className="hidden lg:block relative">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (highlightedIdx >= 0 && suggestions[highlightedIdx]) gotoSuggestion(suggestions[highlightedIdx]);
          else submitTyped();
        }}
      >
        <div
          className={`relative flex h-11 w-[260px] items-center rounded-[10px] border bg-white transition xl:w-[440px] ${
            focused ? 'border-[#141414] shadow-[0_0_0_3px_rgba(20,20,20,0.08)]' : 'border-[#e0e0e0] hover:border-[#a8a8ad]'
          }`}
        >
          <span className={`pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 transition ${focused ? 'text-[#141414]' : 'text-[#6b6b6b]'}`}>
            <SearchIcon className="h-[18px] w-[18px]" />
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={onKeyDown}
            placeholder="Search parts, gear, brands…"
            role="combobox"
            aria-label="Search the store"
            aria-autocomplete="list"
            aria-expanded={showDropdown && !trendingMode && hasResults}
            aria-controls={listboxId}
            className="h-full w-full bg-transparent pl-10 pr-12 text-sm text-[#141414] placeholder:text-[#8a8a8a] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            autoComplete="off"
            spellCheck={false}
          />
          {/* Right slot: spinner while fetching, clear button once typed.
              (The "/" shortcut still focuses the box; it just isn't advertised.) */}
          <span className="absolute right-2 top-1/2 -translate-y-1/2">
            {loading ? (
              <span className="grid h-7 w-7 place-items-center" aria-label="Searching" role="status">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#d6d6d6] border-t-[#141414]" />
              </span>
            ) : query ? (
              <button
                type="button"
                onClick={clear}
                aria-label="Clear search"
                className="grid h-7 w-7 place-items-center rounded-md text-[#6b6b6b] transition hover:bg-[#f0f0f0] hover:text-[#141414]"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </span>
        </div>
      </form>

      {showDropdown && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-[#e5e5e5] bg-white shadow-[0_18px_40px_-16px_rgba(20,20,20,0.3)]"
          // Prevent the input's blur firing before the click on a row
          // is registered (the mousedown listener on document also
          // ignores anything inside wrapRef, so this is mostly defensive).
          onMouseDown={(e) => e.preventDefault()}
        >
          {trendingMode && (
            <div className="p-4">
              <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#8a8a8a]">Trending</div>
              <TrendingPills onPick={gotoTrending} />
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#8a8a8a]">
                <kbd className="inline-flex h-5 items-center rounded border border-[#e0e0e0] bg-[#f6f6f6] px-1.5 font-sans text-[10px]">↵</kbd>
                to search what you type
              </div>
            </div>
          )}

          {!trendingMode && loading && !hasResults && (
            <div className="px-4 py-3 text-xs text-[#6b6b6b]">Searching for &lsquo;{trimmed}&rsquo;…</div>
          )}

          {!trendingMode && hasResults && (
            <>
              <div className="max-h-[360px] overflow-y-auto">
                <SuggestionRows suggestions={suggestions} highlightedIdx={highlightedIdx} onPick={gotoSuggestion} onHover={setHighlightedIdx} listboxId={listboxId} />
              </div>
              <Link
                href={searchHref(trimmed)}
                onClick={reset}
                className="flex items-center justify-between gap-3 border-t border-[#eee] bg-[#fafafa] px-4 py-3 text-sm font-semibold text-[#141414] transition hover:bg-[#f3f4f2]"
              >
                <span className="truncate">See all results for &lsquo;{trimmed}&rsquo;</span>
                <Arrow className="shrink-0" />
              </Link>
            </>
          )}

          {!trendingMode && !loading && !hasResults && (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 truncate text-xs text-[#6b6b6b]">No quick matches for &lsquo;{trimmed}&rsquo;.</span>
              <button
                type="button"
                onClick={submitTyped}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#141414] px-3 text-xs font-semibold text-white transition hover:bg-[#2b2b2b]"
              >
                Search anyway <Arrow />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Trending terms as pills. */
export function TrendingPills({ onPick }: { onPick: (term: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TRENDING.map((term) => (
        <button
          key={term}
          type="button"
          onClick={() => onPick(term)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#e0e0e0] bg-white px-3 text-[13px] text-[#212121] transition hover:border-[#141414] hover:bg-[#f6f6f6]"
        >
          <SearchIcon className="h-3.5 w-3.5 text-[#8a8a8a]" />
          {term}
        </button>
      ))}
    </div>
  );
}

export function CloseIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
