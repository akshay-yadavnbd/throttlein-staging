"use client";

import Link from 'next/link';
import { useSellerAttention } from '@/lib/useSellerAttention';
import styles from './SellerOrdersTabs.module.css';

type OrdersSection = 'orders' | 'delivery' | 'returns';

export default function SellerOrdersTabs({ active }: { active: OrdersSection }) {
  const attention = useSellerAttention();
  const tabs = [
    { key: 'orders', href: '/dashboard/orders', label: 'Orders', count: undefined },
    { key: 'delivery', href: '/dashboard/ndr', label: 'Delivery issues', count: attention?.deliveryIssues },
    { key: 'returns', href: '/dashboard/return-requests', label: 'Returns & exchanges', count: attention?.returnsPending },
  ];
  return <nav className={`seller-tab-row ${styles.navigation}`} aria-label="Order management sections">
    {tabs.map(tab => <Link key={tab.key} href={tab.href} aria-current={active === tab.key ? 'page' : undefined}>
      {tab.label}{tab.count ? <span>{tab.count}</span> : null}
    </Link>)}
  </nav>;
}
