'use client';

/**
 * Standalone Promo blocks editor — the same component is rendered inside the
 * /pages/home accordion, so any work there surfaces here too.
 */

import AdminShell from '@/components/AdminShell';
import PromoBlocksEditor from '@/components/home-editors/PromoBlocksEditor';
import { EditorPage, BackLink, EditorHeader, IconLayout } from '@/components/EditorShell';
import form from '@/components/AdminForm.module.css';

export default function PromoBlocksEditorPage() {
  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages/home">Home page</BackLink>
        <EditorHeader icon={<IconLayout />} title="Promo blocks" meta={['Home page section', 'The three-card group on the home page']} />
        <section className={form.panel}>
          <div className={form.grid}>
            <div className={form.full}><PromoBlocksEditor /></div>
          </div>
        </section>
      </EditorPage>
    </AdminShell>
  );
}
