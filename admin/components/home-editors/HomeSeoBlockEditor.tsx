'use client';

/**
 * Home SEO Block editor — shared component, mounted inside the home page
 * accordion AND inside the standalone `/pages/home-seo` page.
 *
 * Singleton editor for the bottom-of-homepage SEO surface: the "Explore
 * more" chip cloud above the prose, the heading + rich-text prose, and
 * the related-links cloud below it. Backed by GET / PUT /api/home-seo.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import RichTextEditor from '@/components/common/RichTextEditor';
import { Field, AddButton, RowTools } from '@/components/EditorShell';
import { api, envelopeOrLegacy } from '@/lib/api';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type SeoLink = { label: string; href: string };

type HomeSeoBlock = {
  _id?: string;
  heading: string;
  body: string;
  /** Top chip cloud — "Explore more" cloud above the prose. */
  links: SeoLink[];
  /** Bottom chip cloud — rendered below the prose. */
  bottomLinks: SeoLink[];
  isActive: boolean;
};

const EMPTY: HomeSeoBlock = {
  heading: '',
  body: '',
  links: [],
  bottomLinks: [],
  isActive: true,
};

/** Which of the two link arrays a given repeater is bound to. */
type LinksField = 'links' | 'bottomLinks';

export type HomeSeoBlockEditorHandle = { save: () => Promise<void> };

type HomeSeoBlockEditorProps = {
  /** When true, hides the bottom Save button — the master page
   *  drives saving via the imperative ref instead. */
  hideSaveButton?: boolean;
};

