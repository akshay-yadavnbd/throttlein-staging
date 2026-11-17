'use client';

/**
 * Static (prose) page editor — `/pages/prose/[id]`, in the workspace
 * form layout. Fields: title, slug (/page/<slug>), markdown body with a
 * Write / Preview switch, SEO title + description + OG image, published
 * toggle and admin sort order. The storefront renders the body with
 * react-markdown; the preview here is a quick approximation.
 */

import DOMPurify from 'dompurify';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminSwitch from '@/components/AdminSwitch';
import AdminShell from '@/components/AdminShell';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import ImageSlot from '@/components/media/ImageSlot';
import { StatusChip } from '@/components/ui';
import { EditorPage, BackLink, EditorHeader, EditorSkeleton, Field, Counter, IconDoc, IconExternal } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { useActiveSite } from '@/lib/useActiveSite';
import { previewUrl } from '@/lib/storefrontUrl';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type Page = {
  _id: string;
  slug: string;
  title: string;
  body?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogImage?: string;
  isPublished: boolean;
  order: number;
  updatedAt?: string;
};

type FormState = {
  slug: string;
  title: string;
  body: string;
  seoTitle: string;
  seoDescription: string;
  ogImage: string;
  isPublished: boolean;
  order: number;
};

/** Tiny, dependency-free markdown previewer. Covers headings, bold,
 *  italic, links, lists, paragraphs and inline code. The storefront
 *  uses react-markdown for the real render. */
