'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Button,
  Dropdown, DropdownTrigger, DropdownMenu, DropdownItem,
} from '@heroui/react';
import {
  clearStoredUser, getStoredUser, consumeImpersonationHandoff, getImpersonation,
  type SellerUser, type ImpersonationInfo,
} from '@/lib/auth';
import styles from './SellerShell.module.css';
import Wordmark from '@/components/common/Wordmark';
import Arrow from '@/components/common/Arrow';
import { useKycStatus, KYC_STATUS_META } from '@/lib/kyc';
import { useSellerAttention } from '@/lib/useSellerAttention';
import { originForSite } from '@/lib/site';

type IconProps = { className?: string };

function DashboardIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}
function PackageIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M16.5 9.4L7.5 4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05" />
      <path d="M12 22.08V12" />
    </svg>
  );
}
function UserIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}
function PayoutIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function ReceiptIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-2V3z" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </svg>
  );
}
function ShieldIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function GridTagIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M20.59 20.58L14.5 14.5" />
      <circle cx="17" cy="17" r="1" />
    </svg>
  );
}

function MediaIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="M21 15l-5-5-6 6-3-3-4 4" />
    </svg>
  );
}
function OfflineSaleIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 9l1.5-4h15L21 9" />
      <path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
      <circle cx="7" cy="6" r="0.5" />
    </svg>
  );
}
function OfferIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="14.5" y1="8.5" x2="9.5" y2="13.5" />
      <circle cx="9" cy="9" r="1.2" />
      <circle cx="15" cy="14" r="1.2" />
    </svg>
  );
}

type NavItem = {
  href: string;
  label: string;
  Icon: React.FC<IconProps>;
  exact?: boolean;
  /** Other routes that count as "inside" this entry (sub-views). */
  also?: string[];
  /** Shows the "needs your hand" count from /seller/orders/attention. */
  attentionBadge?: boolean;
  /** Second group in the sidebar, under a thin rule. */
  section?: 'account';
};

/**
 * UX audit S1 — order and grouping.
 *
 * Daily work first, in the order a seller actually touches it: Orders
 * right under Dashboard (it was 7th, below Media and Offline sales),
 * then the catalogue. "NDR / Failed" and "Return / Exchange" are no
 * longer top-level: they are sub-views of Orders and live as tabs on the
 * Orders screen (SellerOrdersTabs), with the count that needs attention
 * shown as a badge here. Account items sit apart at the bottom. Labels
 * are plain nouns — no "My", no slashes, no courier jargon (W items).
 *
 * "Add Product" is deliberately NOT a nav entry: adding is an action, not
 * a section to browse. The /dashboard/products/new route still exists for
 * deep links and bookmarks — it just isn't advertised here.
 */
const NAV: NavItem[] = [
  { href: '/dashboard',              label: 'Overview', Icon: DashboardIcon, exact: true },
  { href: '/dashboard/orders',       label: 'Orders',    Icon: ReceiptIcon,
    also: ['/dashboard/ndr', '/dashboard/return-requests'], attentionBadge: true },
  { href: '/dashboard/payouts',      label: 'Payouts',   Icon: PayoutIcon },
  { href: '/dashboard/products',     label: 'Products',  Icon: PackageIcon },
  // Prefix matches (UX audit S12): /dashboard/offers/new used to fall
  // back to "Dashboard" in the header because Offers was `exact`. Only
  // the root needs exact — every other section owns its sub-routes.
  { href: '/dashboard/offers',       label: 'Offers',    Icon: OfferIcon },
  { href: '/dashboard/offline-sales', label: 'Offline sales', Icon: OfflineSaleIcon },
  { href: '/dashboard/media',        label: 'Media',     Icon: MediaIcon },
  { href: '/dashboard/brands-categories', label: 'Brands & categories', Icon: GridTagIcon },
  { href: '/dashboard/kyc',          label: 'Verification', Icon: ShieldIcon, section: 'account' },
  { href: '/dashboard/profile',      label: 'Profile',   Icon: UserIcon, section: 'account' },
];

const PILL_TONE: Record<string, string> = {
  amber:   'bg-amber-400/15 text-amber-200',
  blue:    'bg-blue-400/15 text-blue-200',
  emerald: 'bg-emerald-400/15 text-emerald-200',
  rose:    'bg-rose-400/15 text-rose-200',
};
const PILL_TONE_ACTIVE: Record<string, string> = {
  amber:   'bg-amber-100 text-amber-700',
  blue:    'bg-blue-100 text-blue-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  rose:    'bg-rose-100 text-rose-700',
};

