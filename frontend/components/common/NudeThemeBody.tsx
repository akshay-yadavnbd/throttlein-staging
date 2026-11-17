'use client';

import { useEffect } from 'react';

/**
 * Mirrors `data-theme="nude"` onto <body> for as long as the seller
 * dashboard is mounted.
 *
 * Why this exists
 *   The dashboard layout scopes the nude token set to a wrapper <div>,
 *   deliberately, so the public storefront and the seller marketing site
 *   keep their own design (see app/dashboard/layout.tsx).
 *
 *   HeroUI portals overlays — Dropdown, Modal, Tooltip, Select popovers —
 *   to <body>, which sits OUTSIDE that wrapper. Inside those overlays no
 *   nude custom property resolved, so `text-danger` on the Sign-out item
 *   rendered as inherited near-black instead of red, `bg-accent` on the
 *   role chip painted nothing at all, and `text-muted` came out as solid
 *   foreground. The tokens weren't wrong; they simply weren't in scope.
 *
 *   The admin panel never hit this because it sets `data-theme="nude"` on
 *   <html> in its root layout, so its portals inherit for free. The
 *   storefront prevents us from doing the same here, so the attribute is
 *   added on mount and removed on unmount instead — the dashboard gets
 *   themed portals, and every public route is untouched.
 *
 * Renders nothing.
 */
export default function NudeThemeBody() {
  useEffect(() => {
    const { body } = document;
    // Remember any pre-existing value so we restore rather than clobber.
    const previous = body.getAttribute('data-theme');
    body.setAttribute('data-theme', 'nude');
    return () => {
      if (previous === null) body.removeAttribute('data-theme');
      else body.setAttribute('data-theme', previous);
    };
  }, []);

  return null;
}
