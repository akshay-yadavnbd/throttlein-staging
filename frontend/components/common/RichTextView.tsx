'use client';

/**
 * Read-only renderer for HTML produced by RichTextEditor.
 *
 * - Sanitises through DOMPurify with an allowlist matching what the
 *   editor can produce (no <script>, <iframe>, inline event handlers, etc.).
 * - Falls back to the raw string when the value doesn't contain HTML tags
 *   (older products had plain-text descriptions; we keep showing them
 *   verbatim with newlines preserved via whitespace-pre-wrap).
 * - Styles headings, lists, links, blockquote with utility classes so the
 *   rendered description matches the editor's preview.
 */

import { useMemo } from 'react';
// isomorphic-dompurify: browser build of DOMPurify on the client, a
// jsdom-backed instance during SSR. The plain `dompurify` package has no
// sanitize() without a window, which forced an unsanitised raw-HTML
// fallback into the first server response (audit A03 — stored XSS via
// seller-authored product descriptions). With this import the SAME
// allowlist runs in both environments and the raw fallback is gone.
import { sanitizeHtml } from '@/lib/sanitizeHtml';

type Props = {
  html: string;
  className?: string;
};

function looksLikeHtml(s: string) {
  // Cheap heuristic — anything containing a `<tag>` we treat as HTML.
  return /<[a-z][^>]*>/i.test(s);
}

// Wrap every <table>...</table> in a horizontally-scrollable div instead
// of letting a wide table (lots of columns, or long cell content) blow
// out the article column's width and break the page layout on narrow
// viewports. Applied to BOTH the SSR-raw and DOMPurify-sanitised strings
// so the very first paint already has the scroll wrapper, not just the
// post-hydration render. Simple regex swap (not a DOM walk) since
// content tables from the editor are never nested.
function wrapTables(html: string): string {
  return html
    .replace(/<table\b/gi, '<div class="rt-table-wrap"><table')
    .replace(/<\/table>/gi, '</table></div>');
}

/**
 * Demote any `<h1>` in admin-authored body copy to `<h2>`.
 *
 * The page that HOSTS this content already owns the document's single
 * <h1> — the product name on a product page, the category heading on a
 * listing page. The editor still offers H1 as a formatting option, so
 * an author picking it produced a second <h1> on the page (e.g.
 * /product/sena-b20 shipped "Sena B20" as the product heading AND
 * "Sena B20 Bluetooth Communication System" from inside the
 * description). Two <h1>s split the page's topical signal and is a
 * standard SEO/a11y audit finding.
 *
 * Done at RENDER time rather than by rewriting stored content: the
 * saved HTML stays exactly as the author wrote it, so nothing is lost
 * if this ever needs revisiting, and existing rows are fixed without a
 * migration. Attributes are preserved (`<h1 id="x">` → `<h2 id="x">`)
 * so heading anchors keep working.
 *
 * Only H1 is touched. Cascading the whole chain (h2→h3, h3→h4…) would
 * change the visual hierarchy of every page that already uses H2s
 * correctly, which isn't what's broken here.
 */
function demoteH1(html: string): string {
  return html
    .replace(/<h1(\s[^>]*)?>/gi, (_m, attrs) => `<h2${attrs || ''}>`)
    .replace(/<\/h1\s*>/gi, '</h2>');
}

/** All render-time HTML transforms, in order. Applied to BOTH the
 *  SSR-raw and the sanitised string so the first paint and the
 *  post-hydration render agree. */
function normalise(html: string): string {
  return wrapTables(demoteH1(html));
}

