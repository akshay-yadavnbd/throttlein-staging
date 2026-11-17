import axios from 'axios';
import { API_URL } from '@/lib/api';
import { clearStoredCustomer } from '@/lib/customerAuth';

export const customerApi = axios.create({ baseURL: API_URL });

/**
 * Endpoints whose 401 means "that password was wrong", not "your session
 * ended" — the customer stays signed in and the form says what to fix.
 */
const PASSWORD_CHECK_PATHS = [/\/auth\/change-password$/];

customerApi.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    // "Remember me" decides where the token lives — see lib/customerAuth.ts.
    // localStorage first (the default), sessionStorage as fallback.
    const token =
      localStorage.getItem('customer_token') ||
      sessionStorage.getItem('customer_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

customerApi.interceptors.response.use(
  (r) => r,
  (err) => {
    const url: string = err?.config?.url || '';
    if (PASSWORD_CHECK_PATHS.some((re) => re.test(url))) return Promise.reject(err);
    if (typeof window !== 'undefined' && err?.response?.status === 401) {
      clearStoredCustomer();
      if (!window.location.pathname.startsWith('/signin')) {
        // Back to the same page after signing in again. A full navigation on
        // purpose: an interceptor has no router, and a reload drops the ended
        // session's in-memory state.
        const here = window.location.pathname + window.location.search;
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = `/signin?returnTo=${encodeURIComponent(here)}`;
      }
    }
    return Promise.reject(err);
  }
);
