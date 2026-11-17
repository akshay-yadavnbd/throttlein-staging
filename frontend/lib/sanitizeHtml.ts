import DOMPurify from 'isomorphic-dompurify';

/** The same allowlist runs during server rendering and in the browser. */
export function sanitizeHtml(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'span', 'div'],
    ALLOWED_ATTR: ['href', 'rel', 'src', 'alt', 'title', 'width', 'height', 'loading', 'class', 'colspan', 'rowspan', 'scope', 'colwidth', 'id'],
    ALLOW_DATA_ATTR: false,
    // Inline CSS is not sanitized by DOMPurify and can overlay a fake login.
    FORBID_ATTR: ['style'],
  });
}
