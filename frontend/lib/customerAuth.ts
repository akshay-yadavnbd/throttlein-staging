/**
 * Customer (buyer) auth — stored under separate localStorage keys so it
 * can coexist with the seller session if needed.
 *
 * Where the session is kept depends on the "Remember me" checkbox at
 * login time:
 *   - `localStorage`   → checked (default).  Survives browser restart.
 *   - `sessionStorage` → unchecked.          Cleared when the tab closes.
 *
 * Both helpers below look in localStorage first, then sessionStorage,
 * so a session created either way is recognised on mount.
 */
export type CustomerUser = {
  _id: string;
  name: string;
  email: string;
  role: 'superadmin' | 'seller' | 'customer';
  phone?: string;
  status?: 'pending' | 'approved' | 'suspended';
  createdAt?: string;
};

const TOKEN_KEY = 'customer_token';
const USER_KEY = 'customer_user';

export function getStoredCustomer(): CustomerUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  // Corrupt JSON here used to bubble up as an "Application error" toast in
  // the customer shell — any page that calls getStoredCustomer() on mount
  // would crash. Treat unparseable storage as "logged-out" instead.
  try {
    return JSON.parse(raw) as CustomerUser;
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

export function getCustomerToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

/**
 * @param remember  true → localStorage (default). false → sessionStorage.
 *                  Both stores are wiped first so we don't end up with
 *                  stale credentials in the OTHER store when the user
 *                  toggles the checkbox between sessions.
 */
export function setStoredCustomer(token: string, user: CustomerUser, remember = true) {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);

  const store = remember ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Update the user record (e.g. after profile edit). Writes to whichever
 * store currently holds the session so a `remember=false` login isn't
 * accidentally promoted to localStorage.
 */
export function updateStoredCustomer(user: CustomerUser) {
  if (typeof window === 'undefined') return;
  const store = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
  store.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Replace just the token, keeping the session in whichever store already
 * holds it. Used after a password change: the server revokes every token
 * issued before the change (session-generation check in the API's auth
 * middleware) and returns a fresh one for THIS device, so without this
 * the user would be signed out of the tab they just used.
 */
export function updateStoredCustomerToken(token: string) {
  if (typeof window === 'undefined' || !token) return;
  const store = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
}

export function clearStoredCustomer() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}
