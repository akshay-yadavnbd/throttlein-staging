/**
 * What the admin reads when something succeeds or fails — never the raw
 * API response.
 *
 * The server's `message` is shown only when it's a sentence written for
 * people (the 4xx guard rails: "This order is already deleted.",
 * "Reminder already sent · try again in 2h"). Everything else — 500s, crashes, Mongoose
 * validation dumps, "Not found - /api/…", raw ids, stack traces — is
 * replaced by our own wording, so a technical failure never leaks into
 * the UI as gibberish.
 *
 * Every toast is ONE short line, like Hive's:
 *   notifyError(e, 'Couldn’t delete the brand')   → the server's reason, else this line
 *   notifySuccess('Order deleted')
 *   apiMessage(e) || 'Fallback'                   → inline text (panels, confirms)
 */
import toast from 'react-hot-toast';

/** Server text that is clearly technical rather than written for people. */
const TECHNICAL = /(cast to|objectid|e11000|duplicate key|validation failed|path `|mongo|mongoose|typeerror|referenceerror|syntaxerror|cannot read prop|is not a function|undefined|\bnull\b|status code \d|not found - \/|invalid resource id|econn|etimedout|enotfound|socket hang up|jwt|unexpected token|internal error|server error|\bat .+\(.+:\d+:\d+\)|[{[]\s*")/i;

const FIELD_LABEL: Record<string, string> = {
  slug: 'URL', email: 'email address', phone: 'phone number', orderNumber: 'order number',
  sku: 'SKU', name: 'name', code: 'code', path: 'path', from: 'source path',
};

/** Server-written text that's safe to show (a sentence for people), else ''. */
export function serverText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw.trim();
  // "Duplicate slug: a record with that value already exists." → plain words.
  const dup = /^Duplicate (\w+):/.exec(text);
  if (dup) return `That ${FIELD_LABEL[dup[1]] || dup[1]} is already in use.`;
  if (text.length < 3 || text.length > 220 || text.includes('\n') || TECHNICAL.test(text)) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A human sentence about why a request failed, or '' when the caller's own
 * fallback says it better (server errors, unreadable or missing text).
 */
export function apiMessage(e: any): string {
  if (!e || e.code === 'ERR_CANCELED' || e.name === 'CanceledError') return '';
  if (!e.response) {
    return e.code === 'ECONNABORTED'
      ? 'The server took too long to answer. Try again.'
      : 'Can’t reach the server. Check your connection and try again.';
  }
  const status = Number(e.response.status) || 0;
  if (status >= 500) return '';
  const fromServer = serverText(e.response.data?.message ?? e.response.data?.error);
  if (fromServer) return fromServer;
  if (status === 403) return 'You don’t have permission to do this.';
  if (status === 413) return 'That file is too large.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  return '';
}

/** Like apiMessage, but always says something (inline text with no fallback of its own). */
export function errorReason(e: any): string {
  return apiMessage(e) || (Number(e?.response?.status) >= 500
    ? 'Something went wrong on our side. Try again in a moment.'
    : 'Please check the details and try again.');
}

/** Every toast is one short line — no title-plus-detail. */
function Line({ text }: { text: string }) {
  return <span style={{ fontSize: 13, lineHeight: 1.45, color: '#252c32', minWidth: 0 }}>{text}</span>;
}

/** A catalog entry (lib/messages.ts): one short line. */
export type Msg = string;

/**
 * Failure toast, one line: the server's own reason when it wrote one for
 * people ("That URL is already in use."), else what didn't happen.
 */
export function notifyError(e: any, msg: Msg) {
  if (e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError') return;
  return toast.error(<Line text={apiMessage(e) || msg} />, { duration: 5000 });
}

export function notifySuccess(msg: Msg) {
  return toast.success(<Line text={msg} />, { duration: 3500 });
}

/** Amber "take note" mark — a warning is an expected state, not a failure, so it is never red. */
function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden style={{ flex: 'none' }}>
      <circle cx="10" cy="10" r="10" fill="#c98a1b" />
      <path d="M10 5.5v5.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="14.2" r="1.15" fill="#fff" />
    </svg>
  );
}

/** A message we wrote ourselves (validation, expected-but-notable states), one line. */
export function notifyWarning(msg: Msg) {
  return toast(<Line text={msg} />, { icon: <WarningIcon />, duration: 5000 });
}
