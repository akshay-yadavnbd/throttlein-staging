'use client';

/**
 * Frame for every /account/* page and the cart:
 *  - a dark banner with who is signed in and four live counts (orders,
 *    cart, wishlist, addresses) that double as shortcuts,
 *  - a tab bar that sticks under the site header (scrolls sideways on
 *    phones), with Sign out at its end,
 *  - the page itself on a light canvas, so white cards stand out.
 *
 * Links come from components/common/accountNav.tsx — the header's account
 * dropdown renders the same list. Counts come from lib/accountSummary.
 * Only signed-in customer accounts get in; anyone else is sent to sign in.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearStoredCustomer, getStoredCustomer, type CustomerUser } from '@/lib/customerAuth';
import { useAccountSummary, type AccountSummary } from '@/lib/accountSummary';
import { formatDayMonth } from '@/lib/dates';
import { notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import { ACCOUNT_LINKS, CART_LINK, SignOutIcon, isAccountLinkActive, type AccountLink } from '@/components/common/accountNav';

const TABS: AccountLink[] = [...ACCOUNT_LINKS, CART_LINK];

export default function CustomerShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/account';
  const [user, setUser] = useState<CustomerUser | null>(null);
  const summary = useAccountSummary();
  const tabsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const u = getStoredCustomer();
    if (!u) {
      router.replace(`/signin?returnTo=${encodeURIComponent(pathname)}`);
      return;
    }
    if (u.role && u.role !== 'customer') {
      // A seller/admin session left over from before the sign-in page
      // refused them. Silently bouncing to "/" made every account link look
      // broken — sign it out and say why instead.
      clearStoredCustomer();
      notifyWarning(M.customerShell.myAccountIsForCustomerAccountsPlease);
      router.replace(`/signin?returnTo=${encodeURIComponent(pathname)}`);
      return;
    }
    setUser(u);
  }, [router, pathname]);

  // Where the tabs still scroll (very narrow phones), keep the current one in view.
  useEffect(() => {
    const nav = tabsRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2 });
  }, [pathname, user]);

  if (!user) return null;

  function logout() {
    clearStoredCustomer();
    router.replace('/');
  }

  const count = (href: string) =>
    !summary ? undefined : href === '/account/orders' ? summary.orders : href === '/cart' ? summary.cart : undefined;

  return (
    <div className="min-h-[calc(100vh-var(--site-header-h,72px))] bg-[#f5f6f3]">
      <Banner user={user} summary={summary} />

      <div className="sticky top-[var(--site-header-h,72px)] z-30 border-b border-[#e3e7eb] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="container flex items-center gap-2">
          {/* Phones and tablets: six equal columns, icon over label, like an app tab bar.
              From lg up: one row of icon + label, with Sign out at the end. */}
          <nav
            ref={tabsRef}
            aria-label="Account"
            className="-mx-4 grid flex-1 auto-cols-[minmax(54px,1fr)] grid-flow-col overflow-x-auto [scrollbar-width:none] lg:mx-0 lg:flex lg:gap-1"
          >
            {TABS.map((link) => (
              <Tab key={link.href} link={link} active={isAccountLinkActive(link, pathname)} count={count(link.href)} />
            ))}
          </nav>
          <button
            type="button"
            onClick={logout}
            className="hidden h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-[#5d6871] transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f] lg:inline-flex"
          >
            <SignOutIcon className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>

      <main className="container py-6 lg:py-8">{children}</main>

      {/* Phones: the tab bar has no room for it, so it sits at the end of the page. */}
      <div className="container pb-10 lg:hidden">
        <button
          type="button"
          onClick={logout}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#e3e7eb] bg-white text-[13px] font-semibold text-[#5d6871] hover:text-rose-700"
        >
          <SignOutIcon className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

/* ─── Banner ───────────────────────────────────────────────────────── */

