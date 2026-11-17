/**
 * Client-side checks for the customer auth forms. Each returns '' when
 * the value is fine, otherwise the sentence to show under the field.
 * Rules mirror the backend (authController: password 12–72 bytes);
 * phone is an Indian mobile number because that is where we deliver.
 */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX_BYTES = 72;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INDIAN_MOBILE_RE = /^(?:\+?91|0)?[6-9]\d{9}$/;

export function validateName(v: string): string {
  const s = v.trim();
  if (!s) return 'Enter your name.';
  if (s.length < 2) return 'Enter your full name.';
  return '';
}

export function validateEmail(v: string): string {
  const s = v.trim();
  if (!s) return 'Enter your email address.';
  if (!EMAIL_RE.test(s)) return 'That doesn’t look like an email address.';
  return '';
}

/** Optional field: empty is fine, anything typed must be a valid Indian mobile. */
export function validatePhone(v: string): string {
  const s = v.replace(/[\s\-().]/g, '');
  if (!s) return '';
  if (!INDIAN_MOBILE_RE.test(s)) return 'Enter a 10-digit Indian mobile number (starts with 6–9).';
  return '';
}

/**
 * What a phone field keeps as the person types or pastes: digits only,
 * a pasted "+91 98765 43210" or "09876543210" collapsed to its 10-digit
 * mobile, never more than 10 digits. Letters are dropped on the spot,
 * so the field can't hold anything the validator would reject for
 * format; only the first-digit rule (6–9) is left to the message.
 */
export function phoneDigits(v: string): string {
  let d = v.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

export function validatePassword(v: string): string {
  if (!v) return 'Enter a password.';
  if (v.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(v).length > PASSWORD_MAX_BYTES) return 'That password is too long.';
  return '';
}

export function validateConfirm(password: string, confirm: string): string {
  if (!confirm) return 'Confirm your password.';
  if (password !== confirm) return 'Passwords do not match.';
  return '';
}

/**
 * 0–3 strength score for the meter: length, then letter/number/symbol
 * variety. Advisory only; the server enforces length alone.
 */
export function passwordStrength(v: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!v) return { score: 0, label: '' };
  let score = 0;
  if (v.length >= PASSWORD_MIN) score += 1;
  if (/[a-z]/i.test(v) && /\d/.test(v)) score += 1;
  if (v.length >= 16 || /[^a-z0-9]/i.test(v)) score += 1;
  const s = Math.min(3, score) as 0 | 1 | 2 | 3;
  return { score: s, label: s <= 1 ? 'Weak' : s === 2 ? 'Good' : 'Strong' };
}
