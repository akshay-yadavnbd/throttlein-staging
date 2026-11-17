'use client';

/**
 * Footer — built from Figma node 2775:1355 ("Throttlein / Home page").
 *
 * Cream (#f3f4f2) background. Section-level py + bg only; the inner
 * `.container` div carries width + horizontal padding, matching the
 * convention used by every section on the homepage.
 *
 * Top row (5 cols on desktop):
 *   - Brand column (430px wide): wordmark + tagline + newsletter form
 *   - Browse / List Your Products / Customer Support / Our Company —
 *     each with a Poppins-Medium heading + 5 regular-weight links.
 *
 * Divider (#d4d4d4) then bottom row:
 *   - Legal copy + 4 policy links on the left
 *   - "Connect with Us" + 5 round black social icons on the right
 *
 * Hidden on /sell, /seller, /dashboard, /account, /signin, /signup
 * routes (they have their own chrome) — same as before.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Wordmark from '@/components/common/Wordmark';
import { getStoredCustomer } from '@/lib/customerAuth';
import { sellerUrl, sellerContentUrl } from '@/lib/sellerUrl';

type LinkItem = { label: string; href: string; external?: boolean };

// Labels + hrefs match the live category taxonomy (name → slug), plus
// the /riding-gears collection page that aggregates all rider-worn gear.
const BROWSE: LinkItem[] = [
  { label: 'Helmets',            href: '/helmets' },
  { label: 'Riding Gear',        href: '/riding-gears' },
  { label: 'Performance Parts',  href: '/performance-parts' },
  { label: 'Luggage & Touring',  href: '/luggage-touring' },
  { label: 'Explore All Brands', href: '/brands' },
];

const SELL: LinkItem[] = [
  // Seller-funnel links point straight at the seller subdomain in
  // production (sellerUrl() falls back to /seller paths in dev) and
  // open in a new tab via `external`.
  { label: 'Join as a Vendor',  href: sellerUrl(),         external: true },
  { label: 'Vendor Access',     href: sellerUrl('/login'), external: true },
  // These three are SELLER-property CMS pages. They were linked with
  // bare relative paths, which resolved on throttlein.com and 404'd
  // (flagged by the SEO audit) — sellerContentUrl() targets the seller
  // origin in production and /seller/<slug> in dev.
  { label: 'Fees & Pricing',    href: sellerContentUrl('/pricing-and-fees'),        external: true },
  { label: 'Seller Handbook',   href: sellerContentUrl('/seller-onboarding-guide'), external: true },
  { label: 'Helpful Resources', href: sellerContentUrl('/seller-faq'),              external: true },
];

const SUPPORT: LinkItem[] = [
  { label: 'FAQ Section',          href: '/faqs' },
  // Points at the customer's orders list — /order-tracking had no
  // route or prose page behind it (footer link 404'd).
  { label: 'Order Tracking',       href: '/account/orders' },
  // { label: 'Product Returns',      href: '/product-returns' },
  { label: 'Get in Touch',         href: '/contact' },
];

const COMPANY: LinkItem[] = [
  { label: 'Learn More',             href: '/about' },
  // { label: 'Join Our Team',          href: '/join-our-team' },
  { label: 'Read Our Blog',          href: '/blog' },
  { label: 'Return & Refund Policy', href: '/return-and-refund-policy' },
  { label: 'Shipping Policy', href: '/shipping-policy' },
];

const LEGAL: LinkItem[] = [
  { label: 'Data Protection Policy', href: '/privacy-policy' },
  { label: 'User Agreement',         href: '/terms-and-conditions' },
  // { label: 'Cookie Policy',          href: '/cookie-policy' },
  { label: 'Cancellation Policy',     href: '/cancellation-policy' },
];

// Social profiles (IG / FB / YT / IN). X removed per product decision —
// Throttlein doesn't operate a profile there.
const SOCIAL = [
  { label: 'Instagram', href: 'https://www.instagram.com/throttlein_india/',     icon: IGIcon },
  { label: 'Facebook',  href: 'https://www.facebook.com/throttleinmarketplace/', icon: FBIcon },
  { label: 'YouTube',   href: 'https://www.youtube.com/@throttlein',             icon: YTIcon },
  { label: 'LinkedIn',  href: 'https://www.linkedin.com/company/throttlein/',    icon: INIcon },
];

export default function Footer() {
  const pathname = usePathname();

  // Track customer auth state so the "Order Tracking" link can route
  // signed-in users straight to their orders dashboard and bounce
  // anonymous users through /signin with a returnTo hint.
  // Reads from localStorage on mount — null until then so SSR doesn't
  // diverge from the first client render (we just render the
  // signed-out fallback href until the useEffect resolves).
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useEffect(() => {
    setIsLoggedIn(!!getStoredCustomer());
  }, [pathname]);

  // Dynamic Order Tracking destination layered onto the static SUPPORT
  // base. Everything else in SUPPORT passes through unchanged.
  const supportLinks: LinkItem[] = SUPPORT.map((l) =>
    l.label === 'Order Tracking'
      ? {
          ...l,
          href: isLoggedIn
            ? '/account/orders'
            : '/signin?returnTo=' + encodeURIComponent('/account/orders'),
        }
      : l,
  );

  if (
    // /seller itself uses the main Footer now; the deeper /seller/...
    // routes (guides, login etc.) still mount their own MarketingFooter.
    pathname?.startsWith('/seller/') ||
    pathname?.startsWith('/dashboard') ||
    pathname?.startsWith('/account') ||
    pathname === '/forgot-password' ||
    pathname?.startsWith('/reset-password') ||
    pathname === '/signin' ||
    pathname === '/signup' ||
    // Seller-subdomain CLEAN paths — on seller.<domain> the funnel
    // pages live at /login, /register, /verify, /guide/* (the proxy
    // rewrites them to /seller/...), so the browser pathname never
    // starts with /seller/. Safe on the main domain too: /login and
    // /register there are legacy redirects that navigate away
    // immediately, and /verify + /guide don't exist as main routes.
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/verify' ||
    pathname?.startsWith('/guide/')
  ) {
    return null;
  }

  return (
    /* `id` is load-bearing: app/seller/layout.tsx hides this footer with
       `#site-footer { display: none }` so the seller property can render
       its own. Pathname-based self-hiding (below) can't catch the seller
       subdomain, where the landing page's pathname is just `/`. */
    <footer id="site-footer" className="bg-[#f3f4f2] text-[#141414] pt-20 pb-10">
      <div className="container flex flex-col gap-12">
        {/* TOP ROW — brand col + 4 link cols */}
        <div className="flex flex-col lg:flex-row gap-12 lg:gap-20">
          {/* Brand column — 430px wide on desktop per Figma */}
          <div className="lg:w-[430px] flex flex-col gap-5 shrink-0">
            <Wordmark variant="light" height={40} href="/" />
            <p className="text-[16px] leading-[1.52] text-[#3a3a3a]">
              Throttlein: Your ultimate destination for motorcycle
              enthusiasts. Discover genuine parts, stylish gear, and
              essential accessories and everything you need in one spot.
            </p>
            <NewsletterForm />
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 sm:gap-12 flex-1">
            <FooterCol title="Browse" links={BROWSE} />
            <FooterCol title="List Your Products" links={SELL} />
            <FooterCol title="Customer Support" links={supportLinks} />
            <FooterCol title="Our Company" links={COMPANY} />
          </div>
        </div>

        {/* DIVIDER */}
        <div className="h-px w-full bg-[#d4d4d4]" />

        {/* BOTTOM ROW — legal left, social right */}
        <div className="flex flex-col-reverse md:flex-row items-start md:items-center justify-between gap-6">
          {/* Legal copy + 4 policy links */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] leading-[1.52]">
            <span className="text-[#6b6b6b]">
              © {new Date().getFullYear()} Throttlein. All rights reserved.
            </span>
            {LEGAL.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="text-[#3a3a3a] hover:text-[#141414] transition"
              >
                {l.label}
              </Link>
            ))}
          </div>

          {/* Connect with Us + social icons */}
          <div className="flex items-center gap-4">
            <span className="text-[12px] leading-[1.52] text-[#3a3a3a]">
              Connect with Us
            </span>
            <div className="flex items-center gap-4">
              {SOCIAL.map(({ label, href, icon: Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-9 h-9 rounded-full bg-[#0a0a0a] text-white flex items-center justify-center hover:bg-[#141414] transition"
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

/* ─────── Subcomponents ─────── */

function FooterCol({ title, links }: { title: string; links: LinkItem[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-[16px] leading-[1.52] font-medium text-[#0a0a0a]">
        {title}
      </div>
      <ul className="flex flex-col gap-3">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="text-[16px] leading-[1.52] text-[#3a3a3a] hover:text-[#141414] transition"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewsletterForm() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    // TODO: wire to real backend endpoint if/when one exists.
    setSubmitted(true);
    setEmail('');
    setTimeout(() => setSubmitted(false), 3000);
  }
  return (
    <div className="flex flex-col gap-3 mt-2">
      <p className="text-[14px] leading-[1.52] text-[#0a0a0a]">
        Stay updated with the newest arrivals &amp; exclusive vendor promotions
      </p>
      <form onSubmit={onSubmit} className="flex flex-wrap gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="contact@throttlein.com"
          className="w-full sm:w-[270px] h-12 px-4 rounded-lg bg-white border border-[#e5e5e5] text-[14px] placeholder:text-[#9ca3af] focus:outline-none focus:border-[#141414] transition"
        />
        <button
          type="submit"
          className="h-12 px-6 rounded-lg bg-[#0a0a0a] text-white text-[16px] hover:bg-[#141414] transition whitespace-nowrap"
        >
          {submitted ? 'Subscribed ✓' : 'Join Us'}
        </button>
      </form>
    </div>
  );
}

/* ─────── Brand icons (Instagram, Facebook, X, YouTube, LinkedIn) ─────── */

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
      <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.99 3.66 9.13 8.44 9.88v-6.99H7.9V12h2.54V9.8c0-2.51 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99C18.34 21.13 22 16.99 22 12z"/>
    </svg>
  );
}
function YTIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.55 12 3.55 12 3.55s-7.505 0-9.376.5A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.017 3.017 0 0 0 2.122 2.136c1.871.5 9.376.5 9.376.5s7.505 0 9.376-.5a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
}
function INIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.852 3.37-1.852 3.602 0 4.267 2.37 4.267 5.455v6.288zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z"/>
    </svg>
  );
}
