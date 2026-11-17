'use client';
import { useEffect, useRef } from 'react';

// Quiet refreshes keep open order pages current, pause in hidden tabs, and
// cancel stale requests on navigation. The caller owns initial loading/errors.
export function useOrderPolling(refresh: (signal: AbortSignal) => Promise<unknown>, key = '', intervalMs = 15000) {
  const latest = useRef(refresh);
  // Written after commit, not during render — the ticks below only ever
  // read it from timers and listeners.
  useEffect(() => { latest.current = refresh; });
  useEffect(() => {
    let busy = false;
    let disposed = false;
    const controller = new AbortController();
    const tick = async () => {
      if (disposed || busy || document.visibilityState === 'hidden') return;
      busy = true;
      try { await latest.current(controller.signal); }
      catch { /* preserve the last successful view during a transient failure */ }
      finally { busy = false; }
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [key, intervalMs]);
}
