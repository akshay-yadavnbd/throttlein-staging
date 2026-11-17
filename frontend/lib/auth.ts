export type SellerUser = {
  _id: string;
  name: string;
  email: string;
  role: 'superadmin' | 'seller' | 'customer';
  storeName?: string;
  phone?: string;
  alternatePhone?: string;
  address?: string;
  avatar?: string;
  status?: 'pending' | 'approved' | 'suspended';
  createdAt?: string;
  // Seller-configurable return/exchange windows (in days).
  returnPolicyDays?: number;
  exchangePolicyDays?: number;
  // Seller-controlled COD settings. Default codEnabled is true on the
  // backend; codCharge defaults to 0. See DashboardProfilePage for the
  // form, and orderController for the per-cart eligibility logic.
  codEnabled?: boolean;
  codCharge?: number;
  // Who pays the courier. false / undefined (the backend default) = the
  // seller absorbs it and the customer sees "Free delivery"; true = the
  // customer picks a courier at checkout and pays its rate, which is
  // credited back in the seller's weekly settlement. See
  // DashboardProfilePage ("Delivery charges" card) and
  // backend services/deliveryQuote.js.
  deliveryPaidByCustomer?: boolean;
  // Delivery exclusions — states / pincode prefixes this seller does
  // NOT ship to. See DashboardProfilePage ("Delivery area" card) and
  // orderController's checkout gate.
  excludedStates?: string[];
  excludedPincodes?: string[];
};

/**
 * Where the seller session lives depends on the "Remember me"
 * checkbox at login time:
 *   - `localStorage`   → checked  (default). Persists across restarts.
 *   - `sessionStorage` → unchecked. Cleared when the tab closes.
 *
 * Both helpers below look in localStorage first, then fall back to
 * sessionStorage so users opt-out of persistence is still recognised
 * on the same tab.
 */

const TOKEN_KEY = 'seller_token';
const USER_KEY = 'seller_user';

export function getStoredUser(): SellerUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  // Corrupt JSON here used to bubble up as a "client-side exception"
  // because any page that calls getStoredUser() on mount would throw at
  // render time. Treat unparseable storage as logged-out and clear it.
  try {
    return JSON.parse(raw) as SellerUser;
  } catch {
    try {
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(USER_KEY);
    } catch {
      /* ignore — private mode etc. */
    }
    return null;
  }
}

export function getSellerToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

/**
 * @param remember  true → localStorage (default), false → sessionStorage.
 *                  Both stores are wiped first so we don't leave stale
 *                  credentials in the OTHER store after switching modes.
 */
export function setStoredUser(token: string, user: SellerUser, remember = true) {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);

  const store = remember ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Update the cached user record without touching the token. Writes to
 * whichever store currently holds the session so we don't accidentally
 * migrate a sessionStorage-only login into localStorage.
 */
export function updateStoredUser(user: SellerUser) {
  if (typeof window === 'undefined') return;
  const store = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
  store.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  try { sessionStorage.removeItem(IMPERSONATION_KEY); } catch { /* ignore */ }
}

/* ── Admin "sign in as seller" hand-off ──────────────────────────────────
 * The admin panel and the seller dashboard are separate origins, so the
 * admin can't write this token into storage directly. It arrives in the
 * URL **fragment** (`#impersonate=…`) rather than a query string: a
 * fragment is never sent to the server, so the token can't land in
 * access logs or a Referer header. `consumeImpersonationHandoff()` moves
 * it into sessionStorage and strips it from the address bar immediately.
 *
 * sessionStorage, never localStorage — the session must die with the tab
 * rather than sit on disk next to the admin's own login.
 */
const IMPERSONATION_KEY = 'seller_impersonation';

export type ImpersonationInfo = {
  sellerName: string;
  sellerEmail: string;
  startedAt: number;
  expiresInMinutes: number;
};

/** True when this tab is an admin acting as a seller. */
export function getImpersonation(): ImpersonationInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_KEY);
    return raw ? (JSON.parse(raw) as ImpersonationInfo) : null;
  } catch {
    return null;
  }
}

/**
 * Read `#impersonate=<token>&…` if present, install the session, and
 * scrub the fragment. Returns true when a hand-off was consumed, so the
 * caller can re-read auth state.
 */
export function consumeImpersonationHandoff(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash || '';
  if (!hash.includes('impersonate=')) return false;

  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('impersonate');
  if (!token) return false;

  const info: ImpersonationInfo = {
    sellerName: params.get('name') || 'this seller',
    sellerEmail: params.get('email') || '',
    startedAt: Date.now(),
    expiresInMinutes: Number(params.get('ttl')) || 30,
  };

  try {
    // Tab-scoped so it can't outlive the window or leak to other tabs.
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(
      USER_KEY,
      JSON.stringify({ name: info.sellerName, email: info.sellerEmail, role: 'seller' }),
    );
    sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(info));
  } catch {
    return false;
  }

  // Remove the token from the address bar (and from history) right away.
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch { /* ignore */ }
  return true;
}

/**
 * Mark the current tab as a master-access-key session.
 *
 * The other way into a seller account is the master key typed straight
 * into the seller login form. The backend answers that with the same
 * impersonation token the admin hand-off uses, so the write-blocks
 * already apply — but without this marker the dashboard would look like
 * an ordinary seller login and the operator would hit confusing 403s
 * when trying to change a password. Writing the same marker makes the
 * "signed in as" banner appear for both routes.
 *
 * sessionStorage-only, to match the hand-off: the session dies with the
 * tab instead of sitting on disk.
 */
export function markMasterKeySession(info: {
  sellerName: string;
  sellerEmail: string;
  expiresInMinutes?: number;
}) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      IMPERSONATION_KEY,
      JSON.stringify({
        sellerName: info.sellerName || 'this seller',
        sellerEmail: info.sellerEmail || '',
        startedAt: Date.now(),
        expiresInMinutes: info.expiresInMinutes || 30,
      } satisfies ImpersonationInfo),
    );
  } catch { /* ignore */ }
}
