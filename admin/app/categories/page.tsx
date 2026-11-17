'use client';

import AdminShell from '@/components/AdminShell';
import ModuleTabs from '@/components/ModuleTabs';
import CategoryTable from '@/components/CategoryTable';
import list from '@/components/WorkspaceList.module.css';

const SHOP_BY_BIKE_ROOT = 'Shop by Bike';

/**
 * Storefront categories tab. Deliberately chrome-free per product
 * decision: no hero, no status row, no list heading — the section tab
 * names the screen and the table (with its pagination summary) carries
 * the counts. Bike makes/models are excluded here; they live in the
 * Shop by Bike tab.
 */
export default function CategoriesPage() {
  return (
    <AdminShell>
      {/* The tabs share the workspace page column with the table, so
          both start at the same left edge on wide screens. */}
      <div className={list.page}>
        {/* Catalogue section tabs — Brands / Categories / Shop by Bike /
            Brand requests share one sidebar entry. */}
        <ModuleTabs moduleKey="brands" />

        <CategoryTable
          excludeRootName={SHOP_BY_BIKE_ROOT}
          emptyText="No storefront categories yet."
        />
      </div>
    </AdminShell>
  );
}
