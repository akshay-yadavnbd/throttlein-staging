'use client';

/**
 * Shared promo-block editor form — rendered inside the create / edit
 * modal on the Promo Blocks editor (home page accordion and the
 * standalone /pages/promo-blocks page) and on the standalone
 * /pages/promo-blocks/new and /pages/promo-blocks/[id] pages.
 *
 * The variant picker drives the storefront layout (wide card vs tall
 * card); per product decision both use ONE hero image, so the slot count
 * is fixed at 1 and old blocks with four images stop surfacing the extra
 * slots on the next save.
 *
 * Image-upload contract: the picker POSTs FormData to
 * `/promo-blocks/upload` (field "image") and stores whatever the backend
 * returns; list view + storefront feed it through `imageUrl()`.
 */

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminSelect from '@/components/AdminSelect';
import ImageSlot from '@/components/media/ImageSlot';
import { Field, AddButton, RowTools } from '@/components/EditorShell';
import { api } from '@/lib/api';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

export type PromoBlockVariant = 'image-grid' | 'single-image';

export type PromoBlockChip = { label: string; href: string };

export type PromoBlockFormState = {
  title: string;
  variant: PromoBlockVariant;
  chips: PromoBlockChip[];
  ctaLabel: string;
  ctaHref: string;
  images: string[];
  order: number;
  isActive: boolean;
};

export const emptyPromoBlockForm: PromoBlockFormState = {
  title: '',
  variant: 'image-grid',
  chips: [],
  ctaLabel: 'Explore Products',
  ctaHref: '',
  images: [],
  order: 0,
  isActive: true,
};

/** How many image slots each variant expects — one, per product decision. */
function imageSlotsFor(): number {
  return 1;
}

