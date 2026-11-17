'use client';

/**
 * Navbar — built from the Figma design "Throttlein / Home page" (node 2036:3).
 *
 * Two stacked rows, both on white with a thin #eee bottom border:
 *   1. Top row    — logo, search bar (max-w 1100 grey pill), cart, heart,
 *                   Login/Signup button.
 *   2. Sub-header — 5 category pills (Helmet / Jacket / Boots / Pants / Bags)
 *                   then a divider, "Shop by Bike", divider, "All Categories ▾".
 *
 * Still wired to the same data / auth / cart-count logic as before. Sticky.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { sellerUrl } from '@/lib/sellerUrl';
import {
  Dropdown, DropdownTrigger, DropdownMenu, DropdownItem,
  Popover, PopoverTrigger, PopoverContent,
  useDisclosure,
} from '@heroui/react';
import MobileSearchSheet from '@/components/common/MobileSearchSheet';
import { api, envelopeOrLegacy, imageUrl, unwrap } from '@/lib/api';
import { categoryHref, nameToSlug } from '@/lib/categorySlug';
import {
  clearStoredCustomer, getStoredCustomer, type CustomerUser,
} from '@/lib/customerAuth';
import { customerApi } from '@/lib/customerApi';
import { getWishlistIds } from '@/lib/wishlist';
import Wordmark from '@/components/common/Wordmark';
import { ACCOUNT_LINKS, CART_LINK, SignOutIcon } from '@/components/common/accountNav';
import SearchDropdown from '@/components/common/SearchDropdown';

type CategoryNode = {
  _id: string;
  name: string;
  slug?: string;
  parent: string | null;
  isActive: boolean;
  /** Admin-uploaded category icon/thumbnail URL, when set. */
  icon?: string;
  /** True when the node's SUBTREE has >=1 storefront-visible product.
   *  Comes from /categories?hasProducts=1; undefined on older payloads,
   *  and every filter below treats undefined as "show" so a stale cache
   *  can't blank the menu. */
  hasProducts?: boolean;
  children: CategoryNode[];
};

/* (The old hardcoded SUB_NAV category list was removed — the mobile
   drawer now renders straight from the live category tree, so retired
   categories can't leak into the menu.) */

/* Rider-worn gear categories, in display-priority order. Drives the
   "gear first" sorting of both the Categories mega menu and the mobile
   drawer. */
