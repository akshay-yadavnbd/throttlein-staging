'use client';

/**
 * Marketing header — the slim white header from the Figma sell page
 * (node 2198:246). Used on /sell and /seller/* routes where the full
 * storefront Navbar (search, sub-nav, mega menus) would be overkill.
 *
 * Layout: just THROTTLEIN wordmark on the left and a Login/Signup
 * outlined pill on the right. Sticky to the top, bottom border #eee.
 */

import Link from 'next/link';
import Wordmark from '@/components/common/Wordmark';

export default function MarketingHeader({
  ctaHref = '/seller/login',
  ctaLabel = 'Login/Signup',
}: {
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <header className="bg-white border-b border-[#eee] sticky top-0 z-40">
      <div className="max-w-[1434px] mx-auto px-4 sm:px-6 lg:px-10 h-16 md:h-[72px] flex items-center justify-between gap-3">
        <Wordmark variant="light" height={28} href="/" />
        <Link
          href={ctaHref}
          className="inline-flex items-center justify-center px-4 py-2.5 border border-[#e0e0e0] rounded-lg text-sm font-medium text-[#141414] hover:bg-[#f3f4f2] transition"
        >
          {ctaLabel}
        </Link>
      </div>
    </header>
  );
}
