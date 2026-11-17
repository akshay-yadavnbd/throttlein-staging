/** Reading Shiprocket's words: its date formats (as IST) and its status labels / ids → our shipment statuses. Pure. */
const IST_OFFSET_MS = 330 * 60 * 1000;

/**
 * @param {string | number} y
 * @param {string | number} mo
 * @param {string | number} d
 * @param {string | number} [h]
 * @param {string | number} [mi]
 * @param {string | number} [s]
 */
function istToDate(y, mo, d, h = 0, mi = 0, s = 0) {
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - IST_OFFSET_MS;
  const out = new Date(t);
  return isNaN(out.getTime()) ? null : out;
}

/**
 * Parse a Shiprocket timestamp. Zone-less values are IST. Returns a Date or
 * null — never an Invalid Date (those throw on toISOString()).
 *   "2023-05-19 11:59:16"   → IST
 *   "23 05 2023 11:43:52"   → IST (current_timestamp format)
 *   "2023-05-19"            → IST midnight
 *   ISO with Z / offset     → as given
 */
function parseShiprocketDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s || /^(na|n\/a|null|not available)$/i.test(s)) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return istToDate(m[1], m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0);
  m = s.match(/^(\d{1,2})[ /-](\d{1,2})[ /-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return istToDate(m[3], m[2], m[1], m[4] || 0, m[5] || 0, m[6] || 0);
  // Order-detail dates: "23-Sep-2026", "26 Sep 2026", "24th Sep 2026 22:42 PM",
  // "21st Sep 2026 15:52 PM" (Shiprocket emits AM/PM after a 24h clock — the
  // hour is authoritative, the suffix is decoration). All IST.
  m = s.match(
    /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})[ ,-]+(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i,
  );
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) {
      let h = Number(m[4] || 0);
      if (m[7] && h < 12 && /pm/i.test(m[7])) h += 12;
      if (m[7] && h === 12 && /am/i.test(m[7])) h = 0;
      return istToDate(m[3], mo, m[1], h, m[5] || 0, m[6] || 0);
    }
  }
  // Last resort: only accept strings that carry their own zone, so a
  // zone-less value never silently takes the server's timezone.
  if (!/(Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*$/i.test(s)) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/* ── status mapping ───────────────────────────────────────────────────── */

function normLabel(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Shiprocket status LABEL → our internal slice status. Ordered: first match
 * wins (RTO rules must run before the generic DELIVERED / IN TRANSIT ones).
 * `null` means "informational, don't change status".
 * @type {Array<[RegExp, string | null]>}
 */
const LABEL_RULES = [
  [/^RTO DELIVERED$/, 'rto_delivered'],
  [/^RTO (INITIATED|ACKNOWLEDGED|LOCK)/, 'rto_initiated'],
  [/^RTO\b/, 'rto_in_transit'], // RTO IN TRANSIT / OFD / NDR / REACHED …
  [/^(DELIVERED|FULFILLED|SELF FULFILLED)$/, 'delivered'],
  [/^(UNDELIVERED|NDR)\b/, 'undelivered'],
  [/^(OUT FOR DELIVERY|OFD)$/, 'out_for_delivery'],
  [/^CANCELLATION REQUESTED$/, null],
  [/^CANCELL?ED\b/, 'cancelled'],
  [/^(LOST|UNTRACEABLE|DAMAGED|DESTROYED|DISPOSED OFF)$/, 'lost'],
  [/^PICKUP ERROR$/, 'failed'],
  [/^(NEW|PICKUP (SCHEDULED|GENERATED|QUEUED|RESCHEDULED|EXCEPTION)|OUT FOR PICKUP)$/, 'pushed'],
  [/^(AWB ASSIGNED|MANIFEST GENERATED|LABEL GENERATED)$/, 'awb'],
  [/^(PICKED UP|SHIPPED|IN TRANSIT|DELAYED|MISROUTED|IN FLIGHT|HANDOVER TO COURIER)$/, 'shipped'],
  [/^(REACHED|IN TRANSIT|CUSTOM CLEARED|CONNECTION ALIGNED)\b/, 'shipped'],
];

/**
 * Numeric fallback for shipment_status_id / scans[].sr-status, used only when
 * no label matched. Limited to codes the doc sample confirms or that every
 * published Shiprocket list agrees on.
 */
const SHIPMENT_STATUS_ID_MAP = {
  5: 'awb', // MANIFEST GENERATED
  6: 'shipped', // SHIPPED
  7: 'delivered', // DELIVERED
  8: 'cancelled', // CANCELED
  9: 'rto_initiated', // RTO INITIATED
  10: 'rto_delivered', // RTO DELIVERED
  12: 'lost', // LOST
  18: 'shipped', // IN TRANSIT
  42: 'shipped', // PICKED UP
};

/** Returns { matched, status } — matched=false means "unknown label". */
function mapLabel(label) {
  const n = normLabel(label);
  if (!n) return { matched: false, status: null };
  for (const [re, status] of LABEL_RULES) {
    if (re.test(n)) return { matched: true, status };
  }
  return { matched: false, status: null };
}

function mapShipmentStatus({ labels = [], shipmentStatusId }) {
  for (const l of labels) {
    const r = mapLabel(l);
    if (r.matched) return r.status;
  }
  return SHIPMENT_STATUS_ID_MAP[Number(shipmentStatusId)] || null;
}

/** Positive integer or undefined ("NA", "", 0 → undefined). */
function toCode(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

module.exports = { parseShiprocketDate, normLabel, mapLabel, mapShipmentStatus, toCode };
