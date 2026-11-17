'use client';

/**
 * StaticPageMetaPanel — reusable search-appearance form for a static
 * storefront route (/faqs, the seller landing page, …), as one workspace
 * panel: meta title and description with counters, share image, and —
 * for listing routes that render it — the on-page top/bottom content.
 *
 * Backed by a Page record with type='static-meta' and a matching
 * staticRoute. The first save creates the record; later saves update it
 * in place.
 *
 *   <StaticPageMetaPanel route="/faqs" pageTitle="FAQs" supportsContent={false} />
 */

import { useEffect, useState } from 'react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import RichTextEditor from '@/components/common/RichTextEditor';
import ImageSlot from '@/components/media/ImageSlot';
import { Field, Counter } from '@/components/EditorShell';
import { api, unwrap, envelopeOrLegacy } from '@/lib/api';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type SeoMetaForm = {
  pageId: string | null;
  internalTitle: string;
  seoTitle: string;
  seoDescription: string;
  ogImage: string;
  isPublished: boolean;
  // On-page content (listing pages like /products): Top Content
  // replaces the H1 + intro line; Bottom Content renders after the
  // product grid (rich-text HTML for SEO copy).
  contentTitle: string;
  contentDescription: string;
  bottomTitle: string;
  bottomDescription: string;
};

export default function StaticPageMetaPanel({
  route,
  pageTitle,
  supportsContent = true,
}: {
  /** Storefront route this override targets, e.g. '/sell'. */
  route: string;
  /** Friendly title — placeholder for the internal title field. */
  pageTitle: string;
  /** Whether the route renders the on-page top/bottom content fields. */
  supportsContent?: boolean;
}) {
  const [draft, setForm] = useState<SeoMetaForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const blank: SeoMetaForm = {
      pageId: null, internalTitle: pageTitle, seoTitle: '', seoDescription: '', ogImage: '', isPublished: true,
      contentTitle: '', contentDescription: '', bottomTitle: '', bottomDescription: '',
    };
    // Fetch all static-meta pages and find the one matching this route.
    // Lighter than a dedicated endpoint and the list is small.
    api.get('/pages', { params: { type: 'static-meta', all: 1 } }).then(envelopeOrLegacy)
      .then(({ data }) => {
        if (!mounted) return;
        const match = (data.items || []).find((p: any) => p.staticRoute === route);
        setForm(match ? {
          pageId: match._id,
          internalTitle: match.title || pageTitle,
          seoTitle: match.seoTitle || '',
          seoDescription: match.seoDescription || '',
          ogImage: match.ogImage || '',
          isPublished: match.isPublished !== false,
          contentTitle: match.contentTitle || '',
          contentDescription: match.contentDescription || '',
          bottomTitle: match.bottomTitle || '',
          bottomDescription: match.bottomDescription || '',
        } : blank);
      })
      // Backend down or no override yet — leave the form empty so the
      // admin can fill + save (we POST a fresh record on save).
      .catch(() => { if (mounted) setForm(blank); });
    return () => { mounted = false; };
  }, [route, pageTitle]);

  const set = (patch: Partial<SeoMetaForm>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const payload = {
        title: draft.internalTitle.trim() || pageTitle,
        seoTitle: draft.seoTitle.trim(),
        seoDescription: draft.seoDescription.trim(),
        ogImage: draft.ogImage.trim(),
        isPublished: draft.isPublished,
        contentTitle: draft.contentTitle.trim(),
        contentDescription: draft.contentDescription.trim(),
        bottomTitle: draft.bottomTitle.trim(),
        bottomDescription: draft.bottomDescription,
      };
      if (draft.pageId) {
        await api.put(`/pages/${draft.pageId}`, payload);
      } else {
        // First save — create the static-meta record, capture its id
        // so subsequent saves PUT instead of POST.
        const slug = `static-${route.replace(/^\/+|\/+$/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'home'}`;
        const data = unwrap<{ page?: { _id: string } }>(await api.post('/pages', { ...payload, slug, type: 'static-meta', staticRoute: route }));
        set({ pageId: data.page?._id || null });
      }
      notifySuccess(M.staticPageMetaPanel.sEOMetaSaved);
    } catch (err: any) {
      notifyError(err, M.staticPageMetaPanel.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={form.panel} aria-labelledby={`meta-${route}`}>
      <div className={`${form.head} ${form.headRow}`}>
        <div>
          <h2 id={`meta-${route}`}>Search appearance</h2>
          <p>How <b>{route}</b> looks in Google and when shared. Blank fields fall back to the built-in defaults.</p>
        </div>
        {draft && (
          <div className={form.toggleCell}>
            <AdminSwitch isSelected={draft.isPublished} onValueChange={(v) => set({ isPublished: v })} aria-label="Override active" />
            <span>{draft.isPublished ? 'Override on' : 'Override off'}</span>
          </div>
        )}
      </div>
      {!draft ? (
        <div className={form.grid}><div className={`${form.full} ${form.empty}`}>Loading search appearance…</div></div>
      ) : (
        <div className={form.grid}>
          <div>
            <AdminInput label="Meta title" value={draft.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} placeholder="Leave blank for the built-in default" />
            <Counter value={draft.seoTitle} max={60} hint="Aim for 50–60 characters." />
          </div>
          <div>
            <AdminTextarea label="Meta description" minRows={2} maxRows={4} value={draft.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} placeholder="Leave blank for the built-in default" />
            <Counter value={draft.seoDescription} max={160} hint="Aim for 150–160 characters." />
          </div>
          <div className={form.upload}>
            <Field label="Social share image" hint="WhatsApp, X and LinkedIn previews. 1200×630 works best.">
              <ImageSlot label="" aspect="aspect-[1200/630]" className="w-[240px] max-w-full" hint="No image" value={draft.ogImage} onChange={(url) => set({ ogImage: url })} uploadEndpoint="/pages/upload-og" acceptedTypes="image/png,image/jpeg,image/webp" />
            </Field>
          </div>
          <AdminInput label="Internal title" value={draft.internalTitle} onChange={(e) => set({ internalTitle: e.target.value })} placeholder={pageTitle} description="Shown in the admin pages list only — never public." />

          {supportsContent && (
            <>
              <div className={form.section}><h3>Top of the page</h3><p>Replaces the page heading and the intro line. Blank keeps the defaults.</p></div>
              <AdminInput label="Title" value={draft.contentTitle} onChange={(e) => set({ contentTitle: e.target.value })} placeholder="e.g. All Motorcycle Products" />
              <AdminTextarea label="Intro" minRows={2} value={draft.contentDescription} onChange={(e) => set({ contentDescription: e.target.value })} placeholder="Short intro paragraph under the title" />

              <div className={form.section}><h3>Below the grid</h3><p>SEO copy after the product grid — headings, links and lists are fine.</p></div>
              <div className={form.full}><AdminInput label="Title" value={draft.bottomTitle} onChange={(e) => set({ bottomTitle: e.target.value })} placeholder="e.g. Why buy motorcycle gear on THROTTLEIN?" /></div>
              <div className={form.full}><RichTextEditor value={draft.bottomDescription} onChange={(html) => set({ bottomDescription: html })} ariaLabel="Bottom content" minHeight={200} /></div>
            </>
          )}

          <div className={`${form.full} ${form.accFoot}`} style={{ justifyContent: 'flex-end' }}>
            <AdminButton color="primary" onPress={save} isLoading={saving}>Save search appearance</AdminButton>
          </div>
        </div>
      )}
    </section>
  );
}
