'use client';

import { Drawer } from '@heroui-v3/react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * The application chrome: sidebar + content, responsive.
 *
 * ── THE BUG THIS FIXES ──────────────────────────────────────────────
 * `AdminShell` renders its sidebar as `w-64 shrink-0 … sticky top-0
 * h-screen` with NO breakpoint, no hamburger, no `hidden md:flex`. On a
 * 390px viewport the sidebar takes 256px and `<main className="flex-1
 * min-w-0 p-6">` is left with roughly 110px. **All 48 AdminShell pages are
 * unusable on a phone.** That is the single highest-impact finding in the
 * audit, because it is not a per-page problem.
 *
 * `SellerShell` does have a drawer, but with its own defects, all of which
 * this avoids by using v3's `Drawer` (React Aria) rather than hand-rolling:
 *   - drawer `w-72` didn't match the sidebar's `w-64`
 *   - it stayed in the DOM and focusable when closed (`aria-hidden` only,
 *     no `inert`), so keyboard users tabbed into an invisible menu
 *   - no focus trap, no focus return on close, no Escape handler
 *   - the scrim was a `<div onClick>` with no role and no keyboard path
 *
 * ── PRESENTATIONAL ONLY, DELIBERATELY ───────────────────────────────
 * This component knows nothing about auth, permissions, site switching or
 * badge counts. Those live in `AdminShell` and are load-bearing business
 * logic — `buildNav`, `canAccessNav`, the URL guard, `MAIN_ONLY_PATHS`.
 * Re-implementing them here to get a nicer shell would risk changing who
 * can see what, which is explicitly out of scope for a UI redesign.
 *
 * So the nav arrives as a rendered `nav` slot. `AdminShell` keeps deciding
 * WHAT to show; this decides HOW it lays out. Swapping AdminShell onto this
 * is its own verified step, not part of building it.
 *
 * ── THE SIDEBAR IS NOW LIGHT ────────────────────────────────────────
 * `bg-surface-tertiary` (#EFE9E1) with `text-foreground` — 12.67:1, AAA.
 * That replaces the `bg-brand-black text-brand-cream` sidebar, which was
 * the largest single dark surface in both apps.
 */

export type AppShellProps = {
  /** Logo / wordmark block, top of the sidebar. */
  brand: ReactNode;
  /** The nav itself — already permission-filtered by the caller. */
  nav: ReactNode;
  /** Site switcher or similar, directly under the brand. */
  toolbar?: ReactNode;
  /** User block / sign-out, pinned to the sidebar bottom. */
  footer?: ReactNode;
  /** Page content. */
  children: ReactNode;
  /** Accessible name for the nav landmark. */
  navLabel?: string;
};

/** Sidebar innards, rendered twice: once fixed, once inside the drawer. */
function SidebarContent({
  brand,
  toolbar,
  nav,
  footer,
  navLabel,
}: Pick<AppShellProps, 'brand' | 'nav' | 'toolbar' | 'footer'> & { navLabel: string }) {
  return (
    <>
      <div className="shrink-0 px-4 py-5">{brand}</div>
      {toolbar && <div className="shrink-0 border-b border-separator px-3 pb-4">{toolbar}</div>}
      {/* `min-h-0` is required for `overflow-y-auto` to work inside a flex
          column — without it the nav grows and the whole sidebar scrolls,
          taking the footer out of reach. */}
      <nav aria-label={navLabel} className="min-h-0 flex-1 overflow-y-auto p-3">
        {nav}
      </nav>
      {footer && <div className="shrink-0 border-t border-separator p-3">{footer}</div>}
    </>
  );
}

export default function AppShell({
  brand,
  nav,
  toolbar,
  footer,
  children,
  navLabel = 'Main navigation',
}: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* ── Desktop sidebar ──────────────────────────────────────────
          `hidden lg:flex` — the breakpoint AdminShell never had. `lg` not
          `md`: at 768px a 256px sidebar still leaves too little for the
          wide tables these pages render. */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-separator bg-surface-tertiary lg:flex">
        <SidebarContent brand={brand} footer={footer} nav={nav} navLabel={navLabel} toolbar={toolbar} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Mobile top bar ─────────────────────────────────────────
            Only below `lg`. Sticky so the menu is reachable after scrolling
            a long table. */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-separator bg-surface-tertiary px-3 lg:hidden">
          {/* `key={pathname}` remounts the Drawer on navigation, which
              closes it. Without this the menu stays open behind the new
              page — the bug SellerShell works around with a pathname
              effect. Remounting is simpler and can't get out of sync. */}
          <Drawer key={pathname}>
            {/* MUST be `Drawer.Trigger`, not an arbitrary button.
                `DrawerRootProps extends ComponentPropsWithRef<typeof
                DrawerTriggerPrimitive>` — the root wires the trigger by
                inspecting its own children, so wrapping the button in a
                custom component (my `IconButton`, which also renders a
                Tooltip) breaks the chain silently: the drawer renders, the
                button renders, and clicking does nothing. Verified by real
                pointer click, which is the only way this shows up —
                a synthetic `.click()` misleadingly appeared to work.

                `Drawer.Trigger` IS a Button, so it takes `aria-label`
                directly. */}
            <Drawer.Trigger
              aria-label="Open navigation menu"
              className="grid size-9 place-items-center rounded-lg text-foreground transition-colors hover:bg-surface-secondary"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5" aria-hidden>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </Drawer.Trigger>

            {/* Backdrop + Dialog give focus trap, focus return, Escape and
                scroll lock from React Aria. All four were missing from the
                hand-rolled seller drawer. */}
            <Drawer.Backdrop>
              <Drawer.Content placement="left">
                <Drawer.Dialog className="flex h-full w-72 flex-col bg-surface-tertiary p-0">
                  {/* A dialog needs an accessible name. Visually hidden
                      because the brand block below is the visible heading. */}
                  <Drawer.Heading className="sr-only">Navigation</Drawer.Heading>

                  {/* An EXPLICIT close control, not only Escape and
                      outside-click.
                      Two reasons. First, the ARIA dialog pattern expects a
                      visible, focusable way out — Escape is a convention
                      many users don't know, and outside-click is invisible.
                      Second, honesty about verification: I could not get
                      Escape to dismiss this drawer under automation, and I
                      could not establish whether that's a real defect or an
                      artefact of how the test harness injects the keypress.
                      React Aria's ModalOverlay enables keyboard dismissal by
                      default (HeroUI passes `isDismissable` and never sets
                      `isKeyboardDismissDisabled`), so it most likely works
                      for a real user — but "most likely" is not a basis for
                      shipping the only escape route. This button removes the
                      question. */}
                  <Drawer.CloseTrigger
                    aria-label="Close navigation menu"
                    className="absolute end-2 top-2 grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5" aria-hidden>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </Drawer.CloseTrigger>

                  <SidebarContent
                    brand={brand}
                    footer={footer}
                    nav={nav}
                    navLabel={navLabel}
                    toolbar={toolbar}
                  />
                </Drawer.Dialog>
              </Drawer.Content>
            </Drawer.Backdrop>
          </Drawer>

          <div className="min-w-0 flex-1">{brand}</div>
        </header>

        {/* `min-w-0` lets wide tables scroll inside their own container
            instead of stretching this column and the whole page. */}
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
