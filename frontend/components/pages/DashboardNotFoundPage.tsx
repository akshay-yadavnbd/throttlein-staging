'use client';

import Link from 'next/link';
import Button from '@/components/common/SellerButton';

/**
 * 404 inside the seller portal (UX audit S12).
 *
 * An unknown /dashboard/* URL used to fall through to the STOREFRONT's
 * not-found page — public navbar, footer, "browse the shop" — so a seller
 * who mistyped a URL was dropped out of the portal with no way back but
 * the browser. `app/dashboard/[...rest]/page.tsx` routes every unmatched
 * dashboard path here instead, inside the shell, with the sidebar intact.
 */
export default function DashboardNotFoundPage() {
  return (
    <>
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-xs font-medium text-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">There’s no page here</h1>
        <p className="mt-2 text-sm text-muted">
          The link may be old or mistyped. Everything in the portal is in the menu on the left.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/dashboard">
            <Button color="primary" className="font-semibold">Go to dashboard</Button>
          </Link>
          <Link href="/dashboard/orders">
            <Button variant="bordered" className="font-semibold">Open orders</Button>
          </Link>
        </div>
      </div>
    </>
  );
}
