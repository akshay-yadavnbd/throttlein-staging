'use client';

/**
 * /pages/sell — admin editor for the seller landing page
 * (seller.throttlein.com/), in the workspace layout: identity header,
 * then stacked panels — search appearance, the guide-section heading,
 * the FAQ accordion and the guides table.
 *
 * SELLER-SITE ONLY. Listed in `SELLER_ONLY_PATHS` (lib/modules.ts), so
 * AdminShell bounces anyone who reaches it with the site switcher on
 * Throttlein. Reached via the "Seller home" tab in the Pages module.
 *
 * SCOPE — this tab manages what no row in the Pages table can: the
 * landing page's own meta, the guide-section heading, the FAQ and the
 * guide cards. Per-guide creation / editing lives on /pages/sell/new
 * and /pages/sell/<id>. The path is still `/pages/sell` for historical
 * reasons (bookmarks).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AdminSwitch from '@/components/AdminSwitch';
import AdminShell from '@/components/AdminShell';
import AdminButton from '@/components/AdminButton';
import StaticPageMetaPanel from '@/components/StaticPageMetaPanel';
import SellerGuideSectionEditor from '@/components/sell-editors/SellerGuideSectionEditor';
import SellerFaqEditor from '@/components/sell-editors/SellerFaqEditor';
import { StatusChip } from '@/components/ui';
import { EditorPage, BackLink, EditorHeader, IconButton, IconUp, IconDown, IconTrash, IconPlus, IconHome, IconImage } from '@/components/EditorShell';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type Guide = {
  _id: string;
  title: string;
  slug: string;
  shortDescription?: string;
  image?: string;
  order: number;
  isActive: boolean;
  publishedAt?: string | null;
  updatedAt?: string;
};

export default function SellPageEditor() {
  const [items, setItems] = useState<Guide[] | null>(null);

  const load = () => api.get('/seller-guides').then(envelopeOrLegacy)
    .then(({ data }) => setItems(Array.isArray(data?.items) ? data.items : []))
    .catch((e: any) => { notifyError(e, M.pages.couldntLoadGuides); setItems([]); });
  useEffect(() => { void load(); }, []);

  const sorted = useMemo(
    () => [...(items || [])].sort((a, b) => a.order - b.order || a._id.localeCompare(b._id)),
    [items],
  );
  const activeCount = sorted.filter((g) => g.isActive).length;

  async function remove(g: Guide) {
    if (!(await confirmDialog({
      title: `Delete “${g.title}”?`,
      message: `/seller/guide/${g.slug} will return 404 after this. This can’t be undone.`,
      destructive: true,
      confirmLabel: 'Delete guide',
    }))) return;
    try {
      await api.delete(`/seller-guides/${g._id}`);
      notifySuccess(M.pages.guideDeleted);
      setItems((prev) => (prev || []).filter((x) => x._id !== g._id));
    } catch (e: any) {
      notifyError(e, M.pages.couldntDelete);
    }
  }

  async function toggleActive(g: Guide, next: boolean) {
    try {
      await api.put(`/seller-guides/${g._id}`, { isActive: next });
      setItems((prev) => (prev || []).map((x) => (x._id === g._id ? { ...x, isActive: next } : x)));
    } catch (e: any) {
      notifyError(e, M.pages.couldntUpdate);
    }
  }

  /** Reorder by swapping `order` with the neighbour above/below. */
  async function move(g: Guide, dir: -1 | 1) {
    const idx = sorted.findIndex((x) => x._id === g._id);
    const swapWith = sorted[idx + dir];
    if (!swapWith) return;
    try {
      await Promise.all([
        api.put(`/seller-guides/${g._id}`, { order: swapWith.order }),
        api.put(`/seller-guides/${swapWith._id}`, { order: g.order }),
      ]);
      void load();
    } catch (e: any) {
      notifyError(e, M.pages.couldntReorder);
    }
  }

  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages">All pages</BackLink>
        <EditorHeader
          icon={<IconHome />}
          title="Seller home"
          meta={['seller.throttlein.com', items ? `${sorted.length} ${sorted.length === 1 ? 'guide' : 'guides'} · ${activeCount} active` : null]}
          actions={<AdminButton color="primary" as={Link} href="/pages/sell/new"><IconPlus /> Add guide</AdminButton>}
        />

        <div className={form.main}>
          <StaticPageMetaPanel route="/" pageTitle="Seller home" supportsContent={false} />
          <SellerGuideSectionEditor />
          <SellerFaqEditor />

          <section className={form.panel} aria-labelledby="guides-heading">
            <div className={`${form.head} ${form.headRow}`}>
              <div><h2 id="guides-heading">Guides <span className={form.pill}>{items ? sorted.length : '…'}</span></h2><p>Cards after the “Ready to open your shop?” banner, in this order. Each gets its own page at /seller/guide/&lt;slug&gt;.</p></div>
              <AdminButton variant="bordered" size="sm" as={Link} href="/pages/sell/new"><IconPlus /> Add guide</AdminButton>
            </div>
            <div className={form.grid}>
              {!items ? (
                <div className={`${form.full} ${form.empty}`}>Loading guides…</div>
              ) : sorted.length === 0 ? (
                <div className={`${form.full} ${form.empty}`}>No guides yet. Add the first one — it shows under the “Ready to open your shop?” banner.</div>
              ) : (
                <div className={`${form.full} ${form.tableWrap}`}>
                  <table className={form.table}>
                    <thead><tr><th scope="col">Guide</th><th scope="col">Order</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {sorted.map((g, idx) => (
                        <tr key={g._id}>
                          <td>
                            <div className="flex items-center gap-3">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {g.image ? <img src={imageUrl(g.image)} alt="" className={`${form.thumb} ${form.thumbSquare}`} /> : <span className={`${form.thumb} ${form.thumbSquare} ${form.thumbEmpty}`}><IconImage /></span>}
                              <div className="min-w-0">
                                <Link href={`/pages/sell/${g._id}`} className={form.cellPrimary}>{g.title}</Link>
                                <span className={form.cellSub}>/seller/guide/{g.slug}{g.shortDescription ? ` · ${g.shortDescription}` : ''}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={form.orderCell}>
                              <IconButton label="Move up" disabled={idx === 0} onClick={() => move(g, -1)}><IconUp /></IconButton>
                              <span>{g.order}</span>
                              <IconButton label="Move down" disabled={idx === sorted.length - 1} onClick={() => move(g, 1)}><IconDown /></IconButton>
                            </span>
                          </td>
                          <td>
                            <span className="inline-flex items-center gap-2">
                              <AdminSwitch isSelected={g.isActive} onValueChange={(v) => toggleActive(g, v)} aria-label={`${g.title} active`} />
                              <StatusChip label={g.isActive ? 'Active' : 'Hidden'} status={g.isActive ? 'active' : 'inactive'} />
                            </span>
                          </td>
                          <td className="text-[#8a939b]">{g.updatedAt ? new Date(g.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                          <td>
                            <div className={form.cellActions}>
                              <AdminButton variant="bordered" size="sm" as={Link} href={`/pages/sell/${g._id}`}>Edit</AdminButton>
                              <IconButton label={`Delete ${g.title}`} danger onClick={() => remove(g)}><IconTrash /></IconButton>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      </EditorPage>
    </AdminShell>
  );
}
