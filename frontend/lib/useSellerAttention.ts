'use client';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/lib/api';

/**
 * "What needs my hand right now" counts for the signed-in seller, from
 * GET /seller/orders/attention. One shared poll feeds every consumer —
 * the sidebar badge, the Orders-area tabs and the dashboard's Action
 * needed strip (UX audit S1 / S2 / S5) — so they can never disagree and
 * mounting three of them doesn't triple the traffic.
 */
export type SellerAttention = {
  toShip: number;
  pickupFailed: number;
  deliveryIssues: number;
  returnsPending: number;
  total: number;
};

type Listener = (a: SellerAttention | null) => void;

const INTERVAL_MS = 30_000;
let current: SellerAttention | null = null;
const listeners = new Set<Listener>();
let timer: number | null = null;
let inflight: Promise<void> | null = null;

async function fetchOnce() {
  if (inflight) return inflight;
  inflight = api
    .get('/seller/orders/attention')
    .then((r) => {
      const data = unwrap<{ counts?: Record<string, number>; total?: number }>(r);
      current = { ...data.counts, total: data.total } as SellerAttention;
      listeners.forEach((l) => l(current));
    })
    .catch(() => { /* keep the last good counts through a blip */ })
    .finally(() => { inflight = null; });
  return inflight;
}

function tick() {
  if (document.visibilityState === 'hidden') return;
  void fetchOnce();
}

function subscribe(l: Listener) {
  listeners.add(l);
  if (listeners.size === 1) {
    void fetchOnce();
    timer = window.setInterval(tick, INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    }
  };
}

/** Ask for fresh counts now — call after an action that changes them. */
export function refreshSellerAttention() {
  return fetchOnce();
}

/** `null` until the first response lands: render no badge, not "0". */
export function useSellerAttention(): SellerAttention | null {
  const [value, setValue] = useState<SellerAttention | null>(current);
  useEffect(() => subscribe(setValue), []);
  return value;
}