export default function RichTextView({ html, className = '' }: Props) {
  const safe = useMemo(() => {
    if (!html) return '';
    if (!looksLikeHtml(html)) return null;
    return normalise(sanitizeHtml(html));
  }, [html]);

  if (!html) {
    return (
      <div className={`text-default-500 italic ${className}`}>
        No description provided yet.
      </div>
    );
  }

  // Plain-text branch — existing products that pre-date the rich editor.
  if (safe === null) {
    return (
      <div className={`whitespace-pre-wrap leading-relaxed ${className}`}>
        {html}
      </div>
    );
  }

  return (
    <>
      <div
        className={`rt-view leading-relaxed ${className}`}
        dangerouslySetInnerHTML={{ __html: safe }}
      />
      {/* Inline styling — tracks the editor's preview so saved content
          renders identically to the form's WYSIWYG. */}
      <style jsx global>{`
        .rt-view p { margin: 0 0 0.5rem; }
        .rt-view p:last-child { margin-bottom: 0; }
        .rt-view h1 { font-size: 1.5rem; font-weight: 700; margin: 1rem 0 0.5rem; color: #141414; }
        .rt-view h2 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 0.5rem; color: #141414; }
        .rt-view h3 { font-size: 1.125rem; font-weight: 600; margin: 0.75rem 0 0.5rem; color: #141414; }
        .rt-view h4 { font-size: 1rem; font-weight: 600; margin: 0.5rem 0; color: #141414; }
        .rt-view ul { list-style: disc; padding-left: 1.25rem; margin: 0.5rem 0; }
        .rt-view ol { list-style: decimal; padding-left: 1.5rem; margin: 0.5rem 0; }
        .rt-view li { margin: 0.125rem 0; }
        .rt-view li p { margin: 0; }
        .rt-view strong { font-weight: 700; color: #141414; }
        .rt-view em { font-style: italic; }
        .rt-view u { text-decoration: underline; }
        .rt-view a {
          color: #141414;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .rt-view blockquote {
          border-left: 3px solid #e0e0e0;
          padding-left: 0.75rem;
          color: #575757;
          margin: 0.5rem 0;
          font-style: italic;
        }
        .rt-view img {
          display: block;
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          margin: 0.75rem 0;
          border: 1px solid #eee;
        }
        .rt-view s { text-decoration: line-through; }
        .rt-view pre {
          background: #141414;
          color: #f5f5f2;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.875rem;
          padding: 0.875rem 1rem;
          border-radius: 0.5rem;
          overflow-x: auto;
          margin: 0.875rem 0;
        }
        .rt-view code:not(pre code) {
          background: #f3f4f2;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.875em;
          padding: 0.1em 0.35em;
          border-radius: 0.25rem;
        }
        .rt-view hr {
          border: 0;
          border-top: 1px solid #e0e0e0;
          margin: 1.25rem 0;
        }
        /* Scroll wrapper injected by wrapTables() around every <table> —
           lets a wide table (many columns / long cell text) scroll
           horizontally within its own box instead of stretching the
           article column and breaking the page layout on narrow
           viewports. */
        .rt-view .rt-table-wrap {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin: 0.875rem 0;
          border-radius: 0.5rem;
        }
        .rt-view table {
          border-collapse: collapse;
          margin: 0;
          /* !important — Tiptap's resizable tables bake an inline
             width/min-width style (e.g. 606px) into the saved HTML,
             which would otherwise beat this rule and render the table
             narrower than the article column. */
          width: 100% !important;
          min-width: 480px;
          table-layout: auto;
        }
        .rt-view table td,
        .rt-view table th {
          border: 1px solid #e0e0e0;
          padding: 0.5rem 0.75rem;
          vertical-align: top;
          text-align: left;
        }
        .rt-view table th {
          background: #f5f5f2;
          font-weight: 700;
        }
        .rt-view table thead th {
          background: #f3f4f2;
        }
        /* Text alignment carried over from the editor (style="text-align: …") */
        .rt-view [style*="text-align: center"] { text-align: center; }
        .rt-view [style*="text-align: right"]  { text-align: right; }
        .rt-view [style*="text-align: justify"] { text-align: justify; }
      `}</style>
    </>
  );
}
