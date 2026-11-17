// Route-segment config applied to every /dashboard/* page.
//
// Seller dashboard pages are personalised + auth-gated (own products,
// orders, KYC, profile). They aren't statically prerenderable and rely
// on the Navbar / SellerShell which use `useSearchParams()`. Forcing
// dynamic here skips static prerender for every page below this
// layout and avoids the "useSearchParams() should be wrapped in a
// suspense boundary" CSR-bailout error.
export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import NudeThemeBody from '@/components/common/NudeThemeBody';
import SellerAssistant from '@/components/common/SellerAssistant';
import SellerDashboardFrame from '@/components/common/SellerDashboardFrame';

// Seller dashboard is auth-gated and entirely behind login — keep it
// out of search engine indexes. robots.txt already disallows /dashboard
// but adding the meta robots tag here is belt-and-braces.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // Every dashboard route used to carry the storefront's title (UX audit
  // S12). Each page exports its own `title`; this template frames it.
  title: { template: '%s · Seller portal', default: 'Seller portal · THROTTLEIN' },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  /**
   * `data-theme="nude"` activates the HeroUI v3 token set from
   * app/themes/nude.css for the seller dashboard ONLY.
   *
   * Scoped here rather than on <html> deliberately. This app also serves
   * the public storefront (throttlein.com) and the seller marketing
   * property (seller.throttlein.com), both built to a separate Figma
   * design. Theming at the root would restyle those public pages, which is
   * outside the scope of the dashboard redesign.
   *
   * HeroUI v3's tokens are plain CSS custom properties on an attribute
   * selector, so they cascade to this subtree and stop at its boundary.
   * The wrapper also carries `bg-background text-foreground` so the
   * dashboard picks up the nude surfaces instead of inheriting the
   * storefront's cream body.
   *
   * `min-h-screen` keeps the nude background covering the viewport even on
   * short pages, where the body background would otherwise show through.
   *
   * <NudeThemeBody> additionally mirrors the attribute onto <body> while
   * this layout is mounted. HeroUI portals dropdowns and modals to <body>,
   * outside this wrapper, where none of the tokens above resolved — see
   * that component for the specifics.
   */
  return (
    <div data-theme="nude" className="min-h-screen bg-background text-foreground">
      <NudeThemeBody />
      <SellerDashboardFrame>{children}</SellerDashboardFrame>
      {/* Floating AI assistant (chatbot/). Renders nothing until the service confirms a seller session. */}
      <SellerAssistant />
    </div>
  );
}