export default function SellerShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SellerUser | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const menuTrigger = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
      if (event.key !== 'Tab') return;
      const items = menuRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      menuTrigger?.focus();
    };
  }, [mobileOpen]);
  const { kyc, refresh: refreshKyc } = useKycStatus();
  const kycPath = useRef(pathname);
  const attention = useSellerAttention();

  const [impersonation, setImpersonation] = useState<ImpersonationInfo | null>(null);

  useEffect(() => {
    // An admin arriving from "Sign in as seller" carries the token in the
    // URL fragment; install it before the auth check below, or we'd
    // bounce them to /login.
    consumeImpersonationHandoff();
    // Hydrate the external browser session only after the client mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImpersonation(getImpersonation());
    const u = getStoredUser();
    if (!u) {
      router.replace('/login');
      return;
    }
    setUser(u);
    setMobileOpen(false);
    if (kycPath.current !== pathname) {
      kycPath.current = pathname;
      void refreshKyc();
    }
  }, [router, pathname, refreshKyc]);

  function handleLogout() {
    clearStoredUser();
    router.replace('/');
  }

  const isActive = (item: NavItem) => {
    if (item.also?.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
    if (item.exact) return pathname === item.href;
    // /dashboard/products/new counts as Products (UX audit S6): the header
    // used to fall back to "Dashboard" while adding a product.
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  /**
   * Label for the desktop header bar.
   *
   * Reuses `isActive` so the header can never disagree with the
   * highlighted sidebar entry. Longest href wins so a detail route like
   * /dashboard/orders/ORD-123 resolves to "Orders" rather than falling
   * back to the dashboard root.
   */
  const activeLabel =
    [...NAV]
      .filter(isActive)
      .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? 'Dashboard';

  if (!user) return null;

  const kycMeta = KYC_STATUS_META[kyc.status];

  /** Store initials for the header avatar, mirroring AdminShell's. */
  const initials = (user.storeName || user.name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();

  const sidebarBody = (
    <>
      <div className={styles.brand}>
        <Wordmark href="/dashboard" variant="dark" height={26} />
        <p>Seller workspace</p>
      </div>

      <nav aria-label="Seller portal" className={`${styles.navigation} flex-1 flex flex-col overflow-y-auto`}>
        {NAV.map((item, i) => {
          const active = isActive(item);
          const showKycPill = item.href === '/dashboard/kyc';
          const badge = item.attentionBadge && attention && attention.total > 0 ? attention.total : 0;
          const startsSection = item.section && NAV[i - 1]?.section !== item.section;
          return (
            <Fragment key={item.href}>
            {(i === 0 || i === 3 || startsSection) && <p className={styles.groupLabel}>{i === 0 ? 'Workspace' : startsSection ? 'Account' : 'Store management'}</p>}
            <Link
              href={item.href}
              onClick={() => setMobileOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={`${styles.navLink} flex items-center gap-3 transition ${active ? 'font-semibold' : ''}`}
            >
              <item.Icon className="w-5 h-5 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {badge > 0 && (
                /* Things waiting on the seller (to ship, failed pickup,
                   delivery issue, pending return). Screen readers get the
                   full phrase; sighted users get the number. */
                <span
                  aria-label={`${badge} need${badge === 1 ? 's' : ''} attention`}
                  className={`min-w-5 rounded-full px-1.5 py-px text-center text-xs font-semibold leading-4 tabular-nums ${
                    active ? 'bg-brand-black text-brand-lime' : 'bg-danger text-danger-foreground'
                  }`}
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
              {showKycPill && (
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${ active ? PILL_TONE_ACTIVE[kycMeta.tone] : PILL_TONE[kycMeta.tone] }`}
                >
                  {kycMeta.short}
                </span>
              )}
            </Link>
            </Fragment>
          );
        })}
      </nav>

      {/* Footer keeps only what the account menu doesn't cover. The store
          name, email and Sign out moved into the header dropdown — mirroring
          admin — so they aren't stated twice. "Back to storefront" has no
          admin equivalent and stays: it's the seller's way back out to the
          public site. On mobile there's no header dropdown, so Sign out is
          still offered here. */}
      <div className={`${styles.footer} border-t border-white/10`}>
        <Link
          className="block text-xs text-brand-cream/70 transition hover:text-white"
          href={`${originForSite('main')}/`}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Arrow dir="left" /> Back to storefront
        </Link>
        <Button
          className="mt-3 w-full md:hidden"
          color="danger"
          onPress={handleLogout}
          size="sm"
          variant="flat"
        >
          Sign out
        </Button>
      </div>
    </>
  );

  return (
    <div className={`${styles.shell} min-h-screen flex`}>
      <a className={styles.skip} href="#seller-main">Skip to content</a>
      {/* IMPERSONATION BANNER
          Acting as someone else must never be invisible — it's the whole
          reason this flow is safer than a shared master password. Fixed
          to the top of the viewport so it can't be scrolled away, and it
          states whose account this is plus a one-click exit. */}
      {impersonation && (
        <div
          role="status"
          className="fixed top-0 left-0 right-0 z-[60] bg-amber-500 text-black px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm font-semibold shadow-md"
        >
          <span aria-hidden>⚠</span>
          <span>
            Signed in as <strong>{impersonation.sellerName}</strong>
            {impersonation.sellerEmail ? ` (${impersonation.sellerEmail})` : ''} — admin view.
            Actions are recorded against your admin account.
          </span>
          <button
            type="button"
            onClick={() => { clearStoredUser(); router.replace('/login'); }}
            className="rounded-md bg-black/85 px-3 py-1 text-xs font-bold text-white hover:bg-black"
          >
            Exit seller view
          </button>
        </div>
      )}
      <aside
        className={`${styles.sidebar} hidden md:flex shrink-0 flex-col sticky top-0 h-screen ${
          impersonation ? 'mt-10' : ''
        }`}
        data-impersonating={impersonation ? 'true' : undefined}
      >
        {sidebarBody}
      </aside>

      <aside
        ref={menuRef}
        id="seller-mobile-navigation"
        role="dialog"
        aria-label="Seller navigation"
        aria-modal={mobileOpen || undefined}
        inert={!mobileOpen}
        className={`${styles.sidebar} md:hidden fixed inset-y-0 left-0 flex flex-col z-50 shadow-2xl transform transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!mobileOpen}
      >
        <div className={styles.closeMenu}><button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu">✕</button></div>
        {sidebarBody}
      </aside>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* mt-10 clears the fixed impersonation banner when it's showing. */}
      <div className={`flex-1 flex flex-col min-w-0 ${impersonation ? 'mt-10' : ''}`}>
        {/* DESKTOP HEADER
            The seller portal had no desktop header at all — content began
            flush against the top of the viewport, so the page never
            announced what it was and the espresso chrome stopped abruptly
            at the sidebar edge. The admin panel has a persistent bar with
            the active page's name; this mirrors it (same height, hairline
            and background) so both operator surfaces frame their content
            the same way. */}
        <header className={`${styles.topbar} sticky top-0 z-30 hidden items-center justify-between gap-4 md:flex`}>
          <p className={styles.pageTitle}>{activeLabel}</p>

          {/* Account menu — mirrors AdminShell's: identity row (avatar,
              name, email) plus a role chip, then Sign out. Replaces a
              static avatar here and the duplicated name/email/Sign-out
              block that was in the sidebar footer. */}
          <Dropdown placement="bottom-end" offset={10} shouldBlockScroll={false} triggerScaleOnOpen={false} classNames={{content:styles.accountPopover}}>
            <DropdownTrigger>
              <button
                aria-label="Account menu"
                className={`${styles.account} rounded-lg p-1 focus-visible:outline-2 focus-visible:outline-offset-4`}
                type="button"
              >
                <span
                  aria-hidden
                  className="grid size-8 place-items-center rounded-full bg-brand-lime text-xs font-semibold text-brand-black"
                >
                  {initials}
                </span>
                <span className={styles.accountName}>{user.storeName || user.name}</span>
                <svg aria-hidden className="size-3.5 text-brand-cream/60" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label="Account"
              className={styles.accountMenu}
              itemClasses={{base:styles.accountItem,title:styles.accountItemTitle}}
              onAction={(key) => {
                if (key === 'logout') handleLogout();
                if (key === 'profile') router.push('/dashboard/profile');
              }}
            >
              <DropdownItem
                className={styles.accountIdentity}
                isReadOnly
                key="identity"
                textValue={user.storeName || user.name}
              >
                <div className="flex items-center gap-3 py-1">
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-lime text-sm font-semibold text-brand-black"
                  >
                    {initials}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {user.storeName || user.name}
                    </div>
                    <div className="truncate text-xs text-muted">{user.email}</div>
                    <span className={styles.accountRole}>Seller account</span>
                  </div>
                </div>
              </DropdownItem>
              <DropdownItem key="profile" startContent={<UserIcon className="size-4" />}>Store profile</DropdownItem>
              <DropdownItem
                className={styles.signOut}
                color="danger"
                key="logout"
                startContent={
                  <svg aria-hidden className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" x2="9" y1="12" y2="12" />
                  </svg>
                }
              >
                Sign out
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </header>

        <header className={`${styles.mobileHeader} md:hidden sticky top-0 z-30 bg-brand-espresso text-brand-cream flex items-center justify-between px-4 h-14 border-b border-white/10`}>
          <button
            ref={menuButtonRef}
            aria-expanded={mobileOpen}
            aria-controls="seller-mobile-navigation"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="p-2 -ml-2 rounded hover:bg-white/5 transition"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6"  x2="21" y2="6"  />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <Wordmark href="/dashboard" variant="dark" height={22} />
          <div className="w-10" aria-hidden />
        </header>

        <main id="seller-main" tabIndex={-1} className={`${styles.main} flex-1`}>{children}</main>
      </div>
    </div>
  );
}
