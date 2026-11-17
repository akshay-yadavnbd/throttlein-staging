'use client';

/**
 * Promo Blocks editor — shared component, mounted inside the home page
 * accordion AND inside the standalone `/pages/promo-blocks` page.
 *
 * Compact table with inline reorder, delete and active toggle; create
 * and edit run in a modal so the admin never leaves the surface. Backed
 * by /api/promo-blocks; the storefront fetches ?active=1 on a 60s ISR
 * window, so a change here shows on the customer site within a minute.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import { StatusChip } from '@/components/ui';
import { IconButton, IconUp, IconDown, IconTrash, IconClose, IconPlus, IconLayout, IconImage } from '@/components/EditorShell';
import { api, imageUrl, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import PromoBlockForm, {
  emptyPromoBlockForm,
  type PromoBlockFormState,
} from '@/app/pages/promo-blocks/PromoBlockForm';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';
import modal from '@/components/AdminModal.module.css';

type PromoBlock = {
  _id: string;
  title: string;
  variant: 'image-grid' | 'single-image';
  chips: { _id?: string; label: string; href: string }[];
  ctaLabel: string;
  ctaHref: string;
  images: string[];
  order: number;
  isActive: boolean;
  updatedAt?: string;
};

export type PromoBlocksEditorHandle = { save: () => Promise<void> };

type PromoBlocksEditorProps = {
  /** Reserved for symmetry with the other home editors. Promo blocks
   *  are saved per row via the modal, so the flag is a no-op here. */
  hideSaveButton?: boolean;
};

