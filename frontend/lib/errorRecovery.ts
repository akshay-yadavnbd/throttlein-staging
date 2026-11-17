/**
 * What the error boundaries (app/global-error.tsx, app/error.tsx,
 * app/(storefront)/error.tsx) do with a crash besides drawing the error
 * screen.
 *
 * 1. Report it. A client crash used to reach only the visitor's console,
 *    so a Clarity recording showed the error screen with no clue why. It
 *    now sets a Clarity tag (filter recordings by `client_error`) and fires
 *    a GA4 `exception` event, both carrying the message.
 * 2. Recover from the two crashes a reload fixes:
 *    - a JS chunk that no longer exists (a tab opened before a deploy
 *      navigating into code the new build renamed);
 *    - React losing track of the DOM because Chrome's auto-translate or a
 *      browser extension rewrote it ("removeChild"/"insertBefore").
 *    The page reloads once; a second crash on the same path within a
 *    minute shows the error screen instead, so it can never loop.
 */

type ErrorLike = Error & { digest?: string };

const RELOAD_KEY = 'throttlein:error-reload';
const RELOAD_WINDOW_MS = 60_000;

const RECOVERABLE = [
  /ChunkLoadError/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Failed to execute '(removeChild|insertBefore)' on 'Node'/i,
  /The node (to be removed|before which the new node is to be inserted) is not a child of this node/i,
];

/** True for crashes a fresh page load fixes. */
export function isRecoverable(error: ErrorLike | null | undefined): boolean {
  const text = `${error?.name || ''}: ${error?.message || ''}`;
  return RECOVERABLE.some((re) => re.test(text));
}

/** Send the crash to Clarity and GA4 so it is visible beyond the visitor's console. */
export function reportClientError(error: ErrorLike | null | undefined, boundary: string): void {
  const message = `${error?.name || 'Error'}: ${error?.message || 'unknown'}`.slice(0, 250);
  try {
    const w = window as any;
    w.clarity?.('set', 'client_error', message);
    w.clarity?.('set', 'client_error_boundary', boundary);
    if (error?.digest) w.clarity?.('set', 'client_error_digest', error.digest);
    w.clarity?.('event', 'client_error');
    w.gtag?.('event', 'exception', { description: `${boundary} | ${message}`, fatal: true });
  } catch {
    // Reporting must never be the thing that fails.
  }
}

/**
 * Reload the page if the crash is one a reload fixes and this path hasn't
 * just been reloaded for it. Returns true when a reload was started.
 */
export function reloadIfRecoverable(error: ErrorLike | null | undefined): boolean {
  if (!isRecoverable(error)) return false;
  try {
    const path = window.location.pathname + window.location.search;
    const last = JSON.parse(sessionStorage.getItem(RELOAD_KEY) || 'null') as { path: string; at: number } | null;
    if (last && last.path === path && Date.now() - last.at < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // No sessionStorage (private mode, blocked): skip the reload rather than risk a loop.
    return false;
  }
  window.location.reload();
  return true;
}
