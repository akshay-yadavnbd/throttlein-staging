'use client';

/**
 * /pages/sell/new — create a new Seller Guide. Same wrapper as
 * /blogs/new so the two flows feel like mirrors of each other.
 */

import AdminShell from '@/components/AdminShell';
import SellerGuideForm from '@/components/SellerGuideForm';
import { EditorPage, BackLink } from '@/components/EditorShell';

export default function NewSellerGuidePage() {
  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages/sell">Seller home</BackLink>
        <SellerGuideForm mode="create" />
      </EditorPage>
    </AdminShell>
  );
}
