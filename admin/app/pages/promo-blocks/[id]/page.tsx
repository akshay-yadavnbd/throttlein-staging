'use client';

/**
 * Edit a single promo block — `/pages/promo-blocks/[id]`. Fetches the
 * block, then hands the loaded form state to the shared
 * `<PromoBlockForm>`; on success the form returns to the list.
 */

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '@/components/AdminShell';
import { StatusChip } from '@/components/ui';
import { EditorPage, BackLink, EditorHeader, EditorSkeleton, IconLayout } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import PromoBlockForm, {
  emptyPromoBlockForm,
  type PromoBlockFormState,
  type PromoBlockVariant,
} from '../PromoBlockForm';
import { notifyError } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type LoadedBlock = {
  _id: string;
  title: string;
  variant: PromoBlockVariant;
  chips: { label: string; href: string }[];
  ctaLabel: string;
  ctaHref: string;
  images: string[];
  order: number;
  isActive: boolean;
};

export default function EditPromoBlockPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = use(params);
  const router = useRouter();
  const [loaded, setLoaded] = useState<PromoBlockFormState | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/promo-blocks/admin/${id}`).then((r) => {
      const b: LoadedBlock = unwrap<{ item: LoadedBlock }>(r).item;
      if (cancelled) return;
      setLoaded({
        ...emptyPromoBlockForm,
        title: b.title || '',
        variant: b.variant || 'image-grid',
        chips: Array.isArray(b.chips) ? b.chips.map((c) => ({ label: c.label || '', href: c.href || '' })) : [],
        ctaLabel: b.ctaLabel || '',
        ctaHref: b.ctaHref || '',
        images: Array.isArray(b.images) ? b.images.filter(Boolean) : [],
        order: typeof b.order === 'number' ? b.order : 0,
        isActive: !!b.isActive,
      });
    }).catch((e: any) => {
      if (cancelled) return;
      notifyError(e, M.pages.couldntLoadBlock);
      router.push('/pages/promo-blocks');
    });
    return () => { cancelled = true; };
  }, [id, router]);

  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages/promo-blocks">Promo blocks</BackLink>
        {loaded ? (
          <>
            <EditorHeader
              icon={<IconLayout />}
              title={<>{loaded.title || 'Promo block'}<StatusChip status={loaded.isActive ? 'active' : 'inactive'} /></>}
              meta={['Home page section', loaded.variant === 'image-grid' ? 'Wide card' : 'Tall card', `→ ${loaded.ctaHref || '…'}`]}
            />
            <section className={form.panel}>
              <div className={form.grid}>
                <div className={form.full}><PromoBlockForm mode="edit" blockId={id} initial={loaded} /></div>
              </div>
            </section>
          </>
        ) : (
          <EditorSkeleton label="Loading promo block" />
        )}
      </EditorPage>
    </AdminShell>
  );
}