const PromoBlocksEditor = forwardRef<PromoBlocksEditorHandle, PromoBlocksEditorProps>(
  function PromoBlocksEditor(_props, ref) {
  const [items, setItems] = useState<PromoBlock[] | null>(null);

  // Promo blocks are saved per row via the modal — nothing to flush
  // when the master "Save changes" button is pressed.
  useImperativeHandle(ref, () => ({ save: async () => {} }), []);
  // Ids mid-reorder so the up/down buttons show a disabled state and we
  // don't fire concurrent PUTs against the same pair of rows.
  const [reorderingIds, setReorderingIds] = useState<Set<string>>(new Set());

  // Modal state — drives in-place create/edit
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; initial: PromoBlockFormState; blockId?: string } | null>(null);
  /* The modal footer element — the form portals its Cancel / Save into it. */
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null);

  const load = () => api.get('/promo-blocks/admin')
    .then((r) => setItems(unwrap<{ items?: any[] }>(r).items || []))
    .catch((e: any) => { notifyError(e, M.homeEditors.couldntLoadPromoBlocks); setItems([]); });
  useEffect(() => { void load(); }, []);

  const sorted = useMemo(
    () => [...(items || [])].sort((a, b) => a.order - b.order || a._id.localeCompare(b._id)),
    [items],
  );

  function openCreate() {
    setEditor({
      mode: 'create',
      initial: {
        ...emptyPromoBlockForm,
        // New blocks go at the end so they don't shuffle existing ones.
        order: sorted.length > 0 ? Math.max(...sorted.map((x) => x.order)) + 1 : 0,
      },
    });
  }

  async function openEdit(b: PromoBlock) {
    // The dedicated endpoint matches the previous /pages/promo-blocks/[id] flow.
    try {
      const data = unwrap<{ item?: PromoBlock }>(await api.get(`/promo-blocks/admin/${b._id}`));
      const src: PromoBlock = data.item || b;
      setEditor({
        mode: 'edit',
        blockId: b._id,
        initial: {
          title: src.title || '',
          variant: src.variant || 'image-grid',
          chips: (src.chips || []).map((c) => ({ label: c.label || '', href: c.href || '' })),
          ctaLabel: src.ctaLabel || 'Explore Products',
          ctaHref: src.ctaHref || '',
          images: src.images || [],
          order: typeof src.order === 'number' ? src.order : 0,
          isActive: src.isActive !== false,
        },
      });
    } catch (e: any) {
      notifyError(e, M.homeEditors.couldntLoadBlock);
    }
  }

  function onFormSaved() {
    setEditor(null);
    void load();
  }

  async function toggleActive(b: PromoBlock, next: boolean) {
    try {
      await api.put(`/promo-blocks/admin/${b._id}`, { isActive: next });
      setItems((prev) => (prev || []).map((x) => (x._id === b._id ? { ...x, isActive: next } : x)));
    } catch (e: any) {
      notifyError(e, M.homeEditors.couldntUpdate);
    }
  }

  async function remove(b: PromoBlock) {
    if (!(await confirmDialog({
      title: `Delete “${b.title}”?`,
      message: 'The card comes off the home page. This can’t be undone.',
      destructive: true,
      confirmLabel: 'Delete block',
    }))) return;
    try {
      await api.delete(`/promo-blocks/admin/${b._id}`);
      notifySuccess(M.homeEditors.deleted);
      void load();
    } catch (e: any) {
      notifyError(e, M.homeEditors.couldntDelete);
    }
  }

  async function move(b: PromoBlock, direction: -1 | 1) {
    const idx = sorted.findIndex((x) => x._id === b._id);
    const neighborIdx = idx + direction;
    if (idx < 0 || neighborIdx < 0 || neighborIdx >= sorted.length) return;
    const neighbor = sorted[neighborIdx];
    setReorderingIds((prev) => new Set(prev).add(b._id).add(neighbor._id));
    try {
      await Promise.all([
        api.put(`/promo-blocks/admin/${b._id}`, { order: neighbor.order }),
        api.put(`/promo-blocks/admin/${neighbor._id}`, { order: b.order }),
      ]);
      setItems((prev) => (prev || []).map((x) => {
        if (x._id === b._id) return { ...x, order: neighbor.order };
        if (x._id === neighbor._id) return { ...x, order: b.order };
        return x;
      }));
    } catch (e: any) {
      notifyError(e, M.homeEditors.couldntReorder);
    } finally {
      setReorderingIds((prev) => {
        const next = new Set(prev);
        next.delete(b._id);
        next.delete(neighbor._id);
        return next;
      });
    }
  }

  return (
    <div className={form.rows}>
      <div className={form.sectionRow}>
        <div className={form.railMeta}>{items ? `${sorted.length} ${sorted.length === 1 ? 'block' : 'blocks'}` : 'Loading…'} · the three-card group on the home page</div>
        <AdminButton color="primary" size="sm" onPress={openCreate}><IconPlus /> New block</AdminButton>
      </div>
      {!items ? (
        <div className={form.empty}>Loading promo blocks…</div>
      ) : sorted.length === 0 ? (
        <div className={form.empty}>No promo blocks yet. Add the first one — it shows on the home page within a minute.</div>
      ) : (
        <div className={form.tableWrap}>
          <table className={form.table}>
            <thead><tr><th scope="col">Block</th><th scope="col">Layout</th><th scope="col">Chips</th><th scope="col">Order</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {sorted.map((b, idx) => {
                const firstImage = b.images?.[0];
                const busy = reorderingIds.has(b._id);
                return (
                  <tr key={b._id}>
                    <td>
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {firstImage ? <img src={imageUrl(firstImage)} alt="" className={`${form.thumb} ${form.thumbSquare}`} /> : <span className={`${form.thumb} ${form.thumbSquare} ${form.thumbEmpty}`}><IconImage /></span>}
                        <div className="min-w-0">
                          <button type="button" className={form.cellPrimary} onClick={() => openEdit(b)}>{b.title}</button>
                          <span className={form.cellSub}>→ {b.ctaHref}</span>
                        </div>
                      </div>
                    </td>
                    <td>{b.variant === 'image-grid' ? 'Wide card' : 'Tall card'}</td>
                    <td>{b.chips?.length || 0}</td>
                    <td>
                      <span className={form.orderCell}>
                        <IconButton label="Move up" disabled={busy || idx === 0} onClick={() => move(b, -1)}><IconUp /></IconButton>
                        <span>{b.order}</span>
                        <IconButton label="Move down" disabled={busy || idx === sorted.length - 1} onClick={() => move(b, 1)}><IconDown /></IconButton>
                      </span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        <AdminSwitch isSelected={b.isActive} onValueChange={(v) => toggleActive(b, v)} aria-label={`${b.title} active`} />
                        <StatusChip status={b.isActive ? 'active' : 'inactive'} />
                      </span>
                    </td>
                    <td>
                      <div className={form.cellActions}>
                        <AdminButton variant="bordered" size="sm" onPress={() => openEdit(b)}>Edit</AdminButton>
                        <IconButton label={`Delete ${b.title}`} danger onClick={() => remove(b)}><IconTrash /></IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={!!editor} onClose={() => setEditor(null)} placement="center" size="3xl" scrollBehavior="inside" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
        <ModalContent>
          {editor && (
            <>
              <ModalHeader className={modal.header}>
                <span className={`${modal.icon} ${modal.info}`}><IconLayout /></span>
                <div className="min-w-0 flex-1">
                  <div className={modal.eyebrow}>{editor.mode === 'create' ? 'New promo block' : 'Edit promo block'}</div>
                  <div className={modal.title}>{editor.mode === 'create' ? 'Add a card to the home page' : editor.initial.title || 'Promo block'}</div>
                </div>
                <button type="button" className={modal.close} onClick={() => setEditor(null)} aria-label="Close"><IconClose /></button>
              </ModalHeader>
              <ModalBody className={`${modal.body} pb-6`}>
                <PromoBlockForm mode={editor.mode} initial={editor.initial} blockId={editor.blockId} onSaved={onFormSaved} onCancel={() => setEditor(null)} actionsPortal={footerEl} />
              </ModalBody>
              <ModalFooter ref={setFooterEl} className={modal.footer} />
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
});

export default PromoBlocksEditor;
