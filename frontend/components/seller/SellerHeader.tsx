'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import SellerLogo from '@/components/seller/SellerLogo';
// SELLER_HEADER_NAV, not SELLER_NAV: the header hides groups whose pages
// aren't written yet (currently "Grow"). See HEADER_HIDDEN_GROUPS.
import { SELLER_HEADER_NAV, SELLER_CTA, type SellerNavGroup } from '@/lib/sellerNav';

/**
 * Seller-property header — Figma node 4583:9559.
 *
 * Sticky white bar, bottom border #eee. Left: the SELLER HUB lockup.
 * Centre: four dropdown pills. Right: an outlined Login/Signup and a
 * black Start Selling CTA.
 *
 * Rendered once by `app/seller/layout.tsx`, so it appears on every
 * seller-property page — the landing page, the blog, CMS pages, and the
 * auth screens — rather than being re-mounted per page as the old
 * `MarketingHeader` was.
 *
 * The dropdown items come from `lib/sellerNav.ts`, shared with the
 * footer so the two can't drift.
 */
export default function SellerHeader() {
  // Which pill's menu is open, by label. Only one at a time.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  // Close the desktop dropdown on outside click / Escape.
  useEffect(() => {
    if (!openMenu) return;
    function onDocClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenMenu(null);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  return (
    <header
      id="seller-header"
      className="bg-white border-b border-[#eee] sticky top-0 z-40"
    >
      <div className="max-w-[1512px] mx-auto px-4 sm:px-6 lg:px-10 py-3 flex items-center justify-between gap-3">
        {/* ── Left: logo ── */}
        <div className="flex items-center shrink-0">
          <SellerLogo height={33} />
        </div>

        {/* ── Centre: dropdown nav (desktop only) ──
            Wider gap than the Figma pills needed: with the pill
            backgrounds gone the labels have no padding of their own, so
            the spacing between them has to come from here. */}
        <div ref={navRef} className="hidden lg:flex items-center gap-7">
          {SELLER_HEADER_NAV.map((group) => (
            <DropdownPill
              key={group.label}
              group={group}
              isOpen={openMenu === group.label}
              onToggle={() =>
                setOpenMenu((cur) => (cur === group.label ? null : group.label))
              }
              onClose={() => setOpenMenu(null)}
            />
          ))}
        </div>

        {/* ── Right: CTAs ── */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link
            href={SELLER_CTA.login.href}
            className="hidden sm:inline-flex items-center justify-center min-h-10 px-4 py-1 border border-[#bdbdbd] rounded-lg text-sm leading-[1.3] text-[#212121] hover:bg-[#f5f5f5] active:bg-[#eee] transition"
          >
            {SELLER_CTA.login.label}
          </Link>
          <Link
            href={SELLER_CTA.register.href}
            /* The Figma CTA carries an inset shadow that reads as a
               subtle bevel on the black fill — reproduced here rather
               than flattened, since it's what separates this button
               from a plain black rectangle. */
            className="inline-flex items-center justify-center min-h-10 px-4 py-1 rounded-lg bg-black text-white text-sm leading-[1.3] whitespace-nowrap transition hover:bg-[#212121] shadow-[inset_0px_0.5px_0.5px_1px_rgba(255,255,255,0.32),inset_0px_-1px_0px_1px_rgba(0,0,0,1)]"
          >
            {SELLER_CTA.register.label}
          </Link>

          {/* Mobile menu toggle — the pills collapse into a drawer. */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-[#e0e0e0] text-[#212121] hover:bg-[#f5f5f5] transition"
          >
            <MenuIcon />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <MobileDrawer onClose={() => setMobileOpen(false)} />
      )}
    </header>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Dropdown nav item.
 *
 * The Figma frame specifies the "Dropdown Pills" component (3139:3551)
 * — a pill with a filled background on hover/open. We use the plain
 * text + caret treatment from the storefront Navbar instead, at the
 * product owner's request, so the two headers read as the same family.
 * Matches `Navbar.tsx`'s Categories trigger: no background, gap-1,
 * hover:opacity-80, caret flips 180° when open.
 * ──────────────────────────────────────────────────────────────── */
function DropdownPill({
  group,
  isOpen,
  onToggle,
  onClose,
}: {
  group: SellerNavGroup;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        /* `min-h-10` matches the CTA buttons' height. Nothing is painted,
           so it's invisible — but it gives the label a 40px pointer
           target instead of an 18px one, and it makes the button's
           bottom edge sit a predictable 12px (the header's py-3) above
           the header border, which is what the menu offset below
           depends on. */
        className="inline-flex items-center gap-1 min-h-10 text-sm leading-[1.3] text-[#141414] hover:opacity-80 transition cursor-pointer"
      >
        <span className="whitespace-nowrap">{group.label}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          /* +12px == the header's py-3, so the menu hangs off the
             header's bottom border rather than floating inside it. */
          className="absolute left-0 top-[calc(100%+12px)] min-w-[240px] bg-white border border-[#eee] rounded-xl shadow-lg overflow-hidden py-2 z-50"
        >
          {group.links.map((link) => (
            <Link
              key={link.href + link.label}
              href={link.href}
              role="menuitem"
              onClick={onClose}
              className="block px-4 py-2.5 text-sm leading-[1.52] text-[#424242] hover:bg-[#f3f4f2] hover:text-[#141414] transition"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Mobile drawer — the pills as expandable sections. The design is
 * desktop-only, so this is an adaptation rather than a translation:
 * the same links, in a full-screen sheet.
 * ──────────────────────────────────────────────────────────────── */
function MobileDrawer({ onClose }: { onClose: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(SELLER_HEADER_NAV[0]?.label ?? null);

  return (
    <div className="lg:hidden fixed inset-0 z-50 bg-white flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-[#eee] shrink-0">
        <SellerLogo height={30} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-[#e0e0e0] text-[#212121] hover:bg-[#f5f5f5] transition"
        >
          <CloseIcon />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {SELLER_HEADER_NAV.map((group) => {
          const open = expanded === group.label;
          return (
            <div key={group.label} className="border-b border-[#eee] last:border-b-0">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : group.label)}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-3 py-4 text-left text-base font-medium text-[#141414]"
              >
                {group.label}
                <ChevronDown
                  className={`w-5 h-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </button>
              {open && (
                <div className="pb-3 flex flex-col">
                  {group.links.map((link) => (
                    <Link
                      key={link.href + link.label}
                      href={link.href}
                      onClick={onClose}
                      className="py-2.5 text-sm text-[#424242] hover:text-[#141414] transition"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-[#eee] px-4 sm:px-6 py-4 flex flex-col gap-3">
        <Link
          href={SELLER_CTA.login.href}
          onClick={onClose}
          className="inline-flex items-center justify-center min-h-10 px-4 py-2 border border-[#bdbdbd] rounded-lg text-sm text-[#212121] hover:bg-[#f5f5f5] transition"
        >
          {SELLER_CTA.login.label}
        </Link>
        <Link
          href={SELLER_CTA.register.href}
          onClick={onClose}
          className="inline-flex items-center justify-center min-h-10 px-4 py-2 rounded-lg bg-black text-white text-sm hover:bg-[#212121] transition"
        >
          {SELLER_CTA.register.label}
        </Link>
      </div>
    </div>
  );
}

/* ─── Icons ─── */
function ChevronDown({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function MenuIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function CloseIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