export default function PromoBlockForm({
  mode,
  initial,
  blockId,
  onSaved,
  onCancel,
  actionsPortal,
}: {
  mode: 'create' | 'edit';
  initial: PromoBlockFormState;
  blockId?: string;
  onSaved?: () => void;
  /** Dismiss without saving (modal host). Falls back to the list route. */
  onCancel?: () => void;
  /** A modal host's footer element: Cancel / Save render there, outside
   *  the scrolling body, so they're always in reach. */
  actionsPortal?: HTMLElement | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [draft, setForm] = useState<PromoBlockFormState>(initial);
  const [saving, setSaving] = useState(false);

  const slots = imageSlotsFor();

  function setImageAt(i: number, url: string) {
    setForm((f) => {
      const next = [...f.images];
      // Pad the array up to `i` so a removal-then-re-add keeps the
      // slot order stable instead of shifting later slots left.
      while (next.length <= i) next.push('');
      next[i] = url;
      // Trim trailing empties so we don't persist phantom slots.
      while (next.length > 0 && !next[next.length - 1]) next.pop();
      return { ...f, images: next };
    });
  }

  function addChip() {
    setForm((f) => ({ ...f, chips: [...f.chips, { label: '', href: '' }] }));
  }
  function updateChip(i: number, key: 'label' | 'href', value: string) {
    setForm((f) => {
      const next = f.chips.slice();
      next[i] = { ...next[i], [key]: value };
      return { ...f, chips: next };
    });
  }
  function removeChip(i: number) {
    setForm((f) => ({ ...f, chips: f.chips.filter((_, idx) => idx !== i) }));
  }
  function moveChip(i: number, dir: -1 | 1) {
    setForm((f) => {
      const j = i + dir;
      if (j < 0 || j >= f.chips.length) return f;
      const next = f.chips.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, chips: next };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) {
      notifyWarning(M.pages.titleIsRequired);
      return;
    }
    if (!draft.ctaHref.trim()) {
      notifyWarning(M.pages.cTALinkIsRequired);
      return;
    }
    const payload = {
      ...draft,
      images: draft.images.slice(0, slots).filter((s) => !!s.trim()),
      // Drop chip rows that are still blank — the backend filters them
      // anyway, but cleaning up here keeps the payload tidy.
      chips: draft.chips
        .map((c) => ({ label: c.label.trim(), href: (c.href || '').trim() }))
        .filter((c) => c.label),
    };
    setSaving(true);
    try {
      if (mode === 'create') {
        await api.post('/promo-blocks/admin', payload);
        notifySuccess(M.pages.promoBlockCreated);
      } else {
        await api.put(`/promo-blocks/admin/${blockId}`, payload);
        notifySuccess(M.pages.promoBlockUpdated);
      }
      if (onSaved) onSaved();
      else router.push('/pages/promo-blocks');
    } catch (err: any) {
      notifyError(err, M.pages.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  const actions = (
    <>
      <AdminButton variant="bordered" type="button" onPress={() => (onCancel ? onCancel() : router.push('/pages/promo-blocks'))} isDisabled={saving}>Cancel</AdminButton>
      <AdminButton color="primary" onPress={() => formRef.current?.requestSubmit()} isLoading={saving}>{mode === 'create' ? 'Create block' : 'Save changes'}</AdminButton>
    </>
  );

  return (
    <form ref={formRef} onSubmit={submit} className={form.grid} style={{ padding: 0 }}>
      <div className={form.section}><h3>Card</h3><p>Heading, layout and the button that opens the linked page. Chips are decorative — only the button is clickable.</p></div>
      <div className={form.full}><AdminInput label="Title" isRequired value={draft.title} onChange={(e) => setForm({ ...draft, title: e.target.value })} placeholder="Mobile Holders & Navigation Accessories" autoFocus={mode === 'create'} /></div>
      <Field label="Layout" htmlFor="promo-variant" hint={draft.variant === 'image-grid' ? 'Wide card in the left column: image beside the title, chips and a text link.' : 'Tall card in the right column: big image on top, arrow button below.'}>
        <AdminSelect id="promo-variant" fullWidth ariaLabel="Layout" value={draft.variant} onChange={(v) => setForm((f) => ({ ...f, variant: v as PromoBlockVariant }))} options={[{ value: 'image-grid', label: 'Wide card' }, { value: 'single-image', label: 'Tall card' }]} />
      </Field>
      <AdminInput label="Order" type="number" value={String(draft.order)} onChange={(e) => setForm({ ...draft, order: Number(e.target.value) || 0 })} description="Lower numbers show first." />
      <AdminInput label="Button text" value={draft.ctaLabel} onChange={(e) => setForm({ ...draft, ctaLabel: e.target.value })} placeholder="Explore Products" />
      <AdminInput label="Button link" isRequired value={draft.ctaHref} onChange={(e) => setForm({ ...draft, ctaHref: e.target.value })} placeholder="/mobile-holders" />

      <div className={`${form.section} ${form.sectionRow}`}>
        <div><h3>Chips</h3><p>Short labels under the title. Six at most reads best.</p></div>
        <span className={form.pill}>{draft.chips.filter((c) => c.label.trim()).length}</span>
      </div>
      <div className={`${form.full} ${form.rows}`}>
        {draft.chips.length === 0 && <div className={form.empty}>No chips yet.</div>}
        {draft.chips.map((chip, i) => (
          <div key={i} className={`${form.row} ${form.rowSingle}`}>
            <AdminInput aria-label={`Chip ${i + 1}`} value={chip.label} onChange={(e) => updateChip(i, 'label', e.target.value)} placeholder="Phone mounts" />
            <RowTools index={i} count={draft.chips.length} noun="chip" onMove={(d) => moveChip(i, d)} onRemove={() => removeChip(i)} />
          </div>
        ))}
        <AddButton onClick={addChip}>Add chip</AddButton>
      </div>

      <div className={form.section}><h3>Image</h3><p>{draft.variant === 'image-grid' ? 'One hero image beside the title and chips. Around 420×386 reads best.' : 'One large hero image at the top of the card. Around 445×320 reads best.'}</p></div>
      <div className={`${form.full} ${form.tiles}`}>
        {Array.from({ length: slots }).map((_, i) => (
          <ImageSlot key={i} label="" aspect={draft.variant === 'image-grid' ? 'aspect-square' : 'aspect-[445/386]'} hint="No image" value={draft.images[i] || ''} onChange={(url) => setImageAt(i, url)} uploadEndpoint="/promo-blocks/upload" />
        ))}
      </div>

      <div className={form.section}><h3>Visibility</h3></div>
      <div className={`${form.full} ${form.inlineSwitch}`}>
        <div><strong>Active</strong><span>Shown to customers on the home page.</span></div>
        <AdminSwitch isSelected={draft.isActive} onValueChange={(v) => setForm({ ...draft, isActive: v })} aria-label="Active" />
      </div>

      {actionsPortal ? createPortal(actions, actionsPortal) : <div className={`${form.full} ${form.accFoot}`} style={{ justifyContent: 'flex-end' }}>{actions}</div>}
    </form>
  );
}
