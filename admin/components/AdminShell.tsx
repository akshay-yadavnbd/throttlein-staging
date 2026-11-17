'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownSection } from '@heroui/react';
import styles from './AdminShell.module.css';
import { clearStoredAdmin, getStoredAdmin, signInUrl, type AdminUser } from '@/lib/auth';
import { api, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import Wordmark from '@/components/Wordmark';
import {
  MODULES,
  NAV_GROUPS,
  type NavGroup,
  permKeyFor,
  isMainOnlyPath,
  isSellerOnlyPath,
  isPlatformOnlyPath,
  moduleVisibleOnSite,
  type IconKey,
  type AdminModule,
} from '@/lib/modules';
import SiteSwitcher from '@/components/SiteSwitcher';
import AdminAssistant from '@/components/AdminAssistant';
import {
  resolveActiveSite,
  setActiveSite,
  sitesAvailableTo,
  SITE_CHANGE_EVENT,
  type SiteKey,
} from '@/lib/site';

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
function UsersIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function BikeIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
      <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
    </svg>
  );
}
function FolderTreeIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h3l2 2h4a2 2 0 0 1 2 2v1H3V7z" />
      <path d="M3 10v8a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7" />
      <path d="M16 13h4M16 17h4M16 21h4" />
    </svg>
  );
}
function TagIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  );
}
function CustomersIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
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
function PayoutIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function RefundIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 12a9 9 0 0 1 14.85-6.85L21 8" />
      <polyline points="21 3 21 8 16 8" />
      <line x1="9" y1="12" x2="15" y2="12" />
    </svg>
  );
}
function OrdersIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 6h18l-2 13a2 2 0 0 1-2 1.7H7a2 2 0 0 1-2-1.7L3 6z" />
      <path d="M8 6V4a4 4 0 0 1 8 0v2" />
    </svg>
  );
}
function ClipboardCheckIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4h6v3H9z" />
      <polyline points="9 13 11 15 15 11" />
    </svg>
  );
}
/* Pages icon — a sheet of paper with a folded corner and a few content
   lines. Used for the CMS-style Pages tab where admins edit marketing
   surfaces (About, Privacy, Terms, etc). */
function FileTextIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function BookOpenIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function ImageIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

/* Quote icon — a pair of speech marks. Used by the Testimonials entry
   (seller success stories). */
function QuoteIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 11H5.5A1.5 1.5 0 0 1 4 9.5V8a3 3 0 0 1 3-3" />
      <path d="M9 11v2a4 4 0 0 1-4 4" />
      <path d="M19 11h-3.5A1.5 1.5 0 0 1 14 9.5V8a3 3 0 0 1 3-3" />
      <path d="M19 11v2a4 4 0 0 1-4 4" />
    </svg>
  );
}

/* Server icon — stacked rack units with a status dot. Used by the Cache
   Inspector entry (Redis observability page). */
function ServerIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <line x1="7" y1="7.5" x2="7.01" y2="7.5" />
      <line x1="7" y1="16.5" x2="7.01" y2="16.5" />
    </svg>
  );
}

function ChevronDownIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** A leaf nav entry navigates to `href`. A group entry has `children` and
 *  expands a submenu instead of navigating directly. The group's `href`
 *  is used to compute active state — any pathname starting with it
 *  highlights the group AND auto-opens the submenu on first render. */
/** Mapping from the registry's `iconKey` string to the actual icon
 *  component declared in this file. Adding a new iconKey to
 *  `lib/modules.ts` only needs a one-line addition here. */
function BellNavIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

const ICONS: Record<IconKey, React.FC<IconProps>> = {
  users:             UsersIcon,
  shield:            ShieldIcon,
  'clipboard-check': ClipboardCheckIcon,
  refund:            RefundIcon,
  customers:         CustomersIcon,
  bike:              BikeIcon,
  'folder-tree':     FolderTreeIcon,
  tag:               TagIcon,
  'file-text':       FileTextIcon,
  'book-open':       BookOpenIcon,
  quote:             QuoteIcon,
  image:             ImageIcon,
  orders:            OrdersIcon,
  server:            ServerIcon,
  bell:              BellNavIcon,
  payout:            PayoutIcon,
};

/** A renderable sidebar entry — derived from the modules registry +
 *  the special Dashboard entry that's always at the top and doesn't
 *  need a permission. */
type NavItem = {
  href: string;
  label: string;
  Icon: React.FC<IconProps>;
  permission?: string;
  children?: { href: string; label: string }[];
  /** Children render as in-page tabs, not a sidebar submenu — the entry
   *  stays a leaf link but goes active for any child href too. */
  childrenAsTabs?: boolean;
  /** In the nav ARRAY (for the URL guard + header labels) but not
   *  RENDERED in the sidebar — see AdminModule.hiddenInSidebar. */
  hiddenInSidebar?: boolean;
  /** When true, entry is visible only to the superadmin. Staff users
   *  never see it in the sidebar and are bounced from the URL. Mirrors
   *  `superadminOnly` on the module registry. */
  superadminOnly?: boolean;
  /** Sidebar group — see NAV_GROUPS in lib/modules.ts (UX audit A3). */
  group?: NavGroup;
};

/** Build the NAV for a given active site. Dashboard is prepended
 *  manually — it's the panel's home screen and intentionally has no
 *  permission gate.
 *
 *  This is a FUNCTION of the site rather than a module-level constant
 *  because site-scoped modules resolve to a different permission key
 *  per site ('pages' vs 'seller-pages'), and the sidebar has to gate on
 *  the key for whichever site is currently selected.
 *
 *  Adding a new module to the panel is still a one-line change in
 *  `lib/modules.ts`; the sidebar AND the staff permission grid pick it
 *  up automatically. */
