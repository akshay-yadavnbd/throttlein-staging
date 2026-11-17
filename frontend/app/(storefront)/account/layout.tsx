// Route-segment config applied to every /account/* page.
//
// Account routes are personalised per logged-in user (orders, wishlist,
// addresses, profile). Nothing about them is statically prerenderable,
// and the global Navbar uses `useSearchParams()` which forces a CSR
// bail-out in Next 15. Marking the segment dynamic skips static
// prerender for every page below this layout and avoids the
// "useSearchParams() should be wrapped in a suspense boundary" error.
export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

// Block search engines from indexing the customer-account surface —
// every URL under /account is private to one signed-in user. The
// robots.txt already disallows the prefix, but the explicit `noindex`
// here keeps Google from showing the URL if it discovers it via a
// stray external link.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
