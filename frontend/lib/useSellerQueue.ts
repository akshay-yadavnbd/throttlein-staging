"use client";

import { useCallback, useEffect, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { readListCache, writeListCache } from '@/lib/listCache';
import { useOrderPolling } from '@/lib/useOrderPolling';
import { apiMessage } from '@/lib/notify';

/** Cached seller inbox with distinct first-load and background-refresh failures. */
export function useSellerQueue<T>(endpoint: string, responseKey: string, cacheKey: string) {
  const [cached] = useState(() => readListCache<T[]>(cacheKey));
  const [rows, setRows] = useState<T[]>(cached ?? []);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const load = useCallback((quiet: boolean, signal?: AbortSignal) => api.get(endpoint, { signal })
    .then((r) => {
      if (signal?.aborted) return;
      // Seller queues answer the { data } envelope; `responseKey` names the list inside it.
      const next: T[] = unwrap<Record<string, T[] | undefined>>(r)[responseKey] || [];
      setRows(next);
      writeListCache(cacheKey, next);
      setError(null);
      setRefreshError(null);
    })
    .catch((failure) => {
      if (signal?.aborted) return;
      const message = apiMessage(failure) || 'Please check your connection and try again.';
      if (quiet) setRefreshError(message);
      else setError(message);
    })
    .finally(() => { if (!signal?.aborted) setLoading(false); }), [endpoint, responseKey, cacheKey]);

  useEffect(() => {
    const controller = new AbortController();
    void load(cached !== null, controller.signal);
    return () => controller.abort();
  }, [cached, load]);
  useOrderPolling(signal => load(true, signal), cacheKey);

  function retry() {
    setLoading(true);
    setError(null);
    setRefreshError(null);
    void load(false);
  }
  return { rows, loading, error, refreshError, retry, refresh: () => load(true) };
}
