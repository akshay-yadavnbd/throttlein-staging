'use client';

/**
 * Standalone Seller callout editor — the same component is rendered inside the
 * /pages/home accordion, so any work there surfaces here too.
 */

import AdminShell from '@/components/AdminShell';
import SellerCtaEditor from '@/components/home-editors/SellerCtaEditor';
import { EditorPage, BackLink, EditorHeader, IconHome } from '@/components/EditorShell';
import form from '@/components/AdminForm.module.css';

export default function SellerCtaEditorPage() {
  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages/home">Home page</BackLink>
        <EditorHeader icon={<IconHome />} title="Seller callout" meta={['Home page section', 'Near the foot of the home page']} />
        <section className={form.panel}>
          <div className={form.grid}>
            <div className={form.full}><SellerCtaEditor /></div>
          </div>
        </section>
      </EditorPage>
    </AdminShell>
  );
}