const HomeSeoBlockEditor = forwardRef<HomeSeoBlockEditorHandle, HomeSeoBlockEditorProps>(
  function HomeSeoBlockEditor({ hideSaveButton = false }, ref) {
  const [draft, setForm] = useState<HomeSeoBlock | null>(null);
  const [saving, setSaving] = useState(false);

  // Latest snapshot, so the imperative save() called by the master page
  // always sees the current values without re-binding the handle.
  const formRef = useRef<HomeSeoBlock>(EMPTY);
  useEffect(() => { if (draft) formRef.current = draft; }, [draft]);

  useEffect(() => {
    api.get('/home-seo').then(envelopeOrLegacy).then(({ data }) => {
      if (!data?.block) { setForm(EMPTY); return; }
      const top: SeoLink[] = Array.isArray(data.block.links)
        ? data.block.links.map((l: any) => ({ label: l?.label || '', href: l?.href || '' }))
        : [];
      // Back-compat: when an old record lacks bottomLinks entirely, seed
      // the bottom repeater with a copy of the top list. Once saved, the
      // two diverge.
      const bottomRaw = data.block.bottomLinks;
      const bottom: SeoLink[] = Array.isArray(bottomRaw)
        ? bottomRaw.map((l: any) => ({ label: l?.label || '', href: l?.href || '' }))
        : top;
      setForm({
        heading: data.block.heading || '',
        body: data.block.body || '',
        links: top,
        bottomLinks: bottom,
        isActive: data.block.isActive !== false,
      });
    }).catch((err: any) => { notifyError(err, M.homeEditors.couldntLoad); setForm(EMPTY); });
  }, []);

  /* ─── Per-field link operations ─── */
  const patch = (fn: (f: HomeSeoBlock) => HomeSeoBlock) => setForm((f) => (f ? fn(f) : f));
  function addLink(field: LinksField) {
    patch((f) => ({ ...f, [field]: [...f[field], { label: '', href: '' }] }));
  }
  function updateLink(field: LinksField, i: number, key: 'label' | 'href', value: string) {
    patch((f) => {
      const next = f[field].slice();
      next[i] = { ...next[i], [key]: value };
      return { ...f, [field]: next };
    });
  }
  function removeLink(field: LinksField, i: number) {
    patch((f) => ({ ...f, [field]: f[field].filter((_, idx) => idx !== i) }));
  }
  function moveLink(field: LinksField, i: number, delta: -1 | 1) {
    patch((f) => {
      const next = f[field].slice();
      const target = i + delta;
      if (target < 0 || target >= next.length) return f;
      [next[i], next[target]] = [next[target], next[i]];
      return { ...f, [field]: next };
    });
  }

  async function save() {
    const cleaned = (arr: SeoLink[]) =>
      arr.map((l) => ({ label: l.label.trim(), href: l.href.trim() })).filter((l) => l.label && l.href);
    const current = formRef.current;
    const payload = {
      heading: current.heading.trim(),
      body: current.body,
      isActive: current.isActive,
      links: cleaned(current.links),
      bottomLinks: cleaned(current.bottomLinks),
    };
    setSaving(true);
    try {
      await api.put('/home-seo', payload);
      notifySuccess(M.homeEditors.homeSEOBlockSaved);
    } catch (err: any) {
      notifyError(err, M.homeEditors.couldntSave);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  useImperativeHandle(ref, () => ({ save }), []);

  if (!draft) return <div className={form.empty}>Loading the SEO block…</div>;

  return (
    <div className={form.grid} style={{ padding: 0 }}>
      <div className={`${form.section} ${form.sectionRow}`}>
        <div><h3>Explore more</h3><p>The chip cloud above the prose. Rows missing a label or link are dropped on save.</p></div>
        <span className={form.pill}>{draft.links.length}</span>
      </div>
      <div className={form.full}>
        <LinksRepeater field="links" items={draft.links} onAdd={addLink} onUpdate={updateLink} onRemove={removeLink} onMove={moveLink} placeholder={{ label: 'Explore LS2 Helmets', href: '/helmets-and-accessories' }} />
      </div>

      <div className={`${form.section} ${form.sectionRow}`}>
        <div><h3>SEO content</h3><p>Heading and prose between the two chip clouds.</p></div>
        <div className={form.toggleCell}><AdminSwitch isSelected={draft.isActive} onValueChange={(v) => patch((f) => ({ ...f, isActive: v }))} aria-label="Section visible" /><span>{draft.isActive ? 'Shown' : 'Hidden'}</span></div>
      </div>
      <div className={form.full}><AdminInput label="Heading" value={draft.heading} onChange={(e) => patch((f) => ({ ...f, heading: e.target.value }))} placeholder="Discover our extensive range of bike accessories…" description="The H2 above the prose. Long lines wrap to two rows on desktop." /></div>
      <div className={form.full}>
        <Field label="Body">
          <RichTextEditor value={draft.body} onChange={(html) => patch((f) => ({ ...f, body: html }))} ariaLabel="SEO block body" minHeight={220} />
        </Field>
      </div>

      <div className={`${form.section} ${form.sectionRow}`}>
        <div><h3>Related links</h3><p>The chip cloud below the prose — curated separately so the two lists can target different searches.</p></div>
        <span className={form.pill}>{draft.bottomLinks.length}</span>
      </div>
      <div className={form.full}>
        <LinksRepeater field="bottomLinks" items={draft.bottomLinks} onAdd={addLink} onUpdate={updateLink} onRemove={removeLink} onMove={moveLink} placeholder={{ label: 'Browse Safety Accessories', href: '/safety' }} />
      </div>

      {!hideSaveButton && (
        <div className={`${form.full} ${form.accFoot}`} style={{ justifyContent: 'flex-end' }}>
          <AdminButton color="primary" onPress={save} isLoading={saving}>Save changes</AdminButton>
        </div>
      )}
    </div>
  );
});

export default HomeSeoBlockEditor;

/* Shared repeater — both chip clouds use it so the two stay consistent. */
function LinksRepeater({
  field, items, onAdd, onUpdate, onRemove, onMove, placeholder,
}: {
  field: LinksField;
  items: SeoLink[];
  onAdd: (field: LinksField) => void;
  onUpdate: (field: LinksField, i: number, key: 'label' | 'href', value: string) => void;
  onRemove: (field: LinksField, i: number) => void;
  onMove: (field: LinksField, i: number, delta: -1 | 1) => void;
  placeholder: { label: string; href: string };
}) {
  return (
    <div className={form.rows}>
      {items.length === 0 && <div className={form.empty}>No links yet.</div>}
      {items.map((link, i) => (
        <div key={i} className={form.row}>
          <AdminInput label="Label" value={link.label} onChange={(e) => onUpdate(field, i, 'label', e.target.value)} placeholder={placeholder.label} />
          <AdminInput label="Link" value={link.href} onChange={(e) => onUpdate(field, i, 'href', e.target.value)} placeholder={placeholder.href} />
          <RowTools index={i} count={items.length} noun="link" onMove={(d) => onMove(field, i, d)} onRemove={() => onRemove(field, i)} />
        </div>
      ))}
      <AddButton onClick={() => onAdd(field)}>Add link</AddButton>
    </div>
  );
}
