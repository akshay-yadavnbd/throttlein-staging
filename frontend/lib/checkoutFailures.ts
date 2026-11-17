import axios from 'axios';
import { API_URL } from './api';

// Separate from customerApi: a telemetry 401 must never redirect checkout.
export function reportCheckoutFailure(step: string, message: string, context: {
  attemptId?: string; razorpayOrderId?: string; paymentMethod?: string; code?: string;
} = {}) {
  try {
    const token = localStorage.getItem('customer_token') || sessionStorage.getItem('customer_token');
    if (!token) return;
    void axios.post(`${API_URL}/checkout/failures`, {
      step, message: message.slice(0, 600), ...context,
    }, { timeout: 5000, headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  } catch { /* Storage/network failure must not interrupt checkout. */ }
}
