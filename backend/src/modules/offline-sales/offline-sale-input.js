/** Seller-entered offline sale input: the buyer block and the history date range. Pure. */
const { AppError } = require('../../errors/AppError');

const PHONE_RE = /^\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Digits only; drop a leading +91 / 91 / 0 so "+91 98765 43210" → "9876543210". */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

function readBuyer(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  return {
    name: String(b.name || '')
      .trim()
      .slice(0, 120),
    // Letters mean it is not a phone number at all; keep it as typed so validation can say so.
    phone: /[a-z]/i.test(String(b.phone || '')) ? String(b.phone).trim().slice(0, 20) : normalizePhone(b.phone),
    email: String(b.email || '')
      .trim()
      .toLowerCase()
      .slice(0, 160),
    address: String(b.address || '')
      .trim()
      .slice(0, 500),
    state: String(b.state || '')
      .trim()
      .slice(0, 60),
  };
}

/** An error message, or null when valid. Name, phone and address are required on every invoice; email is optional. */
function validateBuyer(buyer) {
  if (!buyer.name) return 'Buyer name is required.';
  if (!buyer.phone) return 'Buyer contact number is required.';
  if (!buyer.address) return 'Buyer address is required.';
  if (!PHONE_RE.test(buyer.phone)) return 'Contact number must be exactly 10 digits.';
  if (buyer.email && !EMAIL_RE.test(buyer.email)) return 'Enter a valid email address.';
  return null;
}

/**
 * `from` / `to` (ISO strings, both inclusive) → a `saleDate` filter, or null.
 * A bare `yyyy-mm-dd` "to" parses as the START of that day, which would drop
 * every sale made on it, so date-only values use `< start of the next day`.
 */
function saleDateRange(from, to) {
  if (!from && !to) return null;
  const range = {};
  let fromDate = null;
  let toDate = null;
  if (from) {
    const d = new Date(from);
    if (Number.isFinite(d.getTime())) {
      fromDate = d;
      range.$gte = d;
    }
  }
  if (to) {
    const raw = String(to);
    const d = new Date(raw);
    if (Number.isFinite(d.getTime())) {
      toDate = d;
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const next = new Date(d);
        next.setUTCDate(next.getUTCDate() + 1);
        range.$lt = next;
      } else {
        range.$lte = d;
      }
    }
  }
  // A timestamp on the To day is still inside a date-only upper bound.
  const reversed = fromDate && toDate && (range.$lt ? fromDate >= range.$lt : fromDate > toDate);
  if (reversed) throw AppError.badRequest("'To' date can't be before 'From' date.");
  return Object.keys(range).length ? range : null;
}

/** A valid date input, else the fallback. */
function dateOr(input, fallback) {
  if (!input) return fallback;
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : fallback;
}

module.exports = { normalizePhone, readBuyer, validateBuyer, saleDateRange, dateOr };
