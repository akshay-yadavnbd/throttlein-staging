'use client';

import ModuleTabs from '@/components/ModuleTabs';

/**
 * Orders section tabs — thin wrapper over the generic ModuleTabs (the
 * same mechanism now drives Pages and Blogs). Kept as its own component
 * because three pages import it, and because this is where the parked
 * tab is documented:
 *
 * COD remittance is PARKED, not deleted: Shiprocket's API 404s its
 * endpoint (`GET /account/details/cod-remittance` isn't in their
 * documented collection), so the tab could only ever show an error
 * panel. The page (/shiprocket/cod-remittance) and backend route are
 * kept intact — restore the `{ href: '/shiprocket/cod-remittance',
 * label: 'COD remittance' }` child in lib/modules.ts if Shiprocket
 * enables the endpoint for this account, and the tab reappears here.
 */
export default function OrdersTabs({ className = 'mb-4' }: { className?: string }) {
  return <ModuleTabs className={className} moduleKey="orders" />;
}