function renderMarkdownPreview(md: string): string {
  if (!md) return '';
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = escape(md);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/^(?:- (.+)\n?)+/gm, (match) => {
    const items = match.trim().split(/\n/).map((l) => l.replace(/^- /, '')).map((t) => `<li>${t}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  html = html
    .split(/\n{2,}/)
    .map((chunk) => {
      const t = chunk.trim();
      if (!t) return '';
      if (/^<(h\d|ul|ol|blockquote|pre)/.test(t)) return t;
      return `<p>${t.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');
  return html;
}

export default function ProsePageEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const site = useActiveSite();

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [form_, setForm] = useState<FormState>({
    slug: '', title: '', body: '', seoTitle: '', seoDescription: '', ogImage: '', isPublished: true, order: 0,
  });
  const [originalSlug, setOriginalSlug] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | undefined>(undefined);

  const load = useCallback(() => api.get(`/pages/id/${id}`)
    .then((r) => {
      const p: Page = unwrap<{ page: Page }>(r).page;
      setForm({
        slug: p.slug || '',
        title: p.title || '',
        body: p.body || '',
        seoTitle: p.seoTitle || '',
        seoDescription: p.seoDescription || '',
        ogImage: p.ogImage || '',
        isPublished: p.isPublished,
        order: p.order || 0,
      });
      setOriginalSlug(p.slug || '');
      setUpdatedAt(p.updatedAt);
      setLoaded(true);
    })
    .catch((e: any) => {
      notifyError(e, M.pages.couldntLoadPage);
      router.push('/pages');
    }), [id, router]);
  useEffect(() => { void load(); }, [load]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!form_.title.trim()) {
      notifyWarning(M.pages.titleIsRequired);
      return;
    }
    setSaving(true);
    try {
      await api.put(`/pages/${id}`, form_);
      notifySuccess(M.pages.saved);
      await load();
    } catch (e: any) {
      notifyError(e, M.pages.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!(await confirmDialog({
      title: `Delete “${form_.title}”?`,
      message: `/page/${form_.slug} will return 404 after this. This can’t be undone.`,
      destructive: true,
      confirmLabel: 'Delete page',
    }))) return;
    try {
      await api.delete(`/pages/${id}`);
      notifySuccess(M.pages.deleted);
      router.push('/pages');
    } catch (e: any) {
      notifyError(e, M.pages.couldntDelete);
    }
  }

  if (!loaded) {
    return (
      <AdminShell>
        <EditorPage moduleKey="pages">
          <BackLink href="/pages">All pages</BackLink>
          <EditorSkeleton label="Loading page" />
        </EditorPage>
      </AdminShell>
    );
  }

  const previewHtml = (typeof DOMPurify.sanitize === 'function'
    ? DOMPurify.sanitize(renderMarkdownPreview(form_.body), { FORBID_ATTR: ['style'], FORBID_TAGS: ['svg', 'math'] })
    : '') || '<p style="color:#929ba3">Nothing to preview yet — start typing in Write.</p>';

  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages">All pages</BackLink>
        <EditorHeader
          icon={<IconDoc />}
          title={<>{form_.title || 'Untitled page'}<StatusChip label={form_.isPublished ? 'Published' : 'Draft'} status={form_.isPublished ? 'published' : 'draft'} /></>}
          meta={[
            'Static page',
            `/page/${form_.slug || '…'}`,
            updatedAt ? `Updated ${new Date(updatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : null,
          ]}
        />

        <form className={form.layout} onSubmit={(e) => { e.preventDefault(); save(); }}>
          <section className={form.panel}>
            <div className={form.grid}>
              <div className={form.section}><h3>Page</h3><p>Title and web address.</p></div>
              <AdminInput label="Title" isRequired value={form_.title} onChange={(e) => set({ title: e.target.value })} />
              <AdminInput label="Slug" value={form_.slug} onChange={(e) => set({ slug: e.target.value })} startContent={<span className={form.prefix}>/page/</span>} description="Lowercase letters, numbers and hyphens." />

              <div className={`${form.section} ${form.sectionRow}`}>
                <div><h3>Body</h3><p>Markdown: <code>#</code> headings, <code>**bold**</code>, <code>-</code> lists, <code>[text](url)</code> links.</p></div>
                <div className={form.segment} role="group" aria-label="Body view">
                  <button type="button" aria-pressed={view === 'write'} onClick={() => setView('write')}>Write</button>
                  <button type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
                </div>
              </div>
              <div className={form.full}>
                {view === 'write' ? (
                  <AdminTextarea
                    aria-label="Body (Markdown)"
                    minRows={18}
                    value={form_.body}
                    onChange={(e) => set({ body: e.target.value })}
                    placeholder={'# Heading\n\nYour content here. Use **bold**, *italic*, `inline code`, and [links](https://example.com).\n\n- Bullet item one\n- Bullet item two'}
                  />
                ) : (
                  <>
                    <div className={form.markdown} dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    <p className={form.help}>A quick approximation — the storefront uses a full Markdown parser, so spacing and tables look cleaner there.</p>
                  </>
                )}
              </div>

              <div className={form.section}><h3>Search engines</h3><p>What Google and link previews show. Optional — blank fields fall back to the title and the first paragraph.</p></div>
              <div>
                <AdminInput label="Meta title" value={form_.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} placeholder={form_.title} />
                <Counter value={form_.seoTitle} max={60} hint="Aim for 50–60 characters." />
              </div>
              <div>
                <AdminTextarea label="Meta description" minRows={2} maxRows={3} value={form_.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
                <Counter value={form_.seoDescription} max={160} hint="Aim for 150–160 characters." />
              </div>
              <div className={`${form.full} ${form.upload}`}>
                <Field label="Social preview image" hint="1200×630 PNG, JPG or WEBP, up to 5 MB.">
                  <ImageSlot label="" aspect="aspect-[1200/630]" className="w-[240px] max-w-full" hint="No image" value={form_.ogImage} onChange={(url) => set({ ogImage: url })} uploadEndpoint="/pages/upload-og" acceptedTypes="image/png,image/jpeg,image/webp,image/gif" />
                </Field>
              </div>
            </div>
          </section>

          <aside className={form.rail} aria-label="Publish">
            <div className={form.railTitle}>Publish</div>
            <div className={form.toggleRow}><div><strong>Published</strong><span>{form_.isPublished ? `Live at /page/${form_.slug}` : 'Hidden — returns 404.'}</span></div><AdminSwitch isSelected={form_.isPublished} onValueChange={(v) => set({ isPublished: v })} aria-label="Published" /></div>
            <AdminInput label="Order" type="number" value={String(form_.order)} onChange={(e) => set({ order: Number(e.target.value) || 0 })} description="Sort key in the admin list only." />
            <div className={form.railActions}>
              <AdminButton color="primary" type="submit" isLoading={saving}>Save changes</AdminButton>
              <a className={form.railLink} href={previewUrl(site, `/page/${originalSlug}`)} target="_blank" rel="noopener noreferrer"><IconExternal /> Open live page</a>
              <AdminButton variant="bordered" as={Link} href="/pages" isDisabled={saving}>Cancel</AdminButton>
              <button type="button" className={form.linkBtn} style={{ color: '#a3413b', justifySelf: 'start' }} onClick={remove}>Delete page…</button>
              {originalSlug && originalSlug !== form_.slug && <p className={form.railNote}>Slug changed — the old URL /page/{originalSlug} stops working once you save. Add a redirect if it’s linked from outside.</p>}
            </div>
          </aside>
        </form>
      </EditorPage>
    </AdminShell>
  );
}
