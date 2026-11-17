/**
 * Tiny wrapper to emit a JSON-LD <script> server-side.
 *
 * Usage:
 *   <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Product', ... }} />
 *
 * Why a component instead of inlining `<script>`:
 *   - Centralised serialisation guards `<` / `</script>` injection from
 *     user-supplied strings (description, brand names, etc.).
 *   - Easy to add multiple JSON-LD blobs per page without copy-pasting
 *     the boilerplate.
 *
 * The component is a Server Component by default (no 'use client') so
 * the script ships in the initial HTML and Google sees it immediately.
 */

type AnyJsonLd = Record<string, unknown> | Record<string, unknown>[];

function escapeJsonLd(payload: AnyJsonLd): string {
  // `</script>` inside a JSON-LD block would prematurely close the
  // wrapping <script>. Escape the `<` so the JSON stays valid for both
  // the HTML parser and any consumer that re-parses it.
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

export default function JsonLd({ data }: { data: AnyJsonLd }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: escapeJsonLd(data) }}
    />
  );
}
