"use client";

import { usePathname } from 'next/navigation';
import SellerShell from './SellerShell';

/** One persistent frame for the seller workspace; invoice previews stand alone. */
export default function SellerDashboardFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (/^\/dashboard\/offline-sales\/[^/]+\/invoice\/?$/.test(pathname)) return <>{children}</>;
  return <SellerShell>{children}</SellerShell>;
}
