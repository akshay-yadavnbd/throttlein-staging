'use client';
import AdminShell from '@/components/AdminShell';
import OrdersTabs from '@/components/OrdersTabs';
import CheckoutFailures from '@/components/CheckoutFailures';
import list from '@/components/WorkspaceList.module.css';

export default function CheckoutFailuresPage() {
  // The tabs share the workspace page column with the panel, so both
  // start at the same left edge on wide screens.
  return (
    <AdminShell>
      <div className={list.page}>
        <OrdersTabs />
        <CheckoutFailures />
      </div>
    </AdminShell>
  );
}
