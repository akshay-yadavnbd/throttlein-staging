'use client';

/**
 * Standalone SEO block editor — the same component is rendered inside the
 * /pages/home accordion, so any work there surfaces here too.
 */

import AdminShell from '@/components/AdminShell';
import HomeSeoBlockEditor from '@/components/home-editors/HomeSeoBlockEditor';
import { EditorPage, BackLink, EditorHeader, IconSearch } from '@/components/EditorShell';
import form from '@/components/AdminForm.module.css';

export default function HomeSeoBlockEditorPage() {
  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages/home">Home page</BackLink>
        <EditorHeader icon={<IconSearch />} title="SEO block" meta={['Home page section', 'Chip clouds and content at the foot of the home page']} />
        <section className={form.panel}>
          <div className={form.grid}>
            <div className={form.full}><HomeSeoBlockEditor /></div>
          </div>
        </section>
      </EditorPage>
    </AdminShell>
  );
}
