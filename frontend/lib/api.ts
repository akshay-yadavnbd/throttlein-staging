import axios from 'axios';
import { siteFromLocation } from './site';
import { apiMessage } from './notify';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
export const UPLOADS_URL =
  process.env.NEXT_PUBLIC_UPLOADS_URL || 'http://localhost:5000/uploads';

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    // The "Remember me" checkbox at login decides which store holds
    // the token (see lib/auth.ts). Check localStorage first — that's
    // the default — then sessionStorage for tab-scoped sessions.
    const token =
      localStorage.getItem('seller_token') ||
      sessionStorage.getItem('seller_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;

    // ── Multi-site ──────────────────────────────────────────────────
    // One JS bundle is served to BOTH throttlein.com and
    // seller.throttlein.com, so the site can't come from a build-time
    // env var — it has to be derived at runtime.
    //
    // Host AND path, not host alone: proxy.ts only rewrites `/seller/**`
    // on the real seller domain, so in local dev the seller property is
    // served from the main host under a `/seller` prefix. Using the host
    // alone there sent X-Site: main for seller pages, and every
    // post-hydration refetch 404'd on content the server had just
    // rendered correctly.
    //
    // Server components pass ?site= explicitly (they know statically
    // which property their route belongs to). This header covers the
    // client-side refetches that CMS components do after hydration —
    // without it, the seller blog would hydrate into main-site posts.
    config.headers['X-Site'] = siteFromLocation(
      window.location.host,
      window.location.pathname,
    );
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (typeof window !== 'undefined' && err?.response?.status === 401) {
      // Wipe both stores — we don't know which one held the stale
      // session, and leaving the other intact would re-auth-loop.
      localStorage.removeItem('seller_token');
      localStorage.removeItem('seller_user');
      sessionStorage.removeItem('seller_token');
      sessionStorage.removeItem('seller_user');
    }
    return Promise.reject(err);
  }
);

/**
 * Turn an axios error into something worth showing a user.
 *
 * The usual `err?.response?.data?.message || 'Something failed'` pattern
 * has a blind spot: when the request never reaches the server — dev
 * backend not running, or CORS refusing the origin because `next dev`
 * came up on an unexpected port — there IS no `response`, so every such
 * failure collapses into the generic fallback. That reads as "the server
 * rejected your input" when the truth is "we never got there", which
 * sends you looking in entirely the wrong place.
 *
 * @param err      the caught axios/network error
 * @param fallback message for a genuine server-side rejection with no body
 */
export function errorMessage(err: any, fallback = 'Something went wrong'): string {
  // Wording now lives in lib/notify: server text only when written for
  // people, our own sentences for crashes and unreachable servers.
  return apiMessage(err) || fallback;
}

/**
 * The API's success envelope: `{ data, meta? }`. Endpoints move to it one
 * screen at a time (docs/backend-conventions.md, "Responses"); a screen that
 * reads an endpoint on the envelope unwraps it here instead of reaching for
 * `r.data.data`. Endpoints not yet moved still answer their older shapes.
 * Mirrors admin/lib/api.ts.
 */
export type Envelope<T, M = Record<string, unknown>> = { data: T; meta?: M };
/** Paging meta on list answers. */
export type PageMeta = { page: number; pageSize: number; totalItems: number; totalPages: number };

export function unwrap<T>(r: { data: Envelope<T> }): T {
  return r.data.data;
}

export function unwrapMeta<T, M = PageMeta>(r: { data: Envelope<T, M> }): { data: T; meta: M | undefined } {
  return { data: r.data.data, meta: r.data.meta };
}

/**
 * Tolerant readers for endpoints that every app shares (categories, brands,
 * and the public catalogue as it moves to the envelope). They take `data`
 * out of `{ data, meta? }` and pass a legacy body through unchanged, so a
 * page keeps working whichever of frontend and backend deploys first —
 * which matters for server-rendered storefront pages and menus. For an
 * endpoint only this app reads, prefer `unwrap`: both sides ship together.
 * Paging meta (`page, pageSize, totalItems, totalPages`) comes back as the
 * legacy `page, limit, total, pages` keys beside the data.
 */
export function dataOf<T = any>(body: any): T {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const keys = Object.keys(body);
    if (keys.includes('data') && keys.every((k) => k === 'data' || k === 'meta')) {
      const { data, meta } = body;
      if (!meta || !data || typeof data !== 'object' || Array.isArray(data)) return data as T;
      // Paging meta folds back into the keys the legacy list bodies used,
      // so `data.total` / `data.pages` readers work on either shape.
      return {
        ...data,
        page: data.page ?? meta.page,
        limit: data.limit ?? meta.pageSize,
        total: data.total ?? meta.totalItems,
        pages: data.pages ?? meta.totalPages,
      } as T;
    }
  }
  return body as T;
}

/** `api.get(...).then(envelopeOrLegacy)` — the response with `data` replaced by `dataOf(data)`. */
export function envelopeOrLegacy<R extends { data: any }>(r: R): R {
  return { ...r, data: dataOf(r.data) };
}

export function imageUrl(p?: string) {
  if (!p) return '/placeholder.png';
  // data:/blob: URIs (e.g. seeded category-icon SVGs are inline data URIs)
  // pass through — gluing the backend origin in front would break the fetch.
  if (/^(data:|blob:)/i.test(p)) return p;
  // Backend origin (with /uploads stripped, since not every path is an
  // /uploads path — /api/files/<key> proxy URLs also need the same origin).
  const origin = UPLOADS_URL.replace(/\/uploads\/?$/, '');
  // Keep signed private document URLs intact; the public file proxy denies them.
  // Any other absolute http(s) URL passes through untouched —
  // including unsigned direct S3 URLs which are now the preferred
  // form for public images after the public-bucket-policy refactor.
  if (/^https?:/i.test(p)) return p;
  // Bare keys (no leading slash) come from the S3 presigning refactor —
  // route them through the proxy endpoint so the browser always has a
  // working URL regardless of whether the bucket is private/public.
  const path = p.startsWith('/') ? p : `/api/files/${p}`;
  return `${origin}${path}`;
}