const GEAR_FIRST_SLUGS = [
  'riding-jackets', 'helmets', 'riding-gloves', 'riding-boots',
  'riding-pants', 'riding-suits', 'protection-gear', 'rain-gear',
];

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  // NOTE: deliberately NOT useSearchParams() — that hook forces the
  // whole component into a Suspense boundary during static prerender
  // (Next 15 CSR bailout), which made the entire header render inside
  // a hidden streamed slot on some pages (it looked like the navbar
  // "disappeared" until hydration finished). The legacy `?category=`
  // highlight is read from window.location instead, in an effect.
  const [queryCategory, setQueryCategory] = useState('');
  useEffect(() => {
    try {
      setQueryCategory(new URLSearchParams(window.location.search).get('category') || '');
    } catch {
      setQueryCategory('');
    }
  }, [pathname]);
  // Derive the active category from either the URL path `/<slug>`
  // (root-level category URL) or `?category=<name>` (legacy / search
  // modal). The Navbar pills get the highlighted "selected" state
  // when their category matches.
  //
  // Categories live at root now, so the path-derivation is just
  // "first segment, when there is exactly one". Routes with more
  // segments (e.g. /<cat>/<dynamic-page>) still highlight the parent
  // category by reading only the first segment.
  const pathCategorySlug = (() => {
    if (!pathname || pathname === '/') return '';
    // Don't treat reserved top-level routes as categories.
    const reserved = new Set([
      'account', 'blog', 'brands', 'cart', 'dashboard', 'forgot-password',
      'locations', 'login', 'page', 'product', 'products', 'register',
      'reset-password', 'sell', 'seller', 'signin', 'signup',
    ]);
    const first = pathname.split(/[/?#]/).filter(Boolean)[0] || '';
    return reserved.has(first) ? '' : first;
  })();
  const activeCategory =
    (pathCategorySlug ? pathCategorySlug : '') ||
    (queryCategory ? nameToSlug(queryCategory) : '');

  const [user, setUser] = useState<CustomerUser | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);
  // Same hover-fills-the-heart behavior as ProductCard.tsx's
  // `wishlisted || heartHover` — the gradient can't be a plain Tailwind
  // `hover:` class since it's an SVG `fill`/`stroke` url() reference, so
  // it needs a tracked hover state instead.
  const [wishlistHeartHover, setWishlistHeartHover] = useState(false);
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [mobileMenu, setMobileMenu] = useState(false);
  const search = useDisclosure();

  const hidden =
    pathname === '/seller' ||
    pathname?.startsWith('/seller/') ||
    pathname?.startsWith('/dashboard') ||
    pathname === '/forgot-password' ||
    pathname?.startsWith('/reset-password') ||
    // Seller-subdomain CLEAN paths — on seller.<domain> the funnel
    // lives at /login, /register, /verify, /guide/* (proxy rewrites
    // them to /seller/...), so the pathname rules above never match.
    // Safe on the main domain: /login + /register there are legacy
    // redirects, and /verify + /guide don't exist as main routes.
    // (The seller landing at subdomain '/' is handled by the CSS in
    // app/seller/layout.tsx since '/' is the storefront homepage on
    // the main domain.)
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/verify' ||
    pathname?.startsWith('/guide/');

  useEffect(() => {
    const u = getStoredCustomer();
    setUser(u);
    if (!u) {
      setCartCount(0);
      return;
    }
    // Pull the live cart count whenever:
    //   1. The route changes (so jumping between pages is fresh)
    //   2. Any other component fires a `cart:changed` event after
    //      mutating the cart (add / update qty / remove). This avoids
    //      having to lift the count into a context and lets every
    //      consumer keep using customerApi directly.
    const refresh = () => {
      customerApi
        .get('/cart')
        .then((r) => setCartCount(unwrap<{ cart?: { items?: unknown[] } }>(r).cart?.items?.length || 0))
        .catch(() => { });
    };
    refresh();
    window.addEventListener('cart:changed', refresh);
    return () => window.removeEventListener('cart:changed', refresh);
  }, [pathname]);

  // Wishlist count badge — same pattern as cart count above, reading the
  // shared cache from lib/wishlist.ts (so this doesn't fire its own
  // duplicate GET /wishlist when cards on the page already populated it)
  // and refreshing on `wishlist:changed` (fired by any card, the PDP, or
  // the wishlist page after an add/remove).
  useEffect(() => {
    const u = getStoredCustomer();
    if (!u) {
      setWishlistCount(0);
      return;
    }
    const refresh = () => {
      getWishlistIds().then((ids) => setWishlistCount(ids.size));
    };
    refresh();
    window.addEventListener('wishlist:changed', refresh);
    return () => window.removeEventListener('wishlist:changed', refresh);
  }, [pathname]);

  useEffect(() => { setMobileMenu(false); }, [pathname]);

  /* Shop-by-Bike full-width dropdown. Lives at the Navbar level (not
     inside MegaMenuTrigger) so the panel can span the entire viewport
     width — HeroUI's Popover anchors to the trigger which can't go
     edge-to-edge. Click-driven: button toggles `shopBikeOpen`; a
     document-level click listener closes it when the user clicks
     outside the panel or trigger; Escape closes it too. */
  const [shopBikeOpen, setShopBikeOpen] = useState(false);
  const shopBikeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const shopBikePanelRef = useRef<HTMLDivElement | null>(null);
  const toggleShopBike = () => {
    setShopBikeOpen((v) => !v);
    setCategoriesOpen(false);
  };

  // Categories full-width panel — mirrors Shop-by-Bike's positioning,
  // sizing and dismissal behaviour so both dropdowns share identical
  // gap-from-header / width / corner-radius treatment.
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const categoriesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const categoriesPanelRef = useRef<HTMLDivElement | null>(null);
  const toggleCategories = () => {
    setCategoriesOpen((v) => !v);
    setShopBikeOpen(false);
  };

  // Close BOTH panels on route change so they don't linger when a link
  // is clicked.
  useEffect(() => {
    setShopBikeOpen(false);
    setCategoriesOpen(false);
  }, [pathname]);

  // Outside-click + Escape to dismiss whichever panel is open. Only
  // mount listeners while either panel is open so we don't pay for
  // them on every page render.
  useEffect(() => {
    if (!shopBikeOpen && !categoriesOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (shopBikeTriggerRef.current?.contains(target)) return;
      if (shopBikePanelRef.current?.contains(target)) return;
      if (categoriesTriggerRef.current?.contains(target)) return;
      if (categoriesPanelRef.current?.contains(target)) return;
      setShopBikeOpen(false);
      setCategoriesOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setShopBikeOpen(false);
        setCategoriesOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [shopBikeOpen, categoriesOpen]);

  useEffect(() => {
    // Coerce to an array — if the API ever returns `{}` (e.g. a 200-OK
    // proxy page or a flaky response shape) the bare cast used to set
    // `tree` to `undefined`, which then crashed the .find/.filter calls
    // below at render time.
    api
      // hasProducts=1 annotates each node with whether its subtree has
      // any visible product — the menus below hide categories no seller
      // has stocked yet (per product decision).
      .get('/categories', { params: { hasProducts: 1 } })
      .then(envelopeOrLegacy)
      .then(({ data }) => setTree(Array.isArray(data?.tree) ? (data.tree as CategoryNode[]) : []))
      .catch(() => setTree([]));
  }, []);

  const shopByBike = useMemo(
    () => tree.find((n) => n.parent === null && n.name === 'Shop by Bike') || null,
    [tree]
  );
  const otherTopLevel = useMemo(
    () =>
      tree.filter(
        (n) =>
          n.parent === null &&
          n.name !== 'Shop by Bike' &&
          n.isActive &&
          // Hide categories with no products anywhere in their subtree.
          // `!== false` so payloads without the annotation still render.
          n.hasProducts !== false,
      ),
    [tree]
  );
  // Rider-gear-first ordering — shared by the Categories mega menu and
  // the mobile drawer: jackets, helmets, gloves, boots … first, then
  // everything else in its normal order. Keyed by slug so renames in
  // the admin don't break it.
  const orderedTopLevel = useMemo(() => {
    const gear: CategoryNode[] = [];
    const rest: CategoryNode[] = [];
    for (const n of otherTopLevel) {
      (GEAR_FIRST_SLUGS.includes(n.slug || '') ? gear : rest).push(n);
    }
    gear.sort(
      (a, b) => GEAR_FIRST_SLUGS.indexOf(a.slug || '') - GEAR_FIRST_SLUGS.indexOf(b.slug || ''),
    );
    return [...gear, ...rest];
  }, [otherTopLevel]);
  // Drawer variant — same order, with Shop by Bike slotted in right
  // after the gear block.
  const drawerTopLevel = useMemo(() => {
    if (!shopByBike) return orderedTopLevel;
    const gearCount = orderedTopLevel.filter(
      (n) => GEAR_FIRST_SLUGS.includes(n.slug || ''),
    ).length;
    return [
      ...orderedTopLevel.slice(0, gearCount),
      shopByBike,
      ...orderedTopLevel.slice(gearCount),
    ];
  }, [orderedTopLevel, shopByBike]);

  // Publish the header's rendered height as a CSS variable so full-height
  // pages (the auth cards) can size themselves to "viewport minus header"
  // instead of guessing a number. DOM read after mount, no React state.
  useEffect(() => {
    if (hidden) return;
    const el = document.getElementById('site-header');
    if (!el) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty('--site-header-h', `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--site-header-h'); };
  }, [hidden]);

  if (hidden) return null;

  function logout() { clearStoredCustomer(); setUser(null); router.push('/'); }

  return (
    <>
      {/* New Figma single-row header (node 2775:991).
          - Section: white bg + py-4 (16px) only.
          - Inner `.container` div carries width + horizontal padding.
          - Left cluster: logo + hamburger + Shop by Bike + Categories.
          - Right cluster: search + Login/Signup + bag + heart. */}
      <header id="site-header" className="bg-white sticky top-0 z-40 border-b border-[#eee]">
        <div className="container py-4 flex items-center justify-between gap-3 md:gap-6">
          {/* LEFT CLUSTER */}
          <div className="flex items-center gap-3 md:gap-6 min-w-0">
            {/* Hamburger — sits BEFORE the logo on mobile/tablet
                (order-1) so the menu affordance is the first thing in
                the row. On desktop (md+) it switches to order-2, sitting
                AFTER the logo per the Figma comp order. */}
            <button
              onClick={() => setMobileMenu(true)}
              aria-label="Open menu"
              className="p-1 -ml-1 rounded hover:bg-[#f3f4f2] text-[#141414] shrink-0 order-1 md:order-2"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>

            <span className="order-2 md:order-1 shrink-0">
              <Wordmark variant="light" height={32} href="/" />
            </span>

            {/* Shop by Bike — motorbike icon + label. Rendered as a
                plain <Link> straight to the category root (per Vipin's
                request); the two-pane mega-menu dropdown that used to
                live here has been removed. Falls back to a static span
                when the Shop-by-Bike node isn't loaded yet so the
                header layout doesn't shift. `order-3` keeps it after
                the logo (order-1) and the hamburger (md:order-2). */}
            {shopByBike ? (
              <Link
                href={categoryHref(shopByBike.name)}
                className="hidden md:inline-flex order-3 items-center gap-1 text-xs font-normal text-[#141414] hover:opacity-80"
              >
                <BikeIcon className="w-4 h-4" />
                Shop by Bike
              </Link>
            ) : (
              <span className="hidden md:inline-flex order-3 items-center gap-1 text-xs font-normal text-[#141414]">
                <BikeIcon className="w-4 h-4" />
                Shop by Bike
              </span>
            )}

            {/* Categories — full-width dropdown anchored below the
                header, matching Shop-by-Bike's position + spacing
                instead of HeroUI Popover's trigger-anchored layout. */}
            <button
              ref={categoriesTriggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={categoriesOpen}
              onClick={toggleCategories}
              className="hidden md:inline-flex order-4 items-center gap-1 text-xs font-normal text-[#141414] hover:opacity-80 cursor-pointer"
            >
              Categories
              <Caret
                className={`w-4 h-4 transition-transform duration-200 ${categoriesOpen ? 'rotate-180' : ''
                  }`}
              />
            </button>
          </div>

          {/* RIGHT CLUSTER — every control is 44px tall with the same
              border, radius and hover; 12px apart. */}
          <div className="flex items-center gap-3">
            {/* Search bar — 424px wide, #eee bg per Figma. The
                desktop input + Flipkart-style trending / autocomplete
                dropdown lives entirely in SearchDropdown. The mobile
                search modal below is untouched. */}
            <SearchDropdown />

            {/* Mobile search trigger */}
            <button
              onClick={search.onOpen}
              aria-label="Search"
              className="lg:hidden p-1 rounded text-[#141414]"
            >
              <SearchIcon className="w-5 h-5" />
            </button>

            {/* Login / Signup CTA — bordered, only when logged out.
                Logged-in users get the account dropdown instead. */}


            {/* Cart and wishlist share one 44px bordered button, the same
                chrome and height as the search box and Login/Signup, so
                the whole right cluster sits on one line at one size. */}
            <Link
              href="/cart"
              aria-label="Cart"
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-[10px] border border-[#e0e0e0] text-[#141414] transition hover:border-[#a8a8ad] hover:bg-[#f3f4f2]"
            >
              <CartIcon className="h-[22px] w-[22px]" />
              {cartCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-white bg-[#141414] px-1 text-[10px] font-bold text-white">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
            </Link>

            {/* Wishlist: the heart fills with the same pink gradient as the
                product cards once anything is wishlisted, or on hover. */}
            <Link
              href={user ? '/account/wishlist' : '/signin'}
              aria-label="Wishlist"
              className="relative hidden h-11 w-11 items-center justify-center rounded-[10px] border border-[#e0e0e0] text-[#141414] transition hover:border-[#a8a8ad] hover:bg-[#f3f4f2] md:inline-flex"
              onPointerEnter={() => setWishlistHeartHover(true)}
              onPointerLeave={() => setWishlistHeartHover(false)}
            >
              <NavHeartIcon className="h-[22px] w-[22px]" filled={wishlistCount > 0 || wishlistHeartHover} />
              {wishlistCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-white bg-[#FF3D68] px-1 text-[10px] font-bold text-white">
                  {wishlistCount > 99 ? '99+' : wishlistCount}
                </span>
              )}
            </Link>

            {user ? (
              <Dropdown placement="bottom-end" offset={10} classNames={{ content: 'p-0 min-w-[280px] rounded-2xl border border-[#eee] shadow-lg' }}>
                <DropdownTrigger>
                  <button
                    aria-label="Account menu"
                    className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-[#e0e0e0] pl-1.5 pr-3 transition hover:border-[#a8a8ad] hover:bg-[#f3f4f2]"
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#141414] text-xs font-semibold text-white">
                      {(user.name?.[0] || 'U').toUpperCase()}
                    </span>
                    {/* <span className="text-sm font-medium text-[#141414] hidden sm:inline">
                      {user.name.split(' ')[0]}
                    </span> */}
                    <Caret className="w-3 h-3 text-[#575757]" />
                  </button>
                </DropdownTrigger>
                <DropdownMenu
                  aria-label="Account menu"
                  variant="flat"
                  itemClasses={{
                    base: [
                      'rounded-xl mx-2 my-0.5 px-3 py-2.5 gap-3',
                      'data-[hover=true]:bg-[#f3f4f2]',
                      'data-[selectable=true]:focus:bg-[#f3f4f2]',
                    ],
                    title: 'text-sm font-medium text-[#141414]',
                  }}
                >
                  {[
                    // One list (HeroUI collections take a single array): the account header,
                    // then the same links, order and icons as the account sidebar (accountNav.tsx).
                    <DropdownItem
                      key="profile-header"
                      isReadOnly
                      className="rounded-none mx-0 my-0 px-5 py-4 bg-[#f3f4f2] data-[hover=true]:bg-[#f3f4f2] cursor-default"
                      textValue="Account info"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-10 h-10 rounded-full bg-[#141414] text-white grid place-items-center text-base font-semibold shrink-0">
                          {(user.name?.[0] || 'U').toUpperCase()}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[#141414] truncate">{user.name}</div>
                          <div className="text-xs text-[#575757] truncate">{user.email}</div>
                        </div>
                      </div>
                    </DropdownItem>,
                    ...ACCOUNT_LINKS.map((link, i) => (
                      <DropdownItem
                        key={link.href}
                        href={link.href}
                        startContent={<link.Icon />}
                        showDivider={i === ACCOUNT_LINKS.length - 1}
                      >
                        {link.label}
                      </DropdownItem>
                    )),
                    <DropdownItem key="cart" href={CART_LINK.href} startContent={<CART_LINK.Icon />}>
                      {CART_LINK.label}
                    </DropdownItem>,
                    <DropdownItem
                      key="signout"
                      onPress={logout}
                      startContent={<SignOutIcon />}
                      className="rounded-xl mx-2 my-0.5 px-3 py-2.5 gap-3 text-[#575757] data-[hover=true]:bg-rose-50 data-[hover=true]:text-rose-700"
                    >
                      Sign out
                    </DropdownItem>,
                  ]}
                </DropdownMenu>
              </Dropdown>
            ) : (
              // Login/Signup CTA — hidden on small screens to keep
              // the mobile navbar compact. Mobile users get the same
              // link inside the hamburger drawer.
              <Link
                href="/signin"
                className="hidden h-11 items-center justify-center whitespace-nowrap rounded-[10px] border border-[#e0e0e0] px-4 text-sm font-medium text-[#141414] transition hover:border-[#a8a8ad] hover:bg-[#f3f4f2] md:inline-flex"
              >
                Login/Signup
              </Link>
            )}
          </div>
        </div>

        {/* SHOP-BY-BIKE PANEL — full-width dropdown anchored below header */}
        {shopByBike && shopBikeOpen && (
          <div
            ref={shopBikePanelRef}
            role="dialog"
            aria-label="Shop by Bike"
            className="hidden lg:block absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[calc(100%-2rem)] max-w-[1432px] bg-white border border-[#eee] shadow-2xl rounded-xl overflow-hidden z-40"
          >
            <ShopByBikeFullMenu
              shopByBike={shopByBike}
              onSelect={() => setShopBikeOpen(false)}
            />
          </div>
        )}

        {/* CATEGORIES PANEL — same vertical positioning as Shop-by-Bike
            (absolute, top-full, mt-2 gap) but narrower max-width since
            the content has only 3 columns and doesn't need the full
            1432px storefront-content width. */}
        {categoriesOpen && (
          <div
            ref={categoriesPanelRef}
            role="dialog"
            aria-label="Categories"
            className="hidden md:block absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[calc(100%-2rem)] max-w-[820px] bg-white border border-[#eee] shadow-2xl rounded-xl overflow-hidden z-40"
            onClick={(e) => {
              // Close on link click — walks up to find an anchor / role
              // menuitem so background clicks don't dismiss.
              const target = e.target as HTMLElement | null;
              if (target?.closest('a, button[role="menuitem"], [data-mega-link]')) {
                setCategoriesOpen(false);
              }
            }}
          >
            <AllCategoriesMenu topLevel={orderedTopLevel} />
          </div>
        )}
      </header>

      {/* HAMBURGER DRAWER —
          Triggered by the menu button on ALL screen sizes (not just
          mobile). On lg+ desktops it only carries the "extra" links
          (About, Contact, Blog, Products, Brands) since categories
          already live in the Shop by Bike + Categories dropdowns. On
          smaller screens (md and below) the full category list is
          appended so phone/tablet users have the entire nav in one
          panel. */}
      {mobileMenu && (
        // h-dvh (dynamic viewport height) instead of inset-0/h-full so
        // the drawer — and its bottom-pinned CTA — never extends behind
        // the mobile browser's collapsing URL/toolbar.
        <div className="fixed inset-x-0 top-0 h-dvh z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenu(false)} />
          {/* Drawer layout: fixed header (logo + close), scrollable
              middle (categories first on mobile/tablet, then the site
              links), and a sticky "Become a Seller" CTA pinned to the
              bottom — only the middle section scrolls. */}
          <aside className="relative h-full w-80 max-w-[85vw] bg-white shadow-2xl flex flex-col">
            <div className="shrink-0 flex items-center justify-between px-4 h-16 border-b border-[#eee]">
              <Wordmark variant="light" height={26} href={null} />
              <button onClick={() => setMobileMenu(false)} aria-label="Close menu" className="p-2 rounded hover:bg-[#f3f4f2] text-[#141414]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {/* Login/Signup — mobile only (md+ has it in the navbar).
                  Suppressed when the user is already signed in since
                  the avatar dropdown carries the same affordances. */}
              {!user && (
                <Link
                  href="/signin"
                  onClick={() => setMobileMenu(false)}
                  className="md:hidden block mb-2 px-3 py-3 rounded-lg border border-[#e0e0e0] text-sm text-center text-[#141414] font-semibold hover:bg-[#f3f4f2]"
                >
                  Login / Signup
                </Link>
              )}

              {/* Categories FIRST on mobile/tablet — hidden on lg+
                  because desktop users already get them via the Shop by
                  Bike + Categories dropdowns in the navbar. Rendered
                  straight from the live category tree so the list always
                  matches the storefront taxonomy. */}
              <div className="lg:hidden pb-2 mb-2 border-b border-[#eee]">
                <div className="px-3 pt-1 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6b6b6b]">
                  Shop categories
                </div>
                {/* Ordered list: rider gear first, then Shop by Bike,
                    then the remaining categories (see drawerTopLevel).
                    PARENT categories only, with their icons — mirrors
                    the desktop Categories menu (same product decision:
                    subcategory drill-down happens on the category page,
                    and empty categories are filtered upstream). The old
                    per-category accordions buried everything below the
                    first two rows. */}
                {drawerTopLevel.map((top) => (
                  <Link
                    key={top._id}
                    href={categoryHref(top.name)}
                    className="flex items-center gap-3 px-3 py-1.5 rounded text-sm font-semibold text-[#141414] hover:bg-[#f3f4f2]"
                    onClick={() => setMobileMenu(false)}
                  >
                    <span className="w-9 h-9 shrink-0 rounded-lg bg-[#f3f4f2] grid place-items-center overflow-hidden">
                      {top.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imageUrl(top.icon)} alt="" loading="lazy" className="w-full h-full object-cover" />
                      ) : top.name === 'Shop by Bike' ? (
                        /* The Shop-by-Bike node carries no admin icon —
                           initials would read "SH", so it gets the same
                           motorbike glyph the desktop nav uses. */
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[#141414]" aria-hidden="true">
                          <circle cx="5.5" cy="17.5" r="3.5" />
                          <circle cx="18.5" cy="17.5" r="3.5" />
                          <path d="M15 6h-3l-2 4H7.5" />
                          <path d="M5.5 17.5 10 10l4 3 4.5 4.5" />
                          <path d="M15 6l3.5 5" />
                        </svg>
                      ) : (
                        <span className="text-[11px] font-bold text-[#9e9e9e]">
                          {top.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">{top.name}</span>
                  </Link>
                ))}
              </div>

              {/* Site links — after the categories on mobile/tablet;
                  the only content on lg+ (categories hidden above). */}
              <Link href="/" className="block px-3 py-2 rounded text-sm font-semibold text-[#141414] hover:bg-[#f3f4f2]" onClick={() => setMobileMenu(false)}>
                Home
              </Link>
              <Link href="/products" className="block px-3 py-2 rounded text-sm font-semibold text-[#141414] hover:bg-[#f3f4f2]" onClick={() => setMobileMenu(false)}>
                Products
              </Link>
              <Link href="/brands" className="block px-3 py-2 rounded text-sm font-semibold text-[#141414] hover:bg-[#f3f4f2]" onClick={() => setMobileMenu(false)}>
                Brands
              </Link>
              <Link href="/blog" className="block px-3 py-2 rounded text-sm font-semibold text-[#141414] hover:bg-[#f3f4f2]" onClick={() => setMobileMenu(false)}>
                Blog
              </Link>
              <Link href="/about" className="block px-3 py-2 rounded text-sm font-semibold text-[#141414] hover:bg-[#f3f4f2]" onClick={() => setMobileMenu(false)}>
                About Us
              </Link>
              <Link href="/contact" className="block px-3 py-2 rounded text-sm font-semibold text-[#141414] hover:bg-[#f3f4f2]" onClick={() => setMobileMenu(false)}>
                Contact Us
              </Link>
              <Link href="/faqs" className="block px-3 py-2 rounded text-sm font-semibold text-[#141414] hover:bg-[#f3f4f2]" onClick={() => setMobileMenu(false)}>
                FAQs
              </Link>

              {/* Vendor CTA — desktop variant: flows right after the
                  links (the drawer content is short on lg+, so a
                  bottom-pinned CTA left an awkward gap). Opens the
                  seller site in a NEW TAB so the shopper keeps their
                  storefront session. */}
              <a
                href={sellerUrl()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenu(false)}
                className="hidden lg:block mt-2 px-3 py-3 rounded-lg bg-[#141414] text-sm font-semibold text-center text-white hover:bg-[#000] transition"
              >
                Become a Seller <span aria-hidden="true">→</span>
              </a>
            </div>

            {/* Vendor CTA — mobile/tablet variant: pinned to the bottom
                of the drawer so it's always visible above the long
                scrolling category list. */}
            <div className="lg:hidden shrink-0 p-3 border-t border-[#eee] bg-white">
              <a
                href={sellerUrl()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenu(false)}
                className="block px-3 py-3 rounded-lg bg-[#141414] text-sm font-semibold text-center text-white hover:bg-[#000] transition"
              >
                Become a Seller <span aria-hidden="true">→</span>
              </a>
            </div>
          </aside>
        </div>
      )}

      {/* SEARCH SHEET (mobile) — full-screen, with the same trending
          pills and live suggestions as the desktop dropdown. */}
      <MobileSearchSheet open={search.isOpen} onClose={search.onClose} />
    </>
  );
}


/* ────────── Shop by Bike — full-width, two-pane mega menu ──────────
   Layout (mirrors high-end retailers' bike-finder UX):
     • Top strip:   eyebrow + headline + sub-line on the left, a
                    "View all bikes →" link on the right
     • Left rail:   list of motorcycle makes; the row under the cursor
                    becomes "selected" (white card on a soft #fafbf8
                    background, lime accent bar on the left edge)
     • Right pane:  responsive grid of that make's models rendered as
                    cards (bike icon tile + uppercase model name +
                    optional arrow on hover). Empty state when the
                    selected make has no children yet.
     • Bottom strip: free-shipping / seller-cta promo, matching the
                    All-Categories menu's footer for visual cohesion. */
function ShopByBikeFullMenu({
  shopByBike,
  onSelect,
}: {
  shopByBike: CategoryNode;
  onSelect?: () => void;
}) {
  const makes = useMemo(
    () => (shopByBike.children || []).filter((c) => c.isActive),
    [shopByBike]
  );
  const [hoveredMakeId, setHoveredMakeId] = useState<string>('');
  const selectedMake =
    makes.find((m) => m._id === hoveredMakeId) || makes[0] || null;
  const models = useMemo(
    () => (selectedMake?.children || []).filter((c) => c.isActive),
    [selectedMake]
  );

  if (!makes.length) {
    return (
      <div className="container py-10 text-sm text-[#575757]">
        No bikes configured yet.
      </div>
    );
  }

  return (
    /* Outer wrapper: full-width column with a hard max-height tied to
       the viewport. The title strip is pinned at the top, the bottom
       promo strip is pinned at the bottom, and the body grid in the
       middle takes whatever space is left — each pane inside it scrolls
       on its own. Max-height is tighter now that the outer dropdown
       is a centered card rather than a viewport-wide drawer. */
    <div className="w-full flex flex-col max-h-[calc(100vh-180px)]">
      <div className="max-w-[1280px] mx-auto w-full px-4 sm:px-6 lg:px-10 shrink-0">
        {/* Title strip — tightened vertical padding for the new card shape. */}
        <div className="flex items-end justify-between gap-6 pt-5 pb-4 border-b border-[#eee]">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#141414]">
              Shop by Bike
            </div>
            <h3 className="text-2xl font-medium text-[#141414] mt-1 tracking-tight">
              Pick your ride
            </h3>
            <p className="text-sm text-[#575757] mt-1">
              Filter parts, gear, and accessories by your bike model.
            </p>
          </div>
          <Link
            href={categoryHref(shopByBike.name)}
            onClick={onSelect}
            className="text-xs font-bold uppercase tracking-wider text-[#141414] hover:underline whitespace-nowrap"
          >
            View all bikes →
          </Link>
        </div>
      </div>{/* end title-strip column */}

      {/* Body grid wrapper — flex-1 so it fills the space between the
        title strip (pinned top) and the promo strip (pinned bottom).
        `min-h-0` lets the inner grid's overflow:auto actually scroll
        instead of stretching the flex container. */}
      <div className="max-w-[1280px] mx-auto w-full px-4 sm:px-6 lg:px-10 flex-1 min-h-0 flex">
        {/* Two-pane body — left rail (makes) + right pane (models) */}
        <div className="grid grid-cols-[260px_1fr] flex-1 min-h-0 w-full">
          <aside className="bg-[#fafbf8] border-r border-[#eee] py-4 overflow-y-auto">
            <div className="px-6 pb-3 text-[10px] uppercase tracking-[0.3em] font-bold text-[#575757]">
              Makes
            </div>
            {makes.map((make) => {
              const isActive = (selectedMake?._id ?? '') === make._id;
              return (
                <Link
                  key={make._id}
                  href={categoryHref(make.name)}
                  onMouseEnter={() => setHoveredMakeId(make._id)}
                  onFocus={() => setHoveredMakeId(make._id)}
                  onClick={onSelect}
                  className={`group flex items-center justify-between gap-3 pl-5 pr-4 py-3 border-l-4 uppercase tracking-wider text-[13px] transition-colors ${isActive
                    ? 'bg-white border-[#c8ff00] text-[#141414] font-bold'
                    : 'border-transparent text-[#3a3a3a] hover:bg-white hover:text-[#141414]'
                    }`}
                >
                  <span className="truncate">{make.name}</span>
                  <Caret
                    className={`w-3 h-3 -rotate-90 transition-opacity ${isActive ? 'opacity-100' : 'opacity-30 group-hover:opacity-100'
                      }`}
                  />
                </Link>
              );
            })}
          </aside>

          <div className="p-8 overflow-y-auto">
            {selectedMake && (
              <div className="flex items-baseline justify-between mb-5">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#575757]">
                    Models
                  </div>
                  <h4 className="text-lg font-medium text-[#141414] mt-0.5 truncate">
                    {selectedMake.name}
                  </h4>
                </div>
                <Link
                  href={categoryHref(selectedMake.name)}
                  onClick={onSelect}
                  className="text-xs font-bold uppercase tracking-wider text-[#141414] hover:underline whitespace-nowrap"
                >
                  View all {selectedMake.name} →
                </Link>
              </div>
            )}

            {models.length === 0 ? (
              <div className="flex items-center justify-center h-[260px] border border-dashed border-[#eee] rounded-xl text-sm text-[#575757]">
                No models listed for {selectedMake?.name ?? 'this make'} yet.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {models.map((m) => (
                  <Link
                    key={m._id}
                    href={categoryHref(m.name)}
                    onClick={onSelect}
                    className="group flex items-center gap-3 border border-[#eee] rounded-xl px-3 py-2.5 hover:border-[#141414] hover:shadow-[0_2px_8px_rgba(20,20,20,0.06)] transition"
                  >
                    <span className="w-9 h-9 rounded-lg bg-[#f3f4f2] group-hover:bg-[#eaffb0] flex items-center justify-center shrink-0 transition-colors">
                      <BikeIcon className="w-5 h-5 text-[#141414]" />
                    </span>
                    <span className="min-w-0 flex-1 uppercase tracking-wide text-[12px] font-semibold text-[#141414] truncate">
                      {m.name}
                    </span>
                    <Caret className="w-3 h-3 -rotate-90 text-[#3a3a3a] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>{/* end max-w-[1280px] column */}

      {/* Bottom strip — strip with a soft #fafbf8 fill. Tighter vertical
          padding (py-3) to keep the overall dropdown card compact. Uses
          `flex-wrap` so badges drop below the CTA on narrow widths
          instead of overlapping it. */}
      <div className="border-t border-[#eee] bg-[#fafbf8]">
        <div className="container py-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-[#3a3a3a]">
            <span className="inline-flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[#141414]" aria-hidden="true">
                <path d="M3 7h13l5 5v6h-3" />
                <circle cx="7" cy="18" r="2" />
                <circle cx="17" cy="18" r="2" />
                <path d="M3 7v11h2" />
              </svg>
              <span className="font-medium text-[#141414]">Free shipping</span>
              <span>on orders over ₹999</span>
            </span>
            <span className="hidden md:inline-flex items-center gap-1.5">
              {/* Badge-check icon — was a dollar sign, wrong for an INR
                  store and unrelated to authenticity. */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[#141414]" aria-hidden="true">
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <span className="font-medium text-[#141414]">100% authentic</span>
              <span>from verified sellers</span>
            </span>
          </div>
          <a
            href={sellerUrl()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onSelect}
            className="inline-flex items-center gap-1.5 bg-[#c8ff00] text-[#141414] text-[12px] font-semibold px-3.5 py-2 rounded-md hover:bg-[#bfff00] whitespace-nowrap"
          >
            Become a Seller <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </div>
  );
}

/* ────────── All Categories mega menu ──────────
   PARENT categories only, per product decision — the old version listed
   up to 8 subcategories under each parent, which made a wall of ~60
   uppercase links; the subcategory drill-down belongs on the category
   page itself. Empty categories are already filtered out upstream
   (`hasProducts` from /categories?hasProducts=1), so everything shown
   here is shoppable. Layout:
     • Eyebrow ("BROWSE THE STORE") + "View all categories →" header row
     • 3-column responsive grid of parent-category links (same bold
       UPPERCASE treatment the old column headers used)
     • Bottom strip: free-shipping + easy-returns benefits, plus a lime
       Become-a-Seller CTA that ties the menu to the seller funnel */
function AllCategoriesMenu({ topLevel }: { topLevel: CategoryNode[] }) {
  if (!topLevel.length) {
    return <div className="p-6 text-sm text-default-500 w-[300px]">No categories yet.</div>;
  }
  return (
    <div className="w-[820px] max-w-[95vw]">
      <div className="p-6 pb-5">
        <div className="flex items-baseline justify-between mb-4 px-2">
          <div className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#141414]">
            Browse the store
          </div>
          <Link
            href="/products"
            className="text-xs font-bold text-[#141414] hover:underline"
          >
            View all categories →
          </Link>
        </div>

        {/* Icon tiles, not bare text rows: every category carries an
            admin-uploaded icon, and a 44px thumbnail makes the menu
            scannable the way the homepage category strip is — riders
            recognise the helmet silhouette faster than the word. Tile
            hover mirrors the brand-tile treatment used elsewhere
            (border darkens, arrow appears). */}
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-[68vh] overflow-y-auto pr-1">
          {topLevel.map((top) => (
            <li key={top._id} className="min-w-0">
              <Link
                href={categoryHref(top.name)}
                className="group flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 hover:border-[#e5e5e5] hover:bg-[#fafbf8] transition"
              >
                <span className="w-11 h-11 shrink-0 rounded-lg bg-[#f3f4f2] grid place-items-center overflow-hidden">
                  {top.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl(top.icon)}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[13px] font-bold text-[#9e9e9e]">
                      {top.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1 uppercase font-bold text-[13px] leading-snug tracking-wide text-[#141414]">
                  {top.name}
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-[#bdbdbd] opacity-0 -translate-x-1 transition group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-[#141414]"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom promo strip — pairs a quick-stat row with a Become-a-Seller
          CTA. Gives the menu a finished, marketing-quality feel instead
          of trailing off into whitespace. */}
      <div className="border-t border-[#eee] bg-[#fafbf8] px-6 py-4 flex items-center justify-between gap-6 rounded-b-lg">
        <div className="flex items-center gap-5 text-[12px] text-[#3a3a3a]">
          <span className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[#141414]" aria-hidden="true">
              <path d="M3 7h13l5 5v6h-3" />
              <circle cx="7" cy="18" r="2" />
              <circle cx="17" cy="18" r="2" />
              <path d="M3 7v11h2" />
            </svg>
            <span className="font-medium text-[#141414]">Free shipping</span>
            <span>on orders over ₹999</span>
          </span>
          <span className="hidden md:inline-flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[#141414]" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9" />
              <polyline points="3 4 3 12 11 12" />
            </svg>
            <span className="font-medium text-[#141414]">Easy returns</span>
            <span>on eligible products</span>
          </span>
        </div>
        <a
          href={sellerUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-[#c8ff00] text-[#141414] text-[12px] font-semibold px-3.5 py-2 rounded-md hover:bg-[#bfff00] whitespace-nowrap"
        >
          Become a Seller <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  );
}

/* ────────── Mega-menu trigger (HeroUI Popover) ────────── */
function MegaMenuTrigger({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  // Click-driven open/close. HeroUI's Popover handles the open state plus
  // outside-click and Escape dismissal on its own; we just track `isOpen`
  // so the trigger's caret can rotate to show the open state.
  const [isOpen, setIsOpen] = useState(false);
  const menuPathname = usePathname();

  // Auto-close the dropdown whenever the route changes (i.e. any link
  // inside the menu is clicked and Next navigates). Without this the
  // popover stays open after navigation and the user has to dismiss it
  // manually before they can read the destination page.
  useEffect(() => {
    setIsOpen(false);
  }, [menuPathname]);

  return (
    <Popover placement="bottom" offset={8} showArrow={false} isOpen={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          className="inline-flex items-center px-1 py-1 rounded hover:opacity-80 cursor-pointer"
        >
          {label}
        </button>
      </PopoverTrigger>
      {/* `p-0` strips HeroUI's default padding so each menu controls its
          own internal spacing. `overflow-hidden` keeps the bottom promo
          strip's rounded corners aligned with the popover's border radius.
          Click-anywhere-inside handler also dismisses the popover so
          link clicks close it even before Next finishes navigating. */}
      <PopoverContent
        className="bg-white text-[#141414] border border-[#eee] shadow-2xl p-0 overflow-hidden"
        onClick={(e) => {
          // Walk up from the click target until we find a clickable
          // element. Closing on every random click (e.g. background
          // padding) would be annoying, so only fire on anchors / role
          // buttons that are actually navigational.
          const target = e.target as HTMLElement | null;
          if (target?.closest('a, button[role="menuitem"], [data-mega-link]')) {
            setIsOpen(false);
          }
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/* (MobileSection — the per-category accordion — was removed when the
   drawer went parents-only; category drill-down happens on the category
   page itself, matching the desktop Categories menu.) */

/* ────────── Sub-nav category pill — three states ──────────
   - Default : transparent pill, dark-gray icon, no icon-tile bg
   - Hover   : light cream pill, icon tile gets #f3f4f2 bg, subtle lime
               wash on the pill bottom matches the Figma "hover" mock
   - Active  : light cream pill + black icon tile + white icon (matches
               the "selected" Figma mock; triggered by ?category= match) */
function SubNavPill({
  label,
  Icon,
  href,
  active,
}: {
  label: string;
  Icon: React.FC<{ className?: string }>;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      // Hover gradient sits on the WHOLE link (icon + label) so the
      // cream → lime wash covers the entire pill, not just the icon
      // tile. Active state stays restricted to the inner icon tile
      // (see below) so only the icon goes solid black on the current
      // category — the label sits underneath in the natural surface.
      className="group relative flex flex-col items-center justify-center gap-1 min-w-[84px] py-1 px-2 transition-colors duration-150 hover:bg-gradient-to-b hover:from-[#f3f4f2] hover:to-[#eaffb0]"
    >
      {/* Icon tile — only the tile flips to brand-black filled on the
          active category. On hover the tile stays transparent so the
          outer pill's gradient shows through behind the icon.
          Size: 32px tile, 8px inner padding (p-2) → 16px icon. */}
      <span
        className={`w-8 h-8 p-1.5 rounded-lg flex items-center justify-center transition-colors duration-150 ${active
          ? 'bg-[#141414] text-white'
          : 'text-[#424242] bg-transparent group-hover:text-[#141414]'
          }`}
      >
        <Icon className="w-6 h-6" />
      </span>
      <span
        className={`text-sm transition-colors ${active
          ? 'font-semibold text-[#141414]'
          : 'font-medium text-[#424242] group-hover:text-[#141414]'
          }`}
      >
        {label}
      </span>
    </Link>
  );
}

/* (Old Figma category icons removed along with SUB_NAV — the drawer's
   category list is now driven entirely by the live tree.) */

/* ────────── icons ────────── */
function SearchIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function CartIcon({ className = 'w-5 h-5' }: { className?: string }) {
  /* Shopping-bag icon — exact SVG provided by the user from Figma. */
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8.99998 11V6C8.99998 5.20435 9.31605 4.44129 9.87866 3.87868C10.4413 3.31607 11.2043 3 12 3C12.7956 3 13.5587 3.31607 14.1213 3.87868C14.6839 4.44129 15 5.20435 15 6V11M6.33099 8H17.67C17.9584 7.99997 18.2433 8.06229 18.5053 8.1827C18.7674 8.30311 19.0003 8.47876 19.188 8.6976C19.3758 8.91645 19.5141 9.17331 19.5933 9.45059C19.6725 9.72786 19.6908 10.019 19.647 10.304L18.392 18.456C18.283 19.1644 17.924 19.8105 17.38 20.2771C16.8359 20.7438 16.1428 21.0002 15.426 21H8.57399C7.85739 21 7.16447 20.7434 6.62062 20.2768C6.07677 19.8102 5.71791 19.1643 5.60899 18.456L4.35399 10.304C4.31016 10.019 4.32848 9.72786 4.40769 9.45059C4.48691 9.17331 4.62515 8.91645 4.81293 8.6976C5.00072 8.47876 5.23361 8.30311 5.49563 8.1827C5.75766 8.06229 6.04262 7.99997 6.33099 8Z" />
    </svg>
  );
}
function BikeIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
      <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
    </svg>
  );
}

/* ─── Account dropdown icons + chevron caret ─── */




/** Header wishlist heart: outline normally, the product-card pink
 *  gradient (stroke + fill) once wishlisted or hovered. No backdrop —
 *  the bordered button around it supplies the frame. */
function NavHeartIcon({ className = 'w-5 h-5', filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-heart-gradient" x1="3" y1="12" x2="21" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF3D68" />
          <stop offset="100%" stopColor="#FF7A9C" />
        </linearGradient>
      </defs>
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
        fill={filled ? 'url(#nav-heart-gradient)' : 'none'}
        stroke={filled ? 'url(#nav-heart-gradient)' : 'currentColor'}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-200"
      />
    </svg>
  );
}




function Caret({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
