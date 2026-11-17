'use client';

/**
 * Hero banners editor — shared component, mounted inside the home page
 * accordion AND in the standalone /pages/home/banners page.
 *
 * Compact table of all banners (preview, title, link, order, active)
 * with the full form in a modal for create / edit. Fields flow into
 * /api/home-banners: required desktop image; optional overlay copy
 * (title, description, brand logos, CTA label / link / theme); optional
 * mobile crop, alt text, click-through link, order and active.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminSelect from '@/components/AdminSelect';
import AdminTextarea from '@/components/AdminTextarea';
import ImageSlot from '@/components/media/ImageSlot';
import MediaPicker from '@/components/media/MediaPicker';
import { StatusChip } from '@/components/ui';
import { Field, IconButton, IconTrash, IconClose, IconPlus, IconImage } from '@/components/EditorShell';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';
import modal from '@/components/AdminModal.module.css';

type Banner = {
  _id: string;
  image: string;
  imageMobile?: string;
  title?: string;
  description?: string;
  brandLogos?: string[];
  ctaLabel?: string;
  ctaHref?: string;
  ctaTheme?: 'dark' | 'light';
  alt?: string;
  href?: string;
  order: number;
  isActive: boolean;
};

type FormState = {
  image: string;
  imageMobile: string;
  title: string;
  description: string;
  brandLogos: string[];
  ctaLabel: string;
  ctaHref: string;
  ctaTheme: 'dark' | 'light';
  alt: string;
  href: string;
  order: number;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  image: '',
  imageMobile: '',
  title: '',
  description: '',
  brandLogos: [],
  ctaLabel: '',
  ctaHref: '',
  ctaTheme: 'dark',
  alt: '',
  href: '',
  order: 0,
  isActive: true,
};

/** Brand-logo repeater — array of S3 keys with add / remove. The add
 *  button opens the MediaPicker so admins can re-use a logo that's
 *  already in the library OR upload a fresh one. */
function BrandLogosField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <Field label="Brand logos" hint="Small white pills between the title and description. PNG or SVG with a transparent background works best.">
      <div className={form.logos}>
        {value.map((src, i) => (
          <span key={`${src}-${i}`} className={form.logo}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(src)} alt={`Brand ${i + 1}`} />
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} aria-label={`Remove logo ${i + 1}`}><IconClose /></button>
          </span>
        ))}
        <button type="button" className={form.addRow} onClick={() => setPickerOpen(true)}><IconPlus /> Add logo</button>
      </div>
      <MediaPicker isOpen={pickerOpen} onClose={() => setPickerOpen(false)} uploadEndpoint="/home-banners/upload" onSelect={(key) => onChange([...value, key])} />
    </Field>
  );
}

export type HeroBannersEditorHandle = { save: () => Promise<void> };

type HeroBannersEditorProps = {
  /** Reserved for symmetry with the other home editors. Banners are
   *  saved per row via the modal, so the flag is a no-op here. */
  hideSaveButton?: boolean;
};

