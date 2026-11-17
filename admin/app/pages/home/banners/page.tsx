'use client';

/**
 * Standalone Hero banners editor — the same component is rendered inside the
 * /pages/home accordion, so any work there surfaces here too.
 */

import AdminShell from '@/components/AdminShell';
import HeroBannersEditor from '@/components/home-editors/HeroBannersEditor';
import { EditorPage, BackLink, EditorHeader, IconImage } from '@/components/EditorShell';
import form from '@/components/AdminForm.module.css';

export default function HeroBannersEditorPage() {
  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages/home">Home page</BackLink>
        <EditorHeader icon={<IconImage />} title="Hero banners" meta={['Home page section', 'The swiper at the top of the storefront']} />
        <section className={form.panel}>
          <div className={form.grid}>
            <div className={form.full}><HeroBannersEditor /></div>
          </div>
        </section>
      </EditorPage>
    </AdminShell>
  );
}
