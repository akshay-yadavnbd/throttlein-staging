/**
 * One arrow for every seller-dashboard link and CTA.
 *
 * Text glyphs (←, →, ↗) rendered at the font's whim — different weights,
 * baselines and sizes from one page to the next, and bolder than the
 * SVG icons sitting in the buttons beside them. This is a 1em stroke
 * icon that inherits colour and sits on the text baseline, so "Back to
 * orders", "View payouts" and "Next" all point the same way.
 *
 *   right     → forward navigation inside the dashboard
 *   left      → back links
 *   up-right  → opens in a new tab (storefront, documents)
 */
export default function Arrow({
  dir = 'right',
  className = '',
}: {
  dir?: 'right' | 'left' | 'up-right';
  className?: string;
}) {
  const d = dir === 'left' ? 'M19 12H5m7 7-7-7 7-7' : dir === 'up-right' ? 'M7 17 17 7M8 7h9v9' : 'M5 12h14m-7-7 7 7-7 7';
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 align-[-0.125em] ${className}`}
    >
      <path d={d} />
    </svg>
  );
}