const HeroBannersEditor = forwardRef<HeroBannersEditorHandle, HeroBannersEditorProps>(
  function HeroBannersEditor(_props, ref) {
  const [items, setItems] = useState<Banner[] | null>(null);

  // Banners are saved per row via the modal — there's nothing to flush
  // when the master "Save changes" button is pressed.
  useImperativeHandle(ref, () => ({ save: async () => {} }), []);

  // Modal state (shared between create + edit)
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; id?: string } | null>(null);
  const [draft, setDraft] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/home-banners').then(envelopeOrLegacy)
    .then(({ data }) => setItems(data.items || []))
    .catch((e: any) => { notifyError(e, M.homeEditors.couldntLoadBanners); setItems([]); });
  useEffect(() => { void load(); }, []);

  const sorted = useMemo(
    () => [...(items || [])].sort((a, b) => a.order - b.order || a._id.localeCompare(b._id)),
    [items]
  );

  function openCreate() {
    setDraft({ ...EMPTY_FORM, order: sorted.length > 0 ? Math.max(...sorted.map((x) => x.order)) + 1 : 0 });
    setEditor({ mode: 'create' });
  }

  function openEdit(b: Banner) {
    setDraft({
      image: b.image || '',
      imageMobile: b.imageMobile || '',
      title: b.title || '',
      description: b.description || '',
      brandLogos: Array.isArray(b.brandLogos) ? b.brandLogos : [],
      ctaLabel: b.ctaLabel || '',
      ctaHref: b.ctaHref || '',
      ctaTheme: b.ctaTheme === 'light' ? 'light' : 'dark',
      alt: b.alt || '',
      href: b.href || '',
      order: typeof b.order === 'number' ? b.order : 0,
      isActive: b.isActive !== false,
    });
    setEditor({ mode: 'edit', id: b._id });
  }

  const set = (patch: Partial<FormState>) => setDraft((f) => ({ ...f, ...patch }));

  async function submit() {
    if (!editor) return;
    if (!draft.image.trim()) {
      notifyWarning(M.homeEditors.uploadADesktopBannerImageFirst);
      return;
    }
    setSaving(true);
    try {
      if (editor.mode === 'create') {
        await api.post('/home-banners', draft);
        notifySuccess(M.homeEditors.bannerAdded);
      } else {
        await api.put(`/home-banners/${editor.id}`, draft);
        notifySuccess(M.homeEditors.bannerUpdated);
      }
      setEditor(null);
      void load();
    } catch (e: any) {
      notifyError(e, M.homeEditors.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  async function remove(b: Banner) {
    if (!(await confirmDialog({
      title: 'Delete this banner?',
      message: 'It comes off the home page swiper. This can’t be undone.',
      destructive: true,
      confirmLabel: 'Delete banner',
    }))) return;
    try {
      await api.delete(`/home-banners/${b._id}`);
      notifySuccess(M.homeEditors.deleted);
      void load();
    } catch (e: any) {
      notifyError(e, M.homeEditors.couldntDelete);
    }
  }

  async function toggleActive(b: Banner, next: boolean) {
    try {
      await api.put(`/home-banners/${b._id}`, { isActive: next });
      setItems((prev) => (prev || []).map((x) => (x._id === b._id ? { ...x, isActive: next } : x)));
    } catch (e: any) {
      notifyError(e, M.homeEditors.couldntUpdate);
    }
  }

  return (
    <div className={form.rows}>
      <div className={form.sectionRow}>
        <div className={form.railMeta}>{items ? `${sorted.length} ${sorted.length === 1 ? 'banner' : 'banners'}` : 'Loading…'} · the swiper at the top of the storefront</div>
        <AdminButton color="primary" size="sm" onPress={openCreate}><IconPlus /> New banner</AdminButton>
      </div>
      {!items ? (
        <div className={form.empty}>Loading banners…</div>
      ) : sorted.length === 0 ? (
        <div className={form.empty}>No banners yet. Add the first one — it needs a desktop image; everything else is optional.</div>
      ) : (
        <div className={form.tableWrap}>
          <table className={form.table}>
            <thead><tr><th scope="col">Banner</th><th scope="col">Link</th><th scope="col">Order</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {sorted.map((b) => (
                <tr key={b._id}>
                  <td>
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {b.image ? <img src={imageUrl(b.image)} alt={b.alt || ''} className={form.thumb} /> : <span className={`${form.thumb} ${form.thumbEmpty}`}><IconImage /></span>}
                      <div className="min-w-0">
                        <button type="button" className={form.cellPrimary} onClick={() => openEdit(b)}>{b.title || 'Image-only banner'}</button>
                        {b.ctaLabel && <span className={form.cellSub}>Button: {b.ctaLabel} · {b.ctaTheme === 'light' ? 'light' : 'dark'}</span>}
                      </div>
                    </div>
                  </td>
                  <td>{b.href ? <span className={form.cellSub} style={{ marginTop: 0, maxWidth: 200 }}>{b.href}</span> : <span className="text-[#8a939b]">Not clickable</span>}</td>
                  <td>{b.order}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <AdminSwitch isSelected={b.isActive} onValueChange={(v) => toggleActive(b, v)} aria-label={`${b.title || 'Banner'} active`} />
                      <StatusChip status={b.isActive ? 'active' : 'inactive'} />
                    </span>
                  </td>
                  <td>
                    <div className={form.cellActions}>
                      <AdminButton variant="bordered" size="sm" onPress={() => openEdit(b)}>Edit</AdminButton>
                      <IconButton label="Delete banner" danger onClick={() => remove(b)}><IconTrash /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={!!editor} onClose={() => !saving && setEditor(null)} placement="center" size="3xl" scrollBehavior="inside" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
        <ModalContent>
          {editor && (
            <>
              <ModalHeader className={modal.header}>
                <span className={`${modal.icon} ${modal.info}`}><IconImage /></span>
                <div className="min-w-0 flex-1">
                  <div className={modal.eyebrow}>{editor.mode === 'create' ? 'New banner' : 'Edit banner'}</div>
                  <div className={modal.title}>{editor.mode === 'create' ? 'Add a slide to the home swiper' : draft.title || 'Image-only banner'}</div>
                  <div className={modal.sub}>A desktop image is required. Leave the title blank for an image-only slide.</div>
                </div>
                <button type="button" className={modal.close} onClick={() => setEditor(null)} aria-label="Close" disabled={saving}><IconClose /></button>
              </ModalHeader>
              <ModalBody className={modal.body}>
                <div className={form.grid} style={{ padding: 0 }}>
                  <div className={form.section}><h3>Images</h3><p>Desktop 1512×610; the mobile crop is portrait and falls back to the desktop image. PNG, JPG or WEBP up to 5 MB.</p></div>
                  <div className={form.full}>
                    <Field label="Desktop image" required>
                      <ImageSlot label="" aspect="aspect-[1512/610]" hint="No image" value={draft.image} onChange={(url) => set({ image: url })} uploadEndpoint="/home-banners/upload" />
                    </Field>
                  </div>
                  <Field label="Mobile image" hint="Portrait crop for phones.">
                    <ImageSlot label="" aspect="aspect-[9/16]" className="w-[140px]" hint="No image" value={draft.imageMobile} onChange={(url) => set({ imageMobile: url })} uploadEndpoint="/home-banners/upload" />
                  </Field>
                  <AdminInput label="Alt text" value={draft.alt} onChange={(e) => set({ alt: e.target.value })} description="Describes the image for screen readers and search engines." />

                  <div className={form.section}><h3>Overlay</h3><p>Text and button over the image. All optional.</p></div>
                  <div className={form.full}><AdminInput label="Title" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Top Boxes from Top Brands" /></div>
                  <div className={form.full}><BrandLogosField value={draft.brandLogos} onChange={(next) => set({ brandLogos: next })} /></div>
                  <div className={form.full}><AdminTextarea label="Description" value={draft.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} minRows={2} description="One paragraph under the title. Hidden when blank." /></div>
                  <AdminInput label="Button text" value={draft.ctaLabel} onChange={(e) => set({ ctaLabel: e.target.value })} placeholder="Explore Products" />
                  <AdminInput label="Button link" value={draft.ctaHref} onChange={(e) => set({ ctaHref: e.target.value })} placeholder="/luggage" />
                  <Field label="Button style" htmlFor="banner-cta-theme" hint="Dark on light photos, light on dark photos.">
                    <AdminSelect id="banner-cta-theme" fullWidth ariaLabel="Button style" value={draft.ctaTheme} onChange={(v) => set({ ctaTheme: v as 'dark' | 'light' })} options={[{ value: 'dark', label: 'Dark — black button, white text' }, { value: 'light', label: 'Light — white button, black text' }]} />
                  </Field>
                  <AdminInput label="Whole-banner link" value={draft.href} onChange={(e) => set({ href: e.target.value })} placeholder="/helmets" description="Makes the whole slide clickable. Blank keeps it static." />

                  <div className={form.section}><h3>Placement</h3></div>
                  <AdminInput label="Order" type="number" value={String(draft.order)} onChange={(e) => set({ order: Number(e.target.value) || 0 })} description="Lower numbers show first." />
                  <div className={form.inlineSwitch}>
                    <div><strong>Active</strong><span>Shown to customers.</span></div>
                    <AdminSwitch isSelected={draft.isActive} onValueChange={(v) => set({ isActive: v })} aria-label="Active" />
                  </div>
                </div>
              </ModalBody>
              <ModalFooter className={modal.footer}>
                <AdminButton variant="bordered" onPress={() => setEditor(null)} isDisabled={saving}>Cancel</AdminButton>
                <AdminButton color="primary" onPress={submit} isLoading={saving}>{editor.mode === 'create' ? 'Add banner' : 'Save changes'}</AdminButton>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
});

export default HeroBannersEditor;
