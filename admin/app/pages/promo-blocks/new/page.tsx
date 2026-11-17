'use client';

/**
 * Create a new promo block — `/pages/promo-blocks/new`. Thin wrapper
 * around the shared `<PromoBlockForm>`; on success the form returns to
 * the list.
 */

import AdminShell from '@/components/AdminShell';
import PromoBlockForm, { emptyPromoBlockForm } from '../PromoBlockForm';
import { EditorPage, BackLink, EditorHeader, IconLayout } from '@/components/EditorShell';
import form from '@/components/AdminForm.module.css';

export default function NewPromoBlockPage() {
  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages/promo-blocks">Promo blocks</BackLink>
        <EditorHeader icon={<IconLayout />} title="New promo block" meta={['Home page section']} />
        <section className={form.panel}>
          <div className={form.grid}>
            <div className={form.full}><PromoBlockForm mode="create" initial={emptyPromoBlockForm} /></div>
          </div>
        </section>
      </EditorPage>
    </AdminShell>
  );
}
