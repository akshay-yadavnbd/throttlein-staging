'use client';

/**
 * SellerGuideSectionEditor — singleton panel for the heading +
 * subheading shown above the guide cards on the seller landing page
 * (seller.throttlein.com/). Backed by GET / PUT /api/seller-guide-section;
 * the visible toggle hides the whole section from the storefront.
 */

import { useEffect, useState } from 'react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import { api, envelopeOrLegacy } from '@/lib/api';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type Section = {
  heading: string;
  subheading: string;
  isActive: boolean;
};

const EMPTY: Section = { heading: '', subheading: '', isActive: true };

export default function SellerGuideSectionEditor() {
  const [draft, setForm] = useState<Section | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/seller-guide-section').then(envelopeOrLegacy)
      .then(({ data }) => setForm(data?.section ? {
        heading: data.section.heading || '',
        subheading: data.section.subheading || '',
        isActive: data.section.isActive !== false,
      } : EMPTY))
      .catch((err: any) => { notifyError(err, M.sellEditors.couldntLoad); setForm(EMPTY); });
  }, []);

  const set = (patch: Partial<Section>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await api.put('/seller-guide-section', draft);
      notifySuccess(M.sellEditors.sectionSaved);
    } catch (err: any) {
      notifyError(err, M.sellEditors.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={form.panel} aria-labelledby="guide-section-heading">
      <div className={`${form.head} ${form.headRow}`}>
        <div><h2 id="guide-section-heading">Guide section heading</h2><p>Shown above the guide cards on the seller landing page.</p></div>
        {draft && (
          <div className={form.toggleCell}>
            <AdminSwitch isSelected={draft.isActive} onValueChange={(v) => set({ isActive: v })} aria-label="Section visible" />
            <span>{draft.isActive ? 'Shown' : 'Hidden'}</span>
          </div>
        )}
      </div>
      <div className={form.grid}>
        {!draft ? (
          <div className={`${form.full} ${form.empty}`}>Loading…</div>
        ) : (
          <>
            <div className={form.full}><AdminInput label="Heading" value={draft.heading} onChange={(e) => set({ heading: e.target.value })} placeholder="Your seller's playbook" /></div>
            <div className={form.full}><AdminTextarea label="Subheading" value={draft.subheading} onChange={(e) => set({ subheading: e.target.value })} minRows={2} maxLength={500} placeholder="Quick reads to help you list smarter, price right, and ship without stress." description="Optional." /></div>
            <div className={`${form.full} ${form.accFoot}`} style={{ justifyContent: 'flex-end' }}>
              <AdminButton color="primary" isLoading={saving} onPress={save}>Save heading</AdminButton>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
