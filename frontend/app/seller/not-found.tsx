/**
 * 404 for the SELLER property (seller.throttlein.com).
 *
 * Next resolves `not-found.tsx` at the nearest route segment, so living
 * at `app/seller/` means this renders inside `app/seller/layout.tsx` —
 * it picks up the SELLER HUB header and the seller footer automatically,
 * rather than the storefront chrome from the root 404.
 *
 * Visual language matches the main site's `app/not-found.tsx` (the
 * stacked "4" + helmet + "4" from the Figma 404 frame) so the two
 * properties feel like one brand. The RECOVERY content differs, and
 * deliberately so:
 *
 *   - No product search. The seller property has no catalogue; a search
 *     box submitting to /products would be a second dead end.
 *   - Seller resources instead of product categories — the fee
 *     schedule, FAQ, onboarding handbook, blog.
 *   - An explicit "looking to shop?" link to the main storefront, since
 *     the most likely way to land here is a shopper following a
 *     storefront URL against the wrong host.
 *
 * On that last point: the seller catch-all used to *redirect* those
 * visitors to throttlein.com. That inherited the old proxy behaviour but
 * meant an unexpected cross-domain hop and a soft-404 in the process.
 * A real 404 on this domain with a visible way across is both correct
 * for crawlers and less confusing for people.
 */

import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { SELLER_CTA, SELLER_NAV, type SellerNavLink } from '@/lib/sellerNav';
import { sellerUrl } from '@/lib/sellerUrl';
import { originForSite } from '@/lib/site';

export const metadata: Metadata = {
  title: '404 — Page not found · THROTTLEIN Seller Hub',
  // Keep the 404 out of search results even if something links to it.
  robots: { index: false, follow: false },
};

/**
 * Recovery links, pulled from the shared nav config so they can't drift
 * from the header and footer.
 *
 * Restricted to destinations that are actually authored today — every
 * link in `SELLER_NAV` flagged `needsCmsPage` points at a page nobody
 * has written yet, and sending someone from a 404 to another 404 is
 * worse than offering fewer options.
 */
const SELLER_RESOURCES: SellerNavLink[] = (() => {
  const seen = new Set<string>();
  return SELLER_NAV
    .flatMap((g) => g.links)
    .filter((l) => !l.needsCmsPage)
    // Drop the auth destination — the CTAs below already cover signing
    // up, and offering it twice on one screen is noise.
    .filter((l) => l.label !== 'Create Account')
    // Dedupe by HREF, not label. Several nav entries deliberately point
    // at the same document under different names — "Fees & Commission"
    // and "Pricing & Fees Schedule" are both `pricing-and-fees`, and
    // "Help & Support" and "Seller FAQ" are both `seller-faq`. Keyed on
    // href, that produced duplicate React keys and two chips going to
    // the same place.
    .filter((l) => {
      if (seen.has(l.href)) return false;
      seen.add(l.href);
      return true;
    })
    .slice(0, 5);
})();

export default function SellerNotFound() {
  return (
    <section className="bg-white">
      <div className="max-w-[1232px] mx-auto px-6 sm:px-10 py-20 md:py-[120px] flex flex-col items-center gap-10">
        {/* ─── "404" — two big black "4"s flanking the helmet ─── */}
        <div className="flex items-end justify-center w-full max-w-[460px]">
          <span
            aria-hidden="true"
            className="font-poppins font-medium text-[#0a0a0a] leading-none tracking-tight select-none
                       text-[160px] sm:text-[200px] md:text-[220px]"
          >
            4
          </span>

          <div className="relative shrink-0 mx-1 sm:mx-2
                          w-[120px] h-[130px]
                          sm:w-[160px] sm:h-[170px]
                          md:w-[200px] md:h-[210px]">
            <Image
              src="/images/404-helmet.webp"
              alt=""
              fill
              priority
              sizes="(max-width: 640px) 120px, (max-width: 768px) 160px, 200px"
              className="object-contain"
            />
          </div>

          <span
            aria-hidden="true"
            className="font-poppins font-medium text-[#0a0a0a] leading-none tracking-tight select-none
                       text-[160px] sm:text-[200px] md:text-[220px]"
          >
            4
          </span>
        </div>

        {/* ─── Headline + subtitle ─── */}
        <div className="flex flex-col gap-3 text-center max-w-[850px]">
          <h1 className="font-poppins font-medium text-[24px] sm:text-[28px] md:text-[32px] text-[#0a0a0a] leading-[1.2] tracking-[-1px]">
            Looks Like You&apos;ve Taken a Wrong Turn.
          </h1>
          <p className="font-poppins text-[15px] sm:text-base text-[#424242] leading-[1.52]">
            This page has taken a different route. Let&apos;s get you back on track.
          </p>
        </div>

        {/* ─── Seller resources ─── */}
        {SELLER_RESOURCES.length > 0 && (
          <div className="w-full max-w-[640px] flex flex-col items-center gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-[#575757] font-semibold">
              Seller resources
            </div>
            <ul className="flex flex-wrap justify-center gap-2">
              {SELLER_RESOURCES.map(({ label, href }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex items-center h-9 px-4 rounded-full border border-[#e0e0e0]
                               text-[#0a0a0a] font-poppins text-sm bg-white
                               transition hover:border-[#0a0a0a] hover:bg-[#fafafa]"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ─── CTAs ─── Same treatment as the main site's 404: filled
             black primary, bordered white secondary. */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full max-w-[576px]">
          <Link
            href={sellerUrl('/')}
            className="flex-1 h-[49px] inline-flex items-center justify-center gap-2 rounded-lg
                       bg-[#0a0a0a] text-white font-poppins text-sm
                       shadow-[inset_0_-1px_0_1px_#0a0a0a,inset_0_0.5px_0.5px_1px_rgba(255,255,255,0.32)]
                       transition hover:bg-[#1f1f1f] active:bg-[#000]"
          >
            Back to Seller Hub
          </Link>
          <Link
            href={SELLER_CTA.register.href}
            className="flex-1 h-[49px] inline-flex items-center justify-center gap-2 rounded-lg
                       bg-white border border-[#e0e0e0] text-[#0a0a0a] font-poppins text-sm
                       transition hover:border-[#0a0a0a]"
          >
            Start selling
          </Link>
        </div>

        {/* ─── Cross-property escape hatch ───
             The single most likely reason to be here is a shopper who
             followed a storefront link against the seller host. Give
             them the door rather than a redirect they didn't ask for. */}
        <p className="font-poppins text-sm text-[#575757] text-center">
          Looking to shop instead?{' '}
          <a
            href={originForSite('main')}
            className="text-[#0a0a0a] underline underline-offset-2 hover:no-underline"
          >
            Go to Throttlein
          </a>
        </p>
      </div>
    </section>
  );
}