function Banner({ user, summary }: { user: CustomerUser; summary: AccountSummary | null }) {
  const first = user.name?.trim().split(/\s+/)[0] || 'there';
  const initial = (user.name?.trim()[0] || 'U').toUpperCase();
  const since = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : null;

  const stats: { href: string; label: string; value?: number; hint?: string }[] = [
    {
      href: '/account/orders',
      label: 'Orders',
      value: summary?.orders,
      hint: summary?.lastOrderAt ? `Last ${formatDayMonth(summary.lastOrderAt)}` : 'None yet',
    },
    { href: '/cart', label: 'In cart', value: summary?.cart, hint: summary?.cart ? 'Ready to check out' : 'Empty' },
    { href: '/account/wishlist', label: 'Wishlist', value: summary?.wishlist, hint: summary?.wishlist ? 'Saved for later' : 'Nothing saved' },
    { href: '/account/addresses', label: 'Addresses', value: summary?.addresses, hint: summary?.defaultCity || 'None saved' },
  ];

  return (
    <section className="relative overflow-hidden bg-[#141414] text-white">
      {/* Quiet texture: a soft light on the right and a fine diagonal grain. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -right-24 -top-32 h-80 w-80 rounded-full bg-white/[0.07] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'repeating-linear-gradient(135deg, #fff 0 1px, transparent 1px 14px)' }}
        />
      </div>

      <div className="container relative flex flex-col gap-4 py-5 sm:gap-6 sm:py-6 lg:flex-row lg:items-center lg:justify-between lg:py-8">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#EFF1EA] text-xl font-semibold text-[#141414] ring-4 ring-white/10 sm:h-16 sm:w-16 sm:text-2xl">
            {initial}
          </span>
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1.5 text-[11px] text-white/50">
              <Link href="/" className="hover:text-white">
                Home
              </Link>
              <span aria-hidden>/</span>
              <span className="text-white/70">My account</span>
            </nav>
            <p className="truncate text-xl font-semibold tracking-[-0.02em] sm:text-2xl">Hi, {first}</p>
            <p className="mt-0.5 truncate text-xs text-white/60">
              {user.email}
              {since && <> · Member since {since}</>}
            </p>
          </div>
        </div>

        <ul className="grid grid-cols-4 gap-2 lg:w-[560px] lg:shrink-0">
          {stats.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="group block rounded-xl border border-white/10 bg-white/[0.06] px-2.5 py-2.5 transition sm:px-4 sm:py-3 hover:border-white/20 hover:bg-white/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
              >
                <span className="flex items-center justify-between truncate text-[10px] font-medium text-white/60 sm:text-[11px]">
                  {s.label}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 opacity-0 transition group-hover:opacity-100" aria-hidden>
                    <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="mt-1 block text-lg font-semibold tabular-nums leading-none sm:text-2xl">
                  {s.value === undefined ? <span className="inline-block h-6 w-6 animate-pulse rounded bg-white/10 align-middle" /> : s.value}
                </span>
                <span className="mt-1.5 hidden truncate text-[11px] text-white/45 sm:block">{s.value === undefined ? ' ' : s.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ─── Tab ──────────────────────────────────────────────────────────── */

function Tab({ link, active, count }: { link: AccountLink; active: boolean; count?: number }) {
  return (
    <Link
      href={link.href}
      aria-current={active ? 'page' : undefined}
      className={`relative flex h-14 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[11px] tracking-[-0.02em] transition focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#59656f] lg:h-12 lg:shrink-0 lg:flex-row lg:gap-2 lg:px-3 lg:text-[13px] ${
        active ? 'font-semibold text-[#141414]' : 'font-medium text-[#5d6871] hover:text-[#141414]'
      }`}
    >
      <span className="relative">
        <link.Icon className="h-[18px] w-[18px] lg:h-4 lg:w-4" />
        {/* Phones: the count rides on the icon's corner. */}
        {!!count && (
          <span
            className={`absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full px-1 text-center text-[9px] font-semibold leading-4 tabular-nums lg:hidden ${
              active ? 'bg-[#141414] text-white' : 'bg-[#e3e7eb] text-[#39434c]'
            }`}
          >
            {count}
          </span>
        )}
      </span>
      <span className="max-w-full truncate">{link.label}</span>
      {!!count && (
        <span
          className={`hidden min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-semibold leading-[18px] tabular-nums lg:inline-block ${
            active ? 'bg-[#141414] text-white' : 'bg-[#eef0f2] text-[#39434c]'
          }`}
        >
          {count}
        </span>
      )}
      <span
        aria-hidden
        className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#141414] transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
      />
    </Link>
  );
}
