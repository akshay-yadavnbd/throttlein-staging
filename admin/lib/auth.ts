export type AdminUser = {
  _id: string;
  name: string;
  email: string;
  role: 'superadmin' | 'staff' | 'seller' | 'customer';
  /** Module-level access for staff users. Empty / absent for the
   *  superadmin (who has implicit access to everything). */
  permissions?: string[];
};

/**
 * Module-key helper — returns true when the given user can access an
 * admin module identified by its permission key. Used by AdminShell
 * to filter the sidebar AND by per-page guards to bounce a staff user
 * who navigates to a route they don't own.
 */
export function hasPermission(user: AdminUser | null, perm?: string): boolean {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  if (user.role !== 'staff') return false;
  if (!perm) return true; // dashboard / no-perm-required pages
  return (user.permissions || []).includes(perm);
}

/**
 * Token + user are persisted in EITHER:
 *   - localStorage  → "Remember me" was checked (default). Survives
 *                     browser restart, persists across tabs.
 *   - sessionStorage → "Remember me" was unchecked. Cleared when the
 *                     last tab closes; not shared with other tabs.
 *
 * Both helpers below check `localStorage` first, then `sessionStorage`,
 * so a user who is signed in via either path is recognised on mount.
 */

const TOKEN_KEY = 'admin_token';
const USER_KEY = 'admin_user';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredAdmin(): AdminUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as AdminUser) : null;
}

/**
 * @param remember  When true (default) we persist to localStorage so the
 *                  session survives a browser restart. When false we use
 *                  sessionStorage so signing out is automatic once the
 *                  tab is closed — a safer default on shared machines.
 */
export function setStoredAdmin(token: string, user: AdminUser, remember = true) {
  // Always wipe both stores first so we don't leave stale credentials
  // in the OTHER store if the user previously chose a different option.
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);

  const store = remember ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(USER_KEY, JSON.stringify(user));
}

const SIGN_IN_PATHS = /^\/(?:login|staff\/login)(?:[/?#]|$)/;

/**
 * The sign-in URL that brings the person back to `from` (default: where
 * they are now) once they sign in again — used when a session ends mid-task.
 */
export function signInUrl(from?: string): string {
  const here = from ?? (typeof window === 'undefined' ? '' : window.location.pathname + window.location.search);
  return here && here !== '/' && !SIGN_IN_PATHS.test(here) ? `/login?next=${encodeURIComponent(here)}` : '/login';
}

/**
 * Where to go after signing in: the `?next=` path when it is a page inside
 * this app (never another site, never a sign-in page), else the dashboard.
 */
export function pathAfterSignIn(): string {
  if (typeof window === 'undefined') return '/dashboard';
  const next = new URLSearchParams(window.location.search).get('next') || '';
  const inApp = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && !SIGN_IN_PATHS.test(next);
  return inApp ? next : '/dashboard';
}

export function clearStoredAdmin() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}