function buildNav(site: SiteKey): NavItem[] {
  return [
    { href: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
    ...MODULES
      // On a non-main site the sidebar narrows to that site's OWN
      // surfaces — Pages and Blogs. Orders, Sellers, KYC and the rest
      // are marketplace-wide (one order book, one seller roster across
      // both domains), so showing them under a "Seller" badge would
      // imply a per-site split of data that doesn't exist.
      .filter((m: AdminModule) => moduleVisibleOnSite(m, site))
      .map((m: AdminModule) => ({
        href: m.href,
        label: m.label,
        Icon: ICONS[m.iconKey] || UsersIcon,
        permission: permKeyFor(m, site),
        // Drop sub-items whose route isn't reachable on this site, so
        // the sidebar never offers a link the URL guard is about to
        // bounce. Both directions: main-only children are hidden off
        // the main site, seller-only children are hidden on it.
        children: m.children?.filter((c) =>
          site === 'main' ? !isSellerOnlyPath(c.href) : !isMainOnlyPath(c.href),
        ),
        childrenAsTabs: m.childrenAsTabs,
        hiddenInSidebar: m.hiddenInSidebar,
        superadminOnly: m.superadminOnly,
        group: m.group ?? 'operate',
      })),
  ];
}

/** Returns true when the given user can access an entry. Superadmin
 *  bypasses everything; staff need the entry's `permission` (if any)
 *  in their permissions array. Entries without a `permission` are
 *  visible to anyone logged in. */
function canAccessNav(item: NavItem, user: AdminUser | null): boolean {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  // Superadmin-only entries (e.g. Cache Inspector) are hidden from staff
  // regardless of what's in their permissions[] array. Even if some data
  // migration ever wrote 'cache' onto a staff user, the flag wins.
  if (item.superadminOnly) return false;
  if (!item.permission) return true;
  return (user.permissions || []).includes(item.permission);
}

/* ── One persistent frame ─────────────────────────────────────────────────
 * The root layout mounts <AdminFrame> once, so the sidebar, header, polling
 * and assistant stay mounted while moving between sections (previously every
 * page wrapped itself in <AdminShell>, which rebuilt the whole chrome and
 * restarted every poll on each navigation). Pages may keep their
 * <AdminShell> wrapper: inside the frame it renders its children only. */
const InAdminFrame = createContext(false);

/** Sign-in and password screens render without the workspace chrome. */
const BARE_ROUTES = /^\/(?:$|login\/?$|forgot-password\/?$|reset-password\/|staff\/login\/?$|staff\/set-password\/)/;

export function AdminFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  if (BARE_ROUTES.test(pathname)) return <>{children}</>;
  return (
    <InAdminFrame.Provider value>
      <AdminWorkspace>{children}</AdminWorkspace>
    </InAdminFrame.Provider>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const inFrame = useContext(InAdminFrame);
  if (inFrame) return <>{children}</>;
  return <AdminWorkspace>{children}</AdminWorkspace>;
}

function AdminWorkspace({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Mobile drawer: lock page scroll, trap Tab inside, Escape closes, and
  // focus returns to the menu button — same behaviour as the seller drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const trigger = menuButtonRef.current;
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
      trigger?.focus();
    };
  }, [mobileOpen]);

  // Close the drawer after any navigation (e.g. a site switch from inside
  // it). Adjusted during render rather than in an effect, per React's
  // "storing information from previous renders" pattern.
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setMobileOpen(false);
  }
  const [pendingKycCount, setPendingKycCount] = useState(0);
  const [pendingBrandReqCount, setPendingBrandReqCount] = useState(0);
  /* Notification-bell feed. Same polling pattern as the two counts above:
     permission-gated per call so a staff account never 403s an API it
     can't see, failures silent, 60s interval. These are DERIVED
     notifications (live queries), not a stored inbox. Read/unread lives
     CLIENT-SIDE only (localStorage, see markNotifSeen below): clicking an
     item marks its seenKey and the badge stops counting it. Aggregate
     items bake their count into the seenKey ("sellers:5"), so when the
     underlying queue grows the item resurfaces as unread on its own. */
  const [pendingSellersCount, setPendingSellersCount] = useState(0);
  const [latestOrders, setLatestOrders] = useState<Array<{
    orderNumber: string; total: number; createdAt: string;
    customerName: string; itemName: string; itemCount: number;
  }>>([]);
  // Recent SELLER registrations — the feed is sellers + orders + brand/
  // category requests, per product decision (customer sign-ups dropped).
  const [latestSellers, setLatestSellers] = useState<Array<{ _id: string; name: string; createdAt: string }>>([]);
  // Recent brand & category requests, individual rows in the feed on top
  // of the aggregate "N pending review" attention item.
  const [latestBrandReqs, setLatestBrandReqs] = useState<Array<{
    _id: string; type: 'brand' | 'category'; name: string; sellerName: string; createdAt: string;
  }>>([]);
  const [seenNotifs, setSeenNotifs] = useState<Set<string>>(new Set());

  // Hydrate the seen-set after mount — localStorage isn't available
  // during SSR, and reading it in the initial useState would make the
  // first client render disagree with the server one.
  // Deferred a tick: reading storage is an external-system subscription,
  // not something to set state from synchronously inside the effect.
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(NOTIF_SEEN_KEY);
        if (raw) setSeenNotifs(new Set<string>(JSON.parse(raw)));
      } catch {}
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  function markNotifSeen(seenKey: string) {
    setSeenNotifs((prev) => {
      if (prev.has(seenKey)) return prev;
      const next = new Set(prev);
      next.add(seenKey);
      try {
        // Cap the stored set so years of order keys don't accumulate —
        // anything old enough to be evicted has long since left the feed.
        localStorage.setItem(
          NOTIF_SEEN_KEY,
          JSON.stringify(Array.from(next).slice(-200)),
        );
      } catch {}
      return next;
    });
  }
  /** "Mark all as read" in the bell: every currently listed item at once. */
  function markAllNotifsSeen(keys: string[]) {
    setSeenNotifs((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      try {
        localStorage.setItem(NOTIF_SEEN_KEY, JSON.stringify(Array.from(next).slice(-200)));
      } catch {}
      return next;
    });
  }
  // Which public property the CMS screens are editing. Read from
  // localStorage on mount (see lib/site.ts) and re-read whenever the
  // switcher fires SITE_CHANGE_EVENT.
  const [site, setSite] = useState<SiteKey>('main');

  // Deferred a tick: the stored session is an external system, read on
  // mount, not state to set synchronously inside the effect.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const u = getStoredAdmin();
      // Allow both superadmin AND staff users into the panel. Sellers /
      // customers / unauthenticated visitors get bounced to login.
      if (!u || (u.role !== 'superadmin' && u.role !== 'staff')) {
        // Back to this page after signing in (a bookmarked or shared link).
        router.replace(signInUrl());
        return;
      }
      setUser(u);
      // resolveActiveSite guards against a stored site the user no longer
      // has access to (e.g. seller-pages was revoked) by falling back to
      // their first available one.
      const resolved = resolveActiveSite(u);
      setSite(resolved);
      // CRITICAL: write it back to storage, not just to React state.
      // lib/api.ts reads `admin_site` from localStorage to set the
      // X-Admin-Site header, and it has no access to this component's
      // state. Skipping this write means that on first login — or any
      // time resolveActiveSite CORRECTS a stale value — the sidebar
      // renders one site while every API call declares another. For a
      // staffer whose only access is the seller property that's fatal:
      // the sidebar shows Blogs, every request asks for the main site's
      // key, and everything 403s with no user action that can repair it.
      setActiveSite(resolved);
    }, 0);
    return () => window.clearTimeout(id);
  }, [router]);

  // Keep in sync if the site changes anywhere (the switcher below, or a
  // detail screen correcting the site to match the record it loaded).
  useEffect(() => {
    function onSiteChange() {
      setSite(resolveActiveSite(getStoredAdmin()));
    }
    window.addEventListener(SITE_CHANGE_EVENT, onSiteChange);
    return () => window.removeEventListener(SITE_CHANGE_EVENT, onSiteChange);
  }, []);

  const availableSites = useMemo(() => sitesAvailableTo(user), [user]);
  const nav = useMemo(() => buildNav(site), [site]);

  /* Browser tab title follows the header label (UX audit S12, admin side).
     Every admin page is a client component, so per-page `metadata` isn't
     available; the root layout's static title showed on every route.
     Next re-inserts its own <title> after navigation, so a head observer
     re-asserts ours whenever that happens. */
  useEffect(() => {
    const label = activeNavLabel(nav, pathname);
    const want = label ? `${label} · Super admin · THROTTLEIN` : 'Super admin · THROTTLEIN';
    const set = () => { if (document.title !== want) document.title = want; };
    set();
    const mo = new MutationObserver(set);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [nav, pathname]);

  // Page-level access guard — if a staff user types a URL they don't
  // have permission for (sidebar already hides it but URL bar is open
  // game), bounce them to the dashboard. Superadmin bypasses everything.
  //
  // Note this depends on `nav`, which depends on the active site: a
  // staffer holding only `seller-blogs` who lands on /blogs while the
  // switcher says "Throttlein" is correctly bounced.
  useEffect(() => {
    if (!user || !pathname) return;

    // Main-site-only screens are blocked for EVERYONE (superadmin
    // included) while the switcher is on another property. This isn't a
    // permission check — it's preventing a whole class of silent
    // mistake: /pages/home and friends edit main-site homepage
    // furniture that has no `site` field, so leaving them reachable
    // would let someone edit throttlein.com's hero banners while the
    // sidebar badge reads "Seller".
    if (site !== 'main' && isMainOnlyPath(pathname)) {
      router.replace('/pages');
      return;
    }

    // ...and the mirror case: seller-only screens are blocked while the
    // main site is selected. `/pages/sell` writes to `staticRoute: '/'`,
    // which on the main site is the HOMEPAGE record — opening it from
    // the wrong site would let someone overwrite throttlein.com's home
    // meta from a screen titled "Become a seller".
    if (site === 'main' && isSellerOnlyPath(pathname)) {
      router.replace('/pages');
      return;
    }

    // Marketplace-wide screens are likewise unreachable while a non-main
    // site is selected — the sidebar doesn't offer them, so the URL bar
    // shouldn't either. Send them to the dashboard rather than
    // silently rendering platform data under a "Seller" badge.
    if (site !== 'main' && isPlatformOnlyPath(pathname)) {
      router.replace('/dashboard');
      return;
    }

    if (user.role === 'superadmin') return;
    // Match the deepest NAV entry whose href is a prefix of the path.
    const match = [...nav]
      .filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0];
    if (match && !canAccessNav(match, user)) {
      router.replace('/dashboard');
    }
  }, [user, pathname, router, nav, site]);

  /**
   * Switching site sends you to the module ROOT, not the current URL.
   * `/blogs/6812…` names a record that exists on one property only, so
   * staying put would 404. Landing on `/blogs` shows the other site's
   * list, which is what you wanted anyway.
   */
  function handleSiteChange(next: SiteKey) {
    setActiveSite(next);
    setSite(next);

    // Where the switch should land you:
    //
    //  - On a site-scoped DETAIL route (/blogs/<id>): go to that
    //    module's root. The id names a record that exists on one
    //    property only, so staying put would 404.
    //  - On a marketplace-wide route (/orders, /sellers) while moving
    //    AWAY from main: that screen is about to disappear from the
    //    sidebar, so go to the dashboard. Doing it here rather than
    //    leaving it to the URL guard avoids a visible render of a page
    //    we're immediately navigating off.
    //  - Otherwise: refresh in place.
    const scoped = MODULES.filter((m) => m.siteScoped);
    const current = scoped.find(
      (m) => pathname === m.href || pathname?.startsWith(`${m.href}/`)
    );
    if (current) {
      if (pathname !== current.href) router.push(current.href);
      else router.refresh();
      return;
    }
    if (next !== 'main' && isPlatformOnlyPath(pathname)) {
      router.push('/dashboard');
      return;
    }
    router.refresh();
  }

  useEffect(() => {
    // Skip the count poll for staff users who can't see KYC reviews —
    // the call would 403 and the badge would never light up anyway.
    if (!user) return;
    if (user.role !== 'superadmin' && !(user.permissions || []).includes('kyc')) return;
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const data = unwrap<{ sellers?: unknown[] }>(await api.get('/admin/kyc/pending'));
        if (!cancelled) setPendingKycCount(data.sellers?.length || 0);
      } catch {}
    };
    fetchCount();
    const iv = setInterval(fetchCount, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [user, pathname]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'superadmin' && !(user.permissions || []).includes('brand-requests')) return;
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const data = unwrap<{ items?: any[] }>(await api.get('/admin/brand-category-requests', {
          params: { status: 'pending' },
        }));
        if (!cancelled) {
          const items = data.items || [];
          setPendingBrandReqCount(items.length);
          // Same response also feeds the notification list — endpoint
          // sorts createdAt desc and populates seller (name/storeName).
          setLatestBrandReqs(
            items.slice(0, 10).map((r: any) => ({
              _id: r._id,
              type: r.type === 'category' ? 'category' : 'brand',
              name: r.name || '',
              sellerName: r.seller?.storeName || r.seller?.name || 'A seller',
              createdAt: r.createdAt,
            })),
          );
        }
      } catch {}
    };
    fetchCount();
    const iv = setInterval(fetchCount, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [user, pathname]);

  // Bell feed: pending sellers + latest orders + latest customer sign-ups.
  useEffect(() => {
    if (!user) return;
    const has = (perm: string) =>
      user.role === 'superadmin' || (user.permissions || []).includes(perm);
    let cancelled = false;
    const load = async () => {
      if (has('sellers')) {
        try {
          const data = unwrap<{ items?: any[] }>(await api.get('/admin/sellers'));
          if (!cancelled) {
            const items = data.items || [];
            /* "Sign-ups in progress" — the named queue (UX audit A1),
               not every `status: 'pending'` account. Same definition
               as the dashboard card and the Sellers stage tab. */
            api.get('/admin/sellers/queues')
              .then((r) => { if (!cancelled) setPendingSellersCount(unwrap<{ queues?: { signups?: number } }>(r).queues?.signups || 0); })
              .catch(() => {});
            // Endpoint already sorts createdAt desc, so the head of the
            // list IS the newest registrations. Store name over personal
            // name — that's how the seller appears everywhere else.
            setLatestSellers(
              items.slice(0, 10).map((s: any) => ({
                _id: s._id,
                name: s.storeName || s.name || s.email || 'New seller',
                createdAt: s.createdAt,
              })),
            );
          }
        } catch {}
      }
      if (has('orders')) {
        try {
          // 10 = the feed cap. Sellers and orders are merged by date and
          // trimmed to 10 below, so each source fetches up to the cap.
          const data = unwrap<{ items?: any[] }>(await api.get('/admin/orders?page=1&limit=10'));
          if (!cancelled) {
            setLatestOrders(
              (data.items || []).slice(0, 10).map((o: any) => ({
                orderNumber: o.orderNumber,
                total: o.total || 0,
                createdAt: o.createdAt,
                // `user` is populated (name/email) and items[] carries a
                // name snapshot taken at purchase time, so the feed can
                // say WHO ordered WHAT even if the product was deleted.
                customerName: o.user?.name || o.user?.email || 'A customer',
                itemName: o.items?.[0]?.name || '',
                itemCount: (o.items || []).length,
              })),
            );
          }
        } catch {}
      }
    };
    load();
    const iv = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [user, pathname]);

  async function handleLogout() {
    const ok = await confirmDialog({
      title: 'Sign out?',
      message: 'You\'ll need to sign in again to come back. Any unsaved changes on the current page will be lost.',
      confirmLabel: 'Sign out',
    });
    if (!ok) return;
    clearStoredAdmin();
    // Staff users land on /staff/login (their dedicated entry); the
    // superadmin lands on /login. Mirrors the role-routing we already
    // have in the two login pages.
    // Always land on /login regardless of role. The /login page
    // accepts both superadmin and staff sign-ins, and unifying the
    // redirect keeps the post-logout URL predictable.
    router.replace('/login');
  }

  if (!user) return null;

  const roleMeta = ROLE_META[user.role] ?? ROLE_META.staff;

  /* Bell feed, assembled from the polled state. Attention items are
     actionable queues (they carry the badge count); recent items are
     informational. Every item routes to the screen where it's handled. */
  const bellAttention: BellItem[] = [
    pendingSellersCount > 0 && {
      id: 'sellers',
      // Count baked into the key: reading "5 pending" then a 6th arriving
      // is NEW information, so the item comes back unread by itself.
      seenKey: `sellers:${pendingSellersCount}`,
      href: '/sellers?stage=signups',
      title: `${pendingSellersCount} sign-up${pendingSellersCount === 1 ? '' : 's'} in progress`,
      detail: 'Waiting on the seller — email or KYC not done. Send a reminder if they stall.',
      icon: <BellGlyph.Seller />,
    },
    pendingKycCount > 0 && {
      id: 'kyc',
      seenKey: `kyc:${pendingKycCount}`,
      href: '/kyc-pending',
      title: `${pendingKycCount} KYC submission${pendingKycCount === 1 ? '' : 's'} awaiting verification`,
      detail: 'Review identity and bank documents',
      icon: <BellGlyph.Shield />,
    },
    pendingBrandReqCount > 0 && {
      id: 'brandreq',
      seenKey: `brandreq:${pendingBrandReqCount}`,
      href: '/brand-requests',
      title: `${pendingBrandReqCount} brand & category request${pendingBrandReqCount === 1 ? '' : 's'} pending review`,
      detail: 'Catalogue additions requested by sellers',
      icon: <BellGlyph.Tag />,
    },
  ].filter(Boolean) as BellItem[];

  /* Recent activity = seller registrations + orders + brand/category
     requests (customer sign-ups dropped per product decision), merged
     newest-first and capped at 10. Order rows deliberately carry no
     order number or amount — just who, what, when; the detail page has
     the rest. */
  // Only the last 7 days count as "recent": a 40-day-old order isn't news,
  // and listing it unread just inflates the badge. Titles stay short
  // (long product names are cut), with the amount and age on the detail
  // line, so a row reads in one glance.
  const bellRecent: BellItem[] = [
    ...latestOrders.map((o) => ({
      id: `order-${o.orderNumber}`,
      seenKey: `order:${o.orderNumber}`,
      href: `/orders/${o.orderNumber}`,
      // "WHO ordered WHAT" — the item name is a purchase-time snapshot on
      // the order doc; extra line items are summarised rather than listed.
      title: o.itemName
        ? `${o.customerName} ordered ${clip(o.itemName, 42)}${o.itemCount > 1 ? ` +${o.itemCount - 1} more` : ''}`
        : `${o.customerName} placed an order`,
      detail: `${inr(o.total)} · ${agoShort(o.createdAt)} ago`,
      createdAt: o.createdAt,
      icon: <BellGlyph.Bag />,
    })),
    ...latestSellers.map((s) => ({
      id: `seller-${s._id}`,
      seenKey: `seller:${s._id}`,
      href: '/sellers',
      title: `${s.name} joined as a seller`,
      detail: `${agoShort(s.createdAt)} ago`,
      createdAt: s.createdAt,
      icon: <BellGlyph.Seller />,
    })),
    ...latestBrandReqs.map((r) => ({
      id: `breq-${r._id}`,
      seenKey: `breq:${r._id}`,
      href: '/brand-requests',
      title: `${r.sellerName} asked for a new ${r.type}${r.name ? ` “${clip(r.name, 30)}”` : ''}`,
      detail: `Needs a decision · ${agoShort(r.createdAt)} ago`,
      createdAt: r.createdAt,
      icon: <BellGlyph.Tag />,
    })),
  ]
    .filter((n) => withinDays(n.createdAt, 7))
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 12);

  /* Recent rows grouped by day so the list reads top-down in time. */
  const bellGroups = [
    { key: 'today', title: 'Today', items: bellRecent.filter((n) => dayBucket(n.createdAt) === 0) },
    { key: 'yesterday', title: 'Yesterday', items: bellRecent.filter((n) => dayBucket(n.createdAt) === 1) },
    { key: 'week', title: 'Earlier this week', items: bellRecent.filter((n) => dayBucket(n.createdAt) === 2) },
  ].filter((b) => b.items.length > 0);

  // The badge counts UNREAD items — attention and recent alike — so
  // opening a notification visibly clears it from the count.
  const bellCount = [...bellAttention, ...bellRecent].filter(
    (n) => !seenNotifs.has(n.seenKey),
  ).length;

  /* hiddenInSidebar entries stay in `nav` (URL guard + header labels need
     them) but never render in the sidebar. */
  const visible = nav.filter((item) => !item.hiddenInSidebar && canAccessNav(item, user));
  /* Counts ride on the HOST entries of merged sections: KYC on Sellers,
     brand requests on Catalogue — their own screens live behind those
     hosts' in-page tabs. */
  const badges: Record<string, number> = {
    '/sellers': pendingKycCount,
    '/kyc-pending': pendingKycCount,
    '/brands': pendingBrandReqCount,
    '/brand-requests': pendingBrandReqCount,
  };
  const ungrouped = visible.filter((i) => !i.group);
  const pageLabel = activeNavLabel(nav, pathname) || 'Dashboard';
  const closeMenu = () => setMobileOpen(false);

  const sidebarBody = (
    <>
      <div className={styles.brand}>
        <Wordmark href="/dashboard" variant="dark" height={26} />
        <p>Super admin</p>
      </div>
      <SiteSwitcher active={site} available={availableSites} onChange={handleSiteChange} />
      <nav aria-label="Admin" className={`${styles.navigation} thin-scroll-light flex min-h-0 flex-1 flex-col overflow-y-auto`}>
        {ungrouped.map((item) => (
          <NavEntry key={item.href} item={item} pathname={pathname} badges={badges} onNavigate={closeMenu} />
        ))}
        {/* UX audit A3: labelled groups instead of one flat list. A group
            with nothing visible (a staffer without those permissions, or
            the seller site's narrowed nav) renders no heading. */}
        {NAV_GROUPS.map((g) => {
          const items = visible.filter((i) => i.group === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id} className="flex flex-col gap-[3px]">
              <p className={styles.groupLabel}>{g.label}</p>
              {items.map((item) => (
                <NavEntry key={item.href} item={item} pathname={pathname} badges={badges} onNavigate={closeMenu} />
              ))}
            </div>
          );
        })}
      </nav>
      {/* Phones have no header account menu, so Sign out lives here. */}
      <div className={`${styles.footer} md:hidden`}>
        <button
          type="button"
          onClick={() => { closeMenu(); handleLogout(); }}
          className="w-full rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-[#f3b4b4] transition hover:bg-white/5"
        >
          Sign out
        </button>
      </div>
    </>
  );

  /* ── Notification bell ───────────────────────────────────────────────
     DERIVED notifications: live queries against the same permission-gated
     endpoints the sidebar badges poll — not a stored inbox. Read/unread is
     client-side (localStorage): clicking an item marks its seenKey, the
     badge counts only unread items, and read items stay listed but dimmed.
     Rendered in both headers (only one is visible at a time). */
  const bellRow = (n: BellItem, tone: 'attention' | 'recent') => {
    const unread = !seenNotifs.has(n.seenKey);
    return (
      <DropdownItem
        key={`${n.seenKey}|${n.href}`}
        className={styles.bellItem}
        description={n.detail}
        startContent={
          <span className={`grid size-8 shrink-0 place-items-center rounded-full ${tone === 'attention' ? 'bg-amber-100 text-amber-700' : 'bg-[#f0f2f4] text-[#55616b]'}`}>
            {n.icon}
          </span>
        }
        endContent={unread
          ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-[#d64545]" />
          : <svg aria-hidden className={styles.bellGo} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>}
        textValue={n.title}
      >
        <span className={`line-clamp-2 text-xs ${unread ? 'font-semibold text-[#252c32]' : 'text-[#7b858e]'}`}>{n.title}</span>
      </DropdownItem>
    );
  };
  const bell = (
    <Dropdown placement="bottom-end" offset={10} shouldBlockScroll={false} classNames={{ content: `${styles.popover} ${styles.bellPopover}` }}>
      <DropdownTrigger>
        <button
          type="button"
          aria-label={`Notifications${bellCount > 0 ? ` (${bellCount} unread)` : ''}`}
          className={styles.iconButton}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {bellCount > 0 && <span aria-hidden className={styles.bellCount}>{bellCount > 9 ? '9+' : bellCount}</span>}
        </button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label="Notifications"
        className={`thin-scroll ${styles.bellList}`}
        /* Header row: what this is, how many are unread, and one action
           to clear the badge without opening every item. */
        topContent={
          <div className={styles.bellHead}>
            <div><strong>Notifications</strong><span>{bellCount > 0 ? `${bellCount} unread` : 'Nothing unread'}</span></div>
            {bellCount > 0 && (
              <button type="button" className={styles.bellMarkAll} onClick={() => markAllNotifsSeen([...bellAttention, ...bellRecent].map((n) => n.seenKey))}>
                Mark all as read
              </button>
            )}
          </div>
        }
        emptyContent={<div className={styles.bellEmpty}><span className={styles.bellEmptyIcon}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg></span>You&apos;re all caught up.<small>Nothing new in the last 7 days.</small></div>}
        /* Footer: the three queues most notifications lead to, for when
           the admin wants the whole list rather than one item. */
        bottomContent={
          <div className={styles.bellFoot}>
            <span>Go to</span>
            {([['/orders', 'Orders'], ['/sellers', 'Sellers'], ['/brand-requests', 'Requests']] as [string, string][]).map(([href, label]) => (
              <button key={href} type="button" onClick={() => router.push(href)}>{label}</button>
            ))}
          </div>
        }
        onAction={(key) => {
          // Key format: "<seenKey>|<href>". Mark read first so the badge
          // decrements even if navigation lands on the page we're on.
          const [seenKey, target] = String(key).split('|');
          if (seenKey) markNotifSeen(seenKey);
          if (target) router.push(target);
        }}
      >
        {[
          ...(bellAttention.length > 0
            ? [
                <DropdownSection key="attention" showDivider title="Needs attention" classNames={{ heading: styles.bellSection }}>
                  {bellAttention.map((n) => bellRow(n, 'attention'))}
                </DropdownSection>,
              ]
            : []),
          ...bellGroups.map((g, i) => (
            <DropdownSection key={`recent-${g.key}`} title={g.title} showDivider={i < bellGroups.length - 1} classNames={{ heading: styles.bellSection }}>
              {g.items.map((n) => bellRow(n, 'recent'))}
            </DropdownSection>
          )),
        ]}
      </DropdownMenu>
    </Dropdown>
  );

  return (
    <div className={`${styles.shell} flex min-h-screen`}>
      <a className={styles.skip} href="#admin-main">Skip to content</a>

      <aside className={`${styles.sidebar} sticky top-0 hidden h-screen shrink-0 flex-col md:flex`}>
        {sidebarBody}
      </aside>

      <aside
        ref={menuRef}
        id="admin-mobile-navigation"
        role="dialog"
        aria-label="Admin navigation"
        aria-modal={mobileOpen || undefined}
        aria-hidden={!mobileOpen}
        inert={!mobileOpen}
        className={`${styles.sidebar} fixed inset-y-0 left-0 z-50 flex flex-col shadow-2xl transition-transform duration-200 md:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className={styles.closeMenu}>
          <button type="button" onClick={closeMenu} aria-label="Close menu">✕</button>
        </div>
        {sidebarBody}
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={closeMenu} aria-hidden />}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Names the sidebar entry the current URL belongs to, on every page
            — derived from the same nav the sidebar renders, so the two can't
            disagree ("Pages · 301 Redirection" for a child route). */}
        <header className={`${styles.topbar} sticky top-0 hidden items-center justify-between gap-4 md:flex`}>
          <p className={styles.pageTitle}>{pageLabel}</p>
          <div className={styles.actions}>
            {bell}

            {/* Account menu — identity row with a role chip, then Sign out. */}
            <Dropdown placement="bottom-end" offset={10} shouldBlockScroll={false} triggerScaleOnOpen={false} classNames={{ content: styles.popover }}>
              <DropdownTrigger>
                <button type="button" aria-label="Account menu" className={styles.account}>
                  <span aria-hidden className={`grid size-8 place-items-center rounded-full text-xs font-semibold ${roleMeta.avatarClass}`}>
                    {initialsOf(user.name)}
                  </span>
                  <span className={styles.accountName}>{user.name}</span>
                  <svg aria-hidden fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </DropdownTrigger>
              <DropdownMenu
                aria-label="Account"
                className={styles.menu}
                itemClasses={{ base: styles.menuItem, title: styles.menuItemTitle }}
                onAction={(key) => { if (key === 'logout') handleLogout(); }}
              >
                <DropdownItem key="profile" isReadOnly className={styles.identity} textValue={user.name}>
                  <div className="flex items-center gap-3 py-1">
                    <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold ${roleMeta.avatarClass}`}>
                      {initialsOf(user.name)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[#252c32]">{user.name}</div>
                      <div className="truncate text-xs text-[#7b858e]">{user.email}</div>
                      <span className={`${styles.role} ${roleMeta.chipClass}`}>
                        {roleMeta.icon}
                        {roleMeta.label}
                      </span>
                    </div>
                  </div>
                </DropdownItem>
                <DropdownItem
                  key="logout"
                  className={styles.signOut}
                  color="danger"
                  startContent={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  }
                >
                  Sign out
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </div>
        </header>

        <header className={`${styles.mobileHeader} sticky top-0 flex h-14 items-center justify-between border-b border-white/10 px-4 md:hidden`}>
          <button
            ref={menuButtonRef}
            type="button"
            aria-expanded={mobileOpen}
            aria-controls="admin-mobile-navigation"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="-ml-2 rounded p-2 transition hover:bg-white/5"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <Wordmark href="/dashboard" variant="dark" height={22} />
          {bell}
        </header>

        {/* `--rte-sticky-top` (set in the module CSS per breakpoint) tells
            RichTextEditor's sticky toolbar to pin below the sticky header.
            HeroUI portals modals to <body>, outside this <main>, so editors
            inside dialogs keep the 0px fallback. */}
        <main id="admin-main" tabIndex={-1} className={`${styles.main} min-w-0 flex-1`}>
          {children}
        </main>
        {/* Floating AI assistant (chatbot/) — superadmins only. */}
        <AdminAssistant role={user?.role} />
      </div>
    </div>
  );
}


type BellItem = {
  id: string;
  /** Stable identity for read/unread tracking. Per-record for recent
   *  items ("order:TIN-…"); for the aggregate attention items the count
   *  is part of the key ("sellers:5") so a growing queue resurfaces as
   *  unread without any backend involvement. */
  seenKey: string;
  href: string;
  title: string;
  detail: string;
  /** ISO timestamp used to merge-sort the recent feed newest-first.
   *  Absent on the aggregate attention items, which aren't sorted. */
  createdAt?: string;
  icon: React.ReactNode;
};

/** localStorage key holding the array of seen BellItem seenKeys.
 *  Versioned so a future format change can just bump the suffix. */
const NOTIF_SEEN_KEY = 'admin_notif_seen_v1';

/** Short relative time for notification rows. */
/** True when `iso` is within the last `days` days. */
function withinDays(iso: string | undefined, days: number): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() <= days * 24 * 60 * 60 * 1000;
}
/** 0 = today, 1 = yesterday, 2 = earlier (local calendar days). */
function dayBucket(iso?: string): 0 | 1 | 2 {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const t = new Date(iso ?? 0).getTime();
  return t >= today ? 0 : t >= today - 24 * 60 * 60 * 1000 ? 1 : 2;
}
/** Cut a long product name for a one-glance notification row. */
function clip(s: string, max: number): string {
  const t = String(s || '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
const inrFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
function inr(n: number): string {
  return inrFormat.format(Number(n) || 0);
}

function agoShort(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Small glyphs for notification rows — sized by the row, stroke-only. */
const BellGlyph = {
  Seller: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="16" y1="11" x2="22" y2="11" />
    </svg>
  ),
  Shield: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  Tag: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
      <path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.5" />
    </svg>
  ),
  Bag: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
      <path d="M6 2 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4z" /><path d="M4 6h16M16 10a4 4 0 0 1-8 0" />
    </svg>
  ),
  User: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
};

/**
 * Role presentation for the account menu — label, chip styling, avatar
 * tint and a small icon per role.
 *
 * The admin app only mints 'superadmin' and 'staff' today; 'admin' and
 * 'seller' are defined so the same header works unchanged if those roles
 * ever sign in here (and because the product asked for the set). Unknown
 * roles fall back to staff styling rather than crashing the header.
 */
const ROLE_META: Record<string, {
  label: string;
  chipClass: string;
  avatarClass: string;
  icon: React.ReactNode;
}> = {
  superadmin: {
    label: 'Super Admin',
    chipClass: 'bg-brand-black text-white',
    // Lime on dark chrome — reads as the brand mark; on the white
    // dropdown overlay it still works (black initials on lime, 13:1).
    avatarClass: 'bg-brand-lime text-brand-black',
    icon: (
      /* crown */
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden>
        <path d="M2 18h20l-2-11-5 4-3-6-3 6-5-4z" />
      </svg>
    ),
  },
  admin: {
    label: 'Admin',
    chipClass: 'bg-violet-100 text-violet-700',
    avatarClass: 'bg-violet-600 text-white',
    icon: (
      /* shield-check */
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" />
      </svg>
    ),
  },
  staff: {
    label: 'Staff member',
    chipClass: 'bg-amber-100 text-amber-700',
    avatarClass: 'bg-amber-600 text-white',
    icon: (
      /* id badge */
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden>
        <rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="10" r="2.5" /><path d="M8 17a4 4 0 0 1 8 0" />
      </svg>
    ),
  },
  seller: {
    label: 'Seller',
    chipClass: 'bg-emerald-100 text-emerald-700',
    avatarClass: 'bg-emerald-600 text-white',
    icon: (
      /* storefront */
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden>
        <path d="M3 9l1-5h16l1 5" /><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" /><path d="M9 21v-6h6v6" />
      </svg>
    ),
  },
};

/** Initials for the avatar — first letter of the first two words. */
function initialsOf(name?: string): string {
  return (
    String(name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || '')
      .join('')
      .toUpperCase() || '?'
  );
}

/**
 * The label of the sidebar entry that owns `pathname`.
 *
 * Deepest prefix match across modules AND their children, so
 * `/pages/redirects` reads "Pages · 301 Redirection" while `/pages/new`
 * (no child entry) falls back to "Pages". Unknown paths show nothing
 * rather than a wrong guess.
 */
function activeNavLabel(nav: NavItem[], pathname: string | null): string {
  if (!pathname) return '';
  let best: { href: string; label: string } | null = null;
  for (const n of nav) {
    if (pathname === n.href || pathname.startsWith(`${n.href}/`)) {
      if (!best || n.href.length > best.href.length) best = { href: n.href, label: n.label };
    }
    for (const c of n.children || []) {
      if (pathname === c.href || pathname.startsWith(`${c.href}/`)) {
        const label = c.label === n.label ? n.label : `${n.label} · ${c.label}`;
        if (!best || c.href.length > best.href.length) best = { href: c.href, label };
      }
    }
  }
  return best?.label ?? '';
}

/* ────────────────────────────────────────────────────────────────────────
 * Sidebar nav entry — renders a leaf Link OR a collapsible group with
 * a submenu (when item.children is set). Active state propagates:
 *   - A leaf is active when pathname starts with item.href
 *   - A group is active (and auto-opens) when pathname starts with
 *     item.href OR any child's href
 *   - The group itself is non-clickable (collapsible button only); the
 *     "All …" link inside the submenu replaces the navigation use of
 *     the group's href
 * ──────────────────────────────────────────────────────────────────── */
function NavEntry({
  item,
  pathname,
  badges,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  badges: Record<string, number>;
  /** Closes the phone drawer after a link is followed. */
  onNavigate?: () => void;
}) {
  const groupActive =
    pathname.startsWith(item.href) ||
    !!item.children?.some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`));
  // Submenus default to open whenever the user is inside that section,
  // and re-open when the user navigates INTO the section from elsewhere
  // (state adjusted during render on the prop change, not in an effect).
  const [open, setOpen] = useState(groupActive);
  const [wasActive, setWasActive] = useState(groupActive);
  if (groupActive !== wasActive) {
    setWasActive(groupActive);
    if (groupActive) setOpen(true);
  }

  const badgeCount = badges[item.href] || 0;
  const showBadge = badgeCount > 0;

  // Leaf entry — original behaviour. `childrenAsTabs` modules render as
  // a leaf too (their sections switch via in-page tabs), but stay lit
  // for child routes living OUTSIDE their href (COD remittance is under
  // /shiprocket/), which the plain prefix test would miss.
  if (!item.children || item.childrenAsTabs) {
    const active =
      pathname === item.href ||
      pathname.startsWith(`${item.href}/`) ||
      (item.childrenAsTabs === true && groupActive);
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={styles.navLink}
      >
        <item.Icon />
        <span className="flex-1">{item.label}</span>
        {showBadge && (
          /* Items waiting on an admin (KYC to review, catalogue requests).
             Screen readers get the phrase; sighted users get the number. */
          <span className={styles.badge} aria-label={`${badgeCount} awaiting review`}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </Link>
    );
  }

  // Group entry — toggle button + nested submenu
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-expanded={open}
        className={`${styles.navLink} ${groupActive ? styles.navGroupOpen : ''}`}
      >
        <item.Icon />
        <span className="flex-1">{item.label}</span>
        <ChevronDownIcon className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
      </button>
      {open && (
        <div className={styles.subnav}>
          {item.children.map((child) => {
            // For the parent-href child (e.g. /blogs as "All Blogs"), require
            // EXACT match so it doesn't claim the active state for sibling
            // routes like /blogs/new or /blogs/categories.
            const exactRoot = child.href === item.href;
            const childActive = exactRoot
              ? pathname === child.href
              : pathname === child.href || pathname.startsWith(`${child.href}/`);
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={onNavigate}
                aria-current={childActive ? 'page' : undefined}
                className={styles.subLink}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
