'use client';

import Link from 'next/link';
import {
  SELLER_FOOTER_NAV,
  SELLER_FOOTER_CATEGORIES,
  SELLER_LEGAL_LINKS,
  SELLER_SOCIALS,
} from '@/lib/sellerNav';
import type { SellerCategoryLink } from '@/lib/sellerCategoryLinks';

/**
 * Seller-property footer — Figma node 4583:9737 ("footer-categories").
 *
 * Three bands on #f3f4f2, separated by #d4d4d4 hairlines:
 *   1. "Popular categories to sell across India" — 16 SEO links
 *   2. Link columns (Sell Online / Grow Your Business / Learn More)
 *      plus a "Follow us" social row
 *   3. Legal strip
 *
 * Rendered once by `app/seller/layout.tsx`, replacing the storefront
 * `Footer` on every seller-property page. Distinct from
 * `MarketingFooter`, which is the older 4-column seller footer and
 * stays in place for the main site's /sell funnel.
 *
 * Content comes from `lib/sellerNav.ts`, shared with the header.
 */
export default function SellerFooter({
  /**
   * Published seller-category pages, from the seller layout. Each entry's
   * label is that page's Short title (`sellerCategory.linkTitle`).
   *
   * Falls back to SELLER_FOOTER_CATEGORIES when empty — but note those are
   * a hardcoded wish-list whose hrefs point at `/<slug>` on the property
   * root, while real category pages live at `/sell-online/<slug>`. They
   * are therefore rendered as PLAIN TEXT, not links: shipping sixteen
   * 404s in the footer of every page was the pre-existing behaviour and
   * is worse than showing the labels unlinked.
   */
  categories = [],
}: {
  categories?: SellerCategoryLink[];
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-[#f3f4f2] text-[#141414]">
      <div className="max-w-[1222px] mx-auto px-4 sm:px-6 lg:px-10 py-14 md:py-20 flex flex-col gap-10 md:gap-12">
        {/* ── Popular categories ── */}
        <h2 className="font-poppins font-medium text-[28px] md:text-[40px] leading-[1.2] text-[#0a0a0a] text-center">
          Popular categories to sell across India
        </h2>

        {/* Four across, filling ROW-wise: four published pages give one row,
            sixteen give four. Figma lays these out as a fixed 293px-wide
            wrap; a responsive column grid gives the same rhythm without
            stranding a half-empty final row on narrow viewports.
            Capped at MAX_SELLER_CATEGORY_LINKS by the fetcher. */}
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
          {categories.length > 0
            ? categories.map((cat) => (
                <li key={cat.slug}>
                  <Link
                    href={cat.href}
                    className="text-[16px] leading-[1.52] text-[#3a3a3a] hover:text-[#141414] hover:underline transition"
                  >
                    {cat.label}
                  </Link>
                </li>
              ))
            : SELLER_FOOTER_CATEGORIES.map((cat) => (
                <li key={cat.label}>
                  <span className="text-[16px] leading-[1.52] text-[#3a3a3a]">
                    {cat.label}
                  </span>
                </li>
              ))}
        </ul>

        <div className="h-px bg-[#d4d4d4]" />

        {/* ── Link columns + socials ── */}
        <div className="flex flex-col md:flex-row md:justify-between gap-10">
          {SELLER_FOOTER_NAV.map((group) => (
            <div key={group.label} className="flex flex-col gap-4 md:w-[220px]">
              <h3 className="font-poppins font-medium text-[16px] leading-[1.52] text-[#0a0a0a]">
                {group.footerLabel || group.label}
              </h3>
              <ul className="flex flex-col gap-3">
                {group.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="text-[16px] leading-[1.52] text-[#3a3a3a] hover:text-[#141414] hover:underline transition"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="flex flex-col gap-3 md:w-[280px]">
            <h3 className="font-poppins font-semibold text-[14px] text-[#0a0a0a]">
              Follow us
            </h3>
            <ul className="flex items-center gap-2.5">
              {SELLER_SOCIALS.map((s) => {
                const Icon = SOCIAL_ICONS[s.key];
                return (
                  <li key={s.key}>
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={s.label}
                      className="w-9 h-9 rounded-full bg-[#0a0a0a] text-white flex items-center justify-center hover:bg-[#3a3a3a] transition"
                    >
                      <Icon />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="h-px bg-[#d4d4d4]" />

        {/* ── Legal strip ──
            Not in the Figma frame (it ends at the divider), but shipping
            a footer with no copyright or policy links isn't defensible
            on a page that collects seller signups. Kept minimal. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-[14px] leading-[1.52] text-[#3a3a3a]">
          <p>© {year} Noseberry Private Limited. All rights reserved.</p>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {SELLER_LEGAL_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="hover:text-[#141414] hover:underline transition"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

/* ─── Social icons ───
   Same glyph set as MarketingFooter.tsx. Duplicated rather than
   imported because those are module-private helpers there; if a third
   footer ever needs them, extract to components/common/SocialIcons.tsx
   instead of copying a second time. */
const SOCIAL_ICONS = {
  fb: FBIcon,
  ig: IGIcon,
  in: INIcon,
  yt: YTIcon,
} as const;

function IGIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}
function FBIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.99 3.66 9.13 8.44 9.88v-6.99H7.9V12h2.54V9.8c0-2.51 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99C18.34 21.13 22 16.99 22 12z" />
    </svg>
  );
}
function YTIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.55 12 3.55 12 3.55s-7.505 0-9.376.5A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.017 3.017 0 0 0 2.122 2.136c1.871.5 9.376.5 9.376.5s7.505 0 9.376-.5a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
function INIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.852 3.37-1.852 3.602 0 4.267 2.37 4.267 5.455v6.288zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z" />
    </svg>
  );
}
