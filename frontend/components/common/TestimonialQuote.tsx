'use client';

import RichTextView from '@/components/common/RichTextView';

/**
 * A testimonial's quote, wrapped in curly quotation marks.
 *
 * Shared by the Sell Online page and the seller-category template so the
 * two can't drift — they render the identical card from the same Figma
 * component.
 *
 * ── WHY THE QUOTE MARKS ARE CSS ──────────────────────────────────
 * The obvious markup, `&ldquo;{<RichTextView/>}&rdquo;`, does not work:
 * RichTextView emits the editor's HTML, whose top-level nodes are block
 * `<p>` elements. An inline span before a block sits on its own line, so
 * the opening mark would float above the text with the closing mark
 * orphaned below it.
 *
 * Forcing the paragraphs inline instead would fix the marks but discard
 * any paragraph break the author deliberately added. So the marks are
 * attached with ::before / ::after on the first and last child, which
 * keeps blocks as blocks and still hugs them tight to the text.
 *
 * Two selectors are needed because RichTextView has two output shapes:
 * a `.rt-view` wrapper for HTML, and a bare `whitespace-pre-wrap` div
 * for values with no tags (the built-in fallback card is plain text).
 *
 * The marks are decorative — they're `content` on a pseudo-element, so
 * they're already outside the accessibility tree and screen readers get
 * the quote itself, unpunctuated. `<blockquote>` carries the semantics.
 */
export default function TestimonialQuote({
  html,
  className = '',
}: {
  html: string;
  className?: string;
}) {
  return (
    <blockquote className={`testimonial-quote ${className}`}>
      <RichTextView html={html} />
      {/* The quote characters are written LITERALLY, not as CSS escapes.
          `content: '\\201C'` in a styled-jsx template survives into the
          stylesheet as an escaped backslash, so the page rendered the text
          "\201C" instead of a quotation mark. Embedding the character
          directly sidesteps the double-escaping entirely. */}
      <style jsx global>{`
        /* Rich-text output: mark the first and last block. */
        .testimonial-quote .rt-view > :first-child::before {
          content: '“';
        }
        .testimonial-quote .rt-view > :last-child::after {
          content: '”';
        }
        /* Plain-text output (no .rt-view wrapper) — the fallback card. */
        .testimonial-quote > div:not(.rt-view)::before {
          content: '“';
        }
        .testimonial-quote > div:not(.rt-view)::after {
          content: '”';
        }
        /* The card supplies its own vertical rhythm via flex gap; a
           trailing paragraph margin would double the gap under the quote. */
        .testimonial-quote .rt-view > :last-child {
          margin-bottom: 0;
        }
      `}</style>
    </blockquote>
  );
}
