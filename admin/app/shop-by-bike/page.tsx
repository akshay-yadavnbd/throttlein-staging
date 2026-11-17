'use client';

import AdminShell from '@/components/AdminShell';
import ModuleTabs from '@/components/ModuleTabs';
import CategoryTable from '@/components/CategoryTable';
import list from '@/components/WorkspaceList.module.css';

/**
 * Shop by Bike tab — bike makes and their models, scoped to the
 * "Shop by Bike" category root. Chrome-free per product decision (see
 * the note on the Categories page).
 */
export default function ShopByBikePage() {
  return (
    <AdminShell>
      {/* The tabs share the workspace page column with the table, so
          both start at the same left edge on wide screens. */}
      <div className={list.page}>
        {/* Catalogue section tabs — Brands / Categories / Shop by Bike /
            Brand requests share one sidebar entry. */}
        <ModuleTabs moduleKey="brands" />

        <CategoryTable
          rootName="Shop by Bike"
          listTitle="Makes & models"
          addTitle="Add New Make / Model"
          emptyText="No makes added yet."
        />
      </div>
    </AdminShell>
  );
}
