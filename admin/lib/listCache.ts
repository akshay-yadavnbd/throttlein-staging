'use client';

/**
 * Last-known list results, so a screen you come back to paints at once
 * from what it showed last time and then refreshes quietly (UX audit X5).
 *
 * Memory first (instant within a session), sessionStorage behind it
 * (survives a full reload and back/forward, dies with the tab). Nothing
 * here is authoritative: every consumer still fetches on mount; the
 * cache only decides whether that fetch shows a skeleton or not.
 *
 * Kept byte-identical between admin/lib and frontend/lib
 * (scripts/check-theme-sync.js).
 */

type Entry = { at: number; data: unknown };

const PREFIX = 'tin:list:';
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
const mem = new Map<string, Entry>();

function storage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

/** The cached rows for `key`, or null when absent or older than `maxAgeMs`. */
export function readListCache<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE_MS): T | null {
  let entry = mem.get(key);
  if (!entry) {
    try {
      const raw = storage()?.getItem(PREFIX + key);
      if (raw) { entry = JSON.parse(raw) as Entry; mem.set(key, entry); }
    } catch { /* corrupt or blocked storage — behave as a miss */ }
  }
  if (!entry || Date.now() - entry.at > maxAgeMs) return null;
  return entry.data as T;
}

/** Remember `data` for `key`. Large payloads that don't fit stay memory-only. */
export function writeListCache(key: string, data: unknown): void {
  const entry: Entry = { at: Date.now(), data };
  mem.set(key, entry);
  try { storage()?.setItem(PREFIX + key, JSON.stringify(entry)); } catch { /* quota or private mode */ }
}

/** Drop one key (after a mutation that makes the old rows misleading). */
export function clearListCache(key: string): void {
  mem.delete(key);
  try { storage()?.removeItem(PREFIX + key); } catch { /* ignore */ }
}
