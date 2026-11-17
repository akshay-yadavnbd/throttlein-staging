'use client';

/**
 * Page-shaped skeletons for the PUBLIC storefront.
 *
 * ── WHY THESE AREN'T IN components/ui/States.tsx ────────────────────
 * `States.tsx` is byte-synced with the admin app and is built on HeroUI
 * v3 primitives + nude-theme tokens (`bg-surface`, `border-border`).
 * Those tokens are declared inside `[data-theme='nude']`, and in this app
 * that attribute is only applied under /dashboard — the public storefront
 * carries no theme attribute at all, so a token-based skeleton renders
 * with undefined colours out here. These use the storefront's own literal
 * greys instead, and stay out of the synced file so admin doesn't have to
 * carry a copy of markup it never renders.
 *
 * ── WHY SKELETONS AT ALL ────────────────────────────────────────────
 * A centred spinner tells the reader "something is happening somewhere".
 * A skeleton in the shape of the page tells them what is about to arrive
 * and reserves the space for it, so nothing jumps when the data lands.
 * Each skeleton below mirrors the container and grid classes of the page
 * it stands in for — they're listed next to each component so the two can
 * be kept honest.
 *
 * The single `skeleton--shimmer` wrapper (see themes/nude.css) runs ONE
 * highlight across the whole block rather than one per bar, which reads
 * as a single surface loading instead of a field of blinking rectangles.
 */

/**
 * One grey block. `aria-hidden` — the wrapper carries the announcement.
 *
 * On the grey: #EEEEEE was the obvious pick (it's the storefront's input
 * fill) and it was wrong. The storefront body is the brand cream #EFF1EA,
 * so #EEEEEE measured 1.005:1 against it — the skeleton was invisible on
 * the page it was built for. #DEDDD7 gives ~1.20:1, which is the usual
 * skeleton range: clearly present, still obviously not content. It also
 * holds up on the white card interiors, where the bars sit at ~1.25:1.
 */
function Bar({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`rounded bg-[#DEDDD7] ${className}`} />;
}

/** Shared wrapper: positions the shimmer and announces the wait once. */
function SkeletonRoot({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`skeleton--shimmer relative overflow-hidden ${className}`}
    >
      {/* Visible text would be a second loading message on screen; screen
          readers still need to be told, hence sr-only rather than nothing.
          None of the spinners this replaces announced anything. */}
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * Product detail. Mirrors ProductDetailPage's breadcrumb bar (`container
 * py-4`) and its main two-column grid (`container grid md:grid-cols-2
 * gap-8 lg:gap-15 items-start`), including the desktop-only 2-up image
 * grid on the left.
 */
export function ProductDetailSkeleton() {
  return (
    <SkeletonRoot label="Loading product">
      {/* Breadcrumb strip */}
      <div className="container py-4">
        <div className="flex items-center gap-2">
          <Bar className="h-3 w-12" />
          <Bar className="h-3 w-3" />
          <Bar className="h-3 w-24" />
          <Bar className="h-3 w-3" />
          <Bar className="h-3 w-40" />
        </div>
      </div>

      <div className="container grid md:grid-cols-2 gap-8 lg:gap-15 items-start">
        {/* Gallery — 4 tiles is one screenful; the real grid keeps going
            but there's no value in drawing rows below the fold. */}
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Bar key={i} className="aspect-square w-full rounded-lg" />
          ))}
        </div>

        {/* Buy column */}
        <div className="pt-2">
          <Bar className="h-3 w-16" />
          <Bar className="mt-4 h-7 w-4/5" />
          <Bar className="mt-2 h-7 w-3/5" />

          {/* Price row: price, struck MRP, discount pill */}
          <div className="mt-5 flex items-center gap-3">
            <Bar className="h-6 w-28" />
            <Bar className="h-4 w-20" />
            <Bar className="h-6 w-16 rounded-md" />
          </div>
          <Bar className="mt-2 h-3 w-24" />

          {/* Add to cart + wishlist */}
          <div className="mt-6 flex items-center gap-3">
            <Bar className="h-12 flex-1 rounded-lg" />
            <Bar className="size-12 shrink-0 rounded-full" />
          </div>

          {/* Size row */}
          <Bar className="mt-6 h-3 w-10" />
          <div className="mt-2 flex flex-wrap gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Bar key={i} className="size-11 rounded-lg" />
            ))}
          </div>

          {/* Check delivery card — outlined so the card boundary is visible
              while its contents are still blank, matching the real one. */}
          <div className="mt-6 rounded-2xl border border-[#eaeaea] p-6">
            <Bar className="h-4 w-32" />
            <div className="mt-3 flex items-center gap-3">
              <Bar className="h-12 flex-1 rounded-lg" />
              <Bar className="h-12 w-24 rounded-lg" />
            </div>
          </div>

          {/* Offer / return card */}
          <div className="mt-4 rounded-2xl border border-[#eaeaea] px-6 py-5">
            <Bar className="h-4 w-28" />
            <Bar className="mt-4 h-4 w-2/3" />
            <Bar className="mt-2 h-3 w-1/2" />
          </div>
        </div>
      </div>
    </SkeletonRoot>
  );
}

/**
 * Brand page. Mirrors BrandPage's `container` hero (logo + name + blurb)
 * followed by its product grid. BrandPage already had a `SkeletonGrid` for
 * the grid alone, but its top-level gate was a bare centred spinner, so
 * the hero flashed in from nothing.
 */
export function BrandPageSkeleton() {
  return (
    <SkeletonRoot label="Loading brand" className="container py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <Bar className="size-20 rounded-full" />
        <Bar className="h-7 w-56" />
        <Bar className="h-3 w-full max-w-xl" />
        <Bar className="h-3 w-4/5 max-w-lg" />
      </div>

      <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <Bar className="aspect-square w-full rounded-xl" />
            <Bar className="mt-3 h-3 w-3/4" />
            <Bar className="mt-2 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </SkeletonRoot>
  );
}

/**
 * Prose / CMS page (ProsePage). A title then paragraph runs. Line widths
 * are varied deliberately — a stack of identical full-width bars reads as
 * a table, not as prose.
 */
export function ProsePageSkeleton() {
  const widths = ['w-full', 'w-11/12', 'w-full', 'w-4/5', 'w-full', 'w-3/5'];
  return (
    <SkeletonRoot label="Loading page" className="container py-12">
      <Bar className="h-8 w-2/3 max-w-xl" />
      <Bar className="mt-3 h-3 w-40" />

      {[0, 1, 2].map((block) => (
        <div key={block} className="mt-8 space-y-3">
          <Bar className="h-4 w-1/3" />
          {widths.map((w, i) => (
            <Bar key={i} className={`h-3 ${w}`} />
          ))}
        </div>
      ))}
    </SkeletonRoot>
  );
}
