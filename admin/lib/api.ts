import axios from 'axios';
import { signInUrl } from './auth';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
export const UPLOADS_URL =
  process.env.NEXT_PUBLIC_UPLOADS_URL || 'http://localhost:5000/uploads';

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token =
      localStorage.getItem('admin_token') ||
      sessionStorage.getItem('admin_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;

    // ── Multi-site ──────────────────────────────────────────────────
    // Forward the sidebar's active site on EVERY request. The backend's
    // `resolveSite` middleware reads this header and scopes both the
    // query and the permission check to that property.
    //
    // Doing it here rather than per-screen is deliberate: it means the
    // ~12 site-scoped Pages/Blogs screens need no data-fetching changes
    // at all, and a screen added later is scoped correctly by default
    // instead of silently leaking main-site data.
    //
    // Read straight from localStorage rather than importing lib/site.ts
    // — that module imports lib/modules.ts, and pulling the registry
    // into every api.ts consumer is a needless dependency. The key name
    // is the one contract between the two files.
    const site = localStorage.getItem('admin_site');
    config.headers['X-Admin-Site'] = site === 'seller' ? 'seller' : 'main';
  }
  return config;
});

/** Endpoints where a rejection means "that step-up credential was wrong",
 *  NOT "your session died". Force-logging-out on those would eject the
 *  admin to /login over a single typo. The server now answers 403 for
 *  them (see adminController.impersonateSeller), so this is belt-and-
 *  braces in case an older server build is still answering 401. */
const STEP_UP_PATHS = [/\/impersonate$/, /\/security\/master-key$/];

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const url: string = err?.config?.url || '';
    if (STEP_UP_PATHS.some((re) => re.test(url))) return Promise.reject(err);
    if (typeof window !== 'undefined' && err?.response?.status === 401) {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
      sessionStorage.removeItem('admin_token');
      sessionStorage.removeItem('admin_user');
      if (!window.location.pathname.startsWith('/login')) {
        // A full navigation on purpose: this runs inside an axios
        // interceptor with no router in scope, and a hard reload also
        // drops any in-memory state from the signed-out session. The page
        // they were on comes back after signing in again.
        window.location.href = signInUrl();
      }
    }
    return Promise.reject(err);
  }
);

/**
 * The API's success envelope: `{ data, meta? }`. Endpoints move to it one
 * screen at a time (see docs/backend-conventions.md, "Responses"); a screen
 * that reads an endpoint on the envelope unwraps it here instead of
 * reaching for `r.data.data`. Older endpoints still answer the bare
 * `{ success, items, … }` shapes and are read as before.
 */
export type Envelope<T, M = Record<string, unknown>> = { data: T; meta?: M };
/** Paging meta on list answers (mirrors frontend/lib/api.ts). */
export type PageMeta = { page: number; pageSize: number; totalItems: number; totalPages: number };

export function unwrap<T>(r: { data: Envelope<T> }): T {
  return r.data.data;
}

export function unwrapMeta<T, M>(r: { data: Envelope<T, M> }): { data: T; meta: M | undefined } {
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

/**
 * The stored URL / key from a single-image upload (`{ data: { url } }`).
 * MediaPicker posts to every section's upload endpoint — CMS, blog, brands,
 * categories — and they all answer this shape.
 */
export function uploadedUrl(body: Envelope<{ url?: string }> | null | undefined): string | null {
  return body?.data?.url || null;
}

export function imageUrl(p?: string) {
  if (!p) return '';
  if (/^(data:|blob:)/i.test(p)) return p;
  // ANY absolute http(s) URL — including direct S3 and presigned S3 URLs —
  // passes through unchanged. The backend serializer mints a fresh
  // presigned URL on every request for sensitive fields (KYC docs etc.),
  // so the admin should never strip the signature out by rewriting back
  // to a /api/files proxy URL.
  if (/^https?:/i.test(p)) return p;
  const origin = UPLOADS_URL.replace(/\/uploads\/?$/, '');
  // Bare S3 keys (no leading slash) — route via /api/files/<key>.
  // Disk-stored values keep their `/uploads/<filename>` form. Without
  // this branch the URL would be malformed (no separator between origin
  // and path).
  const path = p.startsWith('/') ? p : `/api/files/${p}`;
  return `${origin}${path}`;
}
