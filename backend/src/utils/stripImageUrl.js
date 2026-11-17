/**
 * stripImageUrl(value) → bare S3 key (or pass-through).
 *
 * Why this exists
 *   The response-side serializer rewrites stored S3 keys into fetchable
 *   URLs (presigned in the legacy code, stable proxy URLs after the
 *   Semrush fix). That's fine for output — but when an admin edits an
 *   image-bearing row, the form often re-submits the URL it just
 *   received in the GET response. Without normalisation the DB ends up
 *   storing absolute URLs (sometimes signed, sometimes already-expired),
 *   which compounds over every save until the document is unrecoverable.
 *
 * What it accepts and returns
 *   • Bare key            "products/123-x.png"              → unchanged
 *   • Legacy proxy path   "/api/files/products/123-x.png"   → "products/123-x.png"
 *   • Disk asset          "/uploads/123-x.png"              → unchanged
 *   • Data URI            "data:image/png;base64,..."       → unchanged
 *   • Presigned S3 URL    "https://bucket.s3....com/key?…"  → "key"
 *   • CloudFront URL      "https://cdn.x.com/products/x.png"→ "products/x.png"
 *   • Proxy URL (any host) "https://api.x.com/api/files/key" → "key"
 *   • Empty / non-string  unchanged (caller stays defensive)
 *
 * Designed to be used as a Mongoose setter so writes from any
 * controller — admin form save, importer, seed script — automatically
 * round-trip into a clean bare key.
 */
function stripImageUrl(value) {
  if (!value || typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  // Pass-through formats — already correct, or not ours to interpret.
  if (trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('/uploads/')) return trimmed;

  // Absolute http(s) — pull out the path, drop the query string, then
  // strip any leading `/api/files/` proxy prefix. The remainder is
  // the bare object key.
  if (/^https?:\/\//i.test(trimmed)) {
    let pathname;
    try {
      pathname = new URL(trimmed).pathname; // drops query + hash
    } catch {
      return trimmed; // malformed URL — leave it; nothing we can do
    }
    // Strip a leading slash and the optional `/api/files/` proxy prefix
    let key = pathname.replace(/^\/+/, '');
    key = key.replace(/^api\/files\//, '');
    return key || trimmed;
  }

  // Relative path that's NOT under /uploads/ — strip any leading
  // slashes and the proxy prefix, leaving the bare key.
  let key = trimmed.replace(/^\/+/, '');
  key = key.replace(/^api\/files\//, '');
  return key;
}

module.exports = stripImageUrl;
