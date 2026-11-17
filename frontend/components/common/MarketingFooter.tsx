'use client';

/**
 * Marketing footer — the 5-column #f3f4f2 footer from the Figma design
 * (node 2198:348). Used on /sell and /seller/* routes since the global
 * Footer component is hidden on those routes.
 *
 * Layout: brand column (logo + tagline + newsletter form) + Shop / Sell /
 * Support / Company columns + divider + legal links + social circles.
 */

import Link from 'next/link';
import { useState } from 'react';
import Wordmark from '@/components/common/Wordmark';
import { sellerUrl, sellerContentUrl } from '@/lib/sellerUrl';

/* "Shop" column was dropped in the updated Figma (node 2198:348) so the
   seller-funnel footer is now 4-up: Brand + Sell + Support + Company.
   The home-page footer (components/common/Footer.tsx) still has Shop. */

const SELL = [
  // All six live on the SELLER property. They were linked with bare
  // relative paths, which resolved against whatever host rendered this
  // footer (the main site's /forgot-password and /reset-password pages
  // mount it) and 404'd — flagged by the SEO audit. sellerUrl()/
  // sellerContentUrl() target the seller origin in production and the
  // /seller/* paths in dev.
  { label: 'Become a Seller', href: sellerUrl() },
  { label: 'Seller Login',    href: sellerUrl('/login') },
  { label: 'Pricing & Fees',  href: sellerContentUrl('/pricing-and-fees') },
  { label: 'Seller Guide',    href: sellerContentUrl('/seller-onboarding-guide') },
  { label: 'Seller FAQ',      href: sellerContentUrl('/seller-faq') },
  { label: 'Seller Terms',    href: sellerContentUrl('/seller-terms') },
];

const SUPPORT = [
  { label: 'Help Center', href: '#' },
  { label: 'Track Order', href: '/account/orders' },
  { label: 'Shipping',    href: '/shipping-policy' },
  { label: 'Returns',     href: '/return-and-refund-policy' },
  { label: 'Contact Us',  href: 'mailto:info@noseberry.com' },
];

const COMPANY = [
  { label: 'About',          href: '#' },
  { label: 'Careers',        href: '#' },
  { label: 'Blog',           href: '/blog' },
  { label: 'Press',          href: '#' },
  { label: 'Sustainability', href: '#' },
];

const LEGAL = [
  { label: 'Privacy Policy',         href: '/privacy-policy' },
  { label: 'Terms & Conditions',     href: '/terms-and-conditions' },
  { label: 'Return & Refund Policy', href: '/return-and-refund-policy' },
  { label: 'Shipping Policy',        href: '/shipping-policy' },
  { label: 'Cancellation Policy',    href: '/cancellation-policy' },
];

export default function MarketingFooter() {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const year = new Date().getFullYear();

  return (
    <footer className="bg-[#f3f4f2] text-[#141414]">
      <div className="max-w-[1222px] mx-auto px-4 sm:px-6 lg:px-10 py-12 md:py-20">
        {/* TOP ROW — brand + 3 link columns (Sell / Support / Company) */}
        <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-[1.6fr_1fr_1fr_1fr] gap-8 md:gap-12">
          {/* Brand */}
          <div className="col-span-2 md:col-span-2 lg:col-span-1 max-w-md">
            <Wordmark variant="light" height={28} href="/" />
            <p className="mt-4 text-base text-[#3a3a3a] leading-relaxed">
              India's marketplace for motorcycle riders. Authentic parts, gear, and accessories — all in one place.
            </p>
            <div className="mt-6">
              <div className="text-sm font-medium text-[#0a0a0a] mb-2">
                Get the latest drops & seller deals
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!email) return;
                  setSubscribed(true);
                  setEmail('');
                  setTimeout(() => setSubscribed(false), 3000);
                }}
                className="flex flex-col sm:flex-row gap-2 max-w-md"
              >
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 h-11 px-3 rounded-lg bg-white border border-[#e0e0e0] text-sm placeholder:text-[#9ca3af] focus:outline-none focus:border-[#141414] transition"
                />
                <button
                  type="submit"
                  className="h-11 px-5 rounded-lg bg-[#141414] text-white text-sm font-semibold hover:bg-[#141414]/90 transition whitespace-nowrap"
                >
                  {subscribed ? 'Subscribed ✓' : 'Subscribe'}
                </button>
              </form>
            </div>
          </div>

          <FooterCol title="Sell"    links={SELL} />
          <FooterCol title="Support" links={SUPPORT} />
          <FooterCol title="Company" links={COMPANY} />
        </div>

        {/* DIVIDER */}
        <div className="mt-12 md:mt-16 h-px w-full bg-[#d4d4d4]" />

        {/* BOTTOM ROW */}
        <div className="mt-6 flex flex-col-reverse md:flex-row items-start md:items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[#6b6b6b]">
            <span>© {year} Throttlein. All rights reserved.</span>
            {LEGAL.map((l) => (
              <Link key={l.label} href={l.href} className="hover:text-[#141414] transition">
                {l.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-3 md:gap-4">
            <span className="text-[#6b6b6b]">Follow us</span>
            <div className="flex items-center gap-2">
              {[IGIcon, FBIcon, YTIcon, INIcon].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  aria-label="Social"
                  className="w-9 h-9 rounded-full bg-[#141414] text-white flex items-center justify-center hover:bg-[#141414]/85 transition"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <div className="text-base font-medium text-[#0a0a0a] mb-3">{title}</div>
      <ul className="flex flex-col gap-3">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="text-sm text-[#3a3a3a] hover:text-[#141414] transition">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Social icons ─── */
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
