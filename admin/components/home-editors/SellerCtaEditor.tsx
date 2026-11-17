'use client';

/**
 * Seller CTA editor — shared component, mounted in the home page
 * accordion AND in the standalone /pages/home/seller-cta page.
 *
 * Singleton form for the "Take your offline business online" callout
 * near the foot of the home page. Image fields use the MediaPicker so
 * admins can re-use existing assets from the library.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import ImageSlot from '@/components/media/ImageSlot';
import { Field } from '@/components/EditorShell';
import { api, unwrap, envelopeOrLegacy } from '@/lib/api';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type Cta = {
  bgImage: string;
  portraitImage: string;
  heading: string;
  subtext: string;
  ctaLabel: string;
  ctaHref: string;
  isActive: boolean;
};

const empty: Cta = {
  bgImage: '',
  portraitImage: '',
  heading: '',
  subtext: '',
  ctaLabel: '',
  ctaHref: '',
  isActive: true,
};

export type SellerCtaEditorHandle = { save: () => Promise<void> };

type SellerCtaEditorProps = {
  /** When true, hides the form's own Save button — the master page
   *  drives saving via the imperative ref instead. */
  hideSaveButton?: boolean;
};

const SellerCtaEditor = forwardRef<SellerCtaEditorHandle, SellerCtaEditorProps>(
  function SellerCtaEditor({ hideSaveButton = false }, ref) {
  const [draft, setForm] = useState<Cta | null>(null);
  const [saving, setSaving] = useState(false);

  // Latest snapshot, so the imperative save() called by the master page
  // always sees the current values without re-binding the handle.
  const formRef = useRef<Cta>(empty);
  useEffect(() => { if (draft) formRef.current = draft; }, [draft]);

  useEffect(() => {
    api.get('/seller-cta').then(envelopeOrLegacy)
      .then(({ data }) => setForm({ ...empty, ...(data?.cta || {}) }))
      .catch(() => { notifyWarning(M.homeEditors.couldNotLoadSellerCTA); setForm(empty); });
  }, []);

  function patch<K extends keyof Cta>(key: K, value: Cta[K]) {
    setForm((s) => (s ? { ...s, [key]: value } : s));
  }

  async function save() {
    setSaving(true);
    try {
      const data = unwrap<{ cta?: any }>(await api.put('/seller-cta', formRef.current));
      if (data?.cta) setForm({ ...empty, ...data.cta });
      notifySuccess(M.homeEditors.sellerCTASaved);
    } catch (err: any) {
      notifyError(err, M.homeEditors.couldntSave);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  useImperativeHandle(ref, () => ({ save }), []);

  if (!draft) return <div className={form.empty}>Loading the seller callout…</div>;

  return (
    <div className={form.grid} style={{ padding: 0 }}>
      <div className={`${form.section} ${form.sectionRow}`}>
        <div><h3>Seller callout</h3><p>Near the foot of the home page. Turn it off to hide the block without losing the content.</p></div>
        <div className={form.toggleCell}><AdminSwitch isSelected={draft.isActive} onValueChange={(v) => patch('isActive', v)} aria-label="Section visible" /><span>{draft.isActive ? 'Shown' : 'Hidden'}</span></div>
      </div>
      <div className={`${form.full} ${form.tiles}`}>
        <Field label="Background photo" hint="Wide photo behind the left-to-right black gradient. The text sits over the dark side, so pick detail on the left half.">
          <ImageSlot label="" aspect="aspect-[3/2]" hint="No image" value={draft.bgImage} onChange={(url) => patch('bgImage', url)} uploadEndpoint="/seller-cta/upload" />
        </Field>
        <Field label="Portrait photo" hint="Square photo on the right — a seller with a laptop, a storefront. Cropped square on the page.">
          <ImageSlot label="" aspect="aspect-square" hint="No image" value={draft.portraitImage} onChange={(url) => patch('portraitImage', url)} uploadEndpoint="/seller-cta/upload" />
        </Field>
      </div>
      <div className={form.full}><AdminInput label="Heading" value={draft.heading} onChange={(e) => patch('heading', e.target.value)} maxLength={120} /></div>
      <div className={form.full}><AdminTextarea label="Subtext" value={draft.subtext} onChange={(e) => patch('subtext', e.target.value)} maxLength={280} minRows={2} description="Under two lines on desktop reads best." /></div>
      <AdminInput label="Button text" value={draft.ctaLabel} onChange={(e) => patch('ctaLabel', e.target.value)} maxLength={60} />
      <AdminInput label="Button link" value={draft.ctaHref} onChange={(e) => patch('ctaHref', e.target.value)} placeholder="/seller" />
      {!hideSaveButton && (
        <div className={`${form.full} ${form.accFoot}`} style={{ justifyContent: 'flex-end' }}>
          <AdminButton color="primary" isLoading={saving} onPress={save}>Save changes</AdminButton>
        </div>
      )}
    </div>
  );
});

export default SellerCtaEditor;
