/**
 * One way to write a date (UX audit T9).
 *
 * Four formats were live on two screens — "Mon, 21 Sept, 26, 3:52 pm",
 * "21 September 2026 at 3:52 pm", "21 Sept, 3:52 pm", "31 Jul, 3:03 am".
 * Everything now reads `21 Sep 2026, 3:52 pm` (IST), or `21 Sep 2026`
 * without a time. Month names are fixed here rather than taken from the
 * locale because en-IN renders September as "Sept".
 *
 * Kept byte-identical between admin/lib and frontend/lib
 * (scripts/check-theme-sync.js).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 330 * 60 * 1000;

type DateInput = string | number | Date | null | undefined;

function partsIST(d: DateInput): { day: number; month: number; year: number; hour: number; minute: number } | null {
  if (d == null || d === '') return null;
  const date = d instanceof Date ? d : new Date(d);
  const t = date.getTime();
  if (Number.isNaN(t)) return null;
  const ist = new Date(t + IST_OFFSET_MS);
  return { day: ist.getUTCDate(), month: ist.getUTCMonth(), year: ist.getUTCFullYear(), hour: ist.getUTCHours(), minute: ist.getUTCMinutes() };
}

/** `21 Sep 2026` */
export function formatDate(d: DateInput): string {
  const p = partsIST(d);
  return p ? `${p.day} ${MONTHS[p.month]} ${p.year}` : '';
}

/** `3:52 pm` */
export function formatTime(d: DateInput): string {
  const p = partsIST(d);
  if (!p) return '';
  const h12 = p.hour % 12 || 12;
  return `${h12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'am' : 'pm'}`;
}

/** `21 Sep 2026, 3:52 pm` */
export function formatDateTime(d: DateInput): string {
  const date = formatDate(d);
  return date ? `${date}, ${formatTime(d)}` : '';
}

/** `21 Sep` — for dense lists where the year is obvious. */
export function formatDayMonth(d: DateInput): string {
  const p = partsIST(d);
  return p ? `${p.day} ${MONTHS[p.month]}` : '';
}
