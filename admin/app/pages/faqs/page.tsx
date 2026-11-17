'use client';

/**
 * FAQs admin — `/pages/faqs`, in the workspace layout.
 *
 * One combined editor for the public /faqs page:
 *   1. Sections — each a collapsible row owning its own form state;
 *      inside, every Q&A is also collapsible so admins with 30+ FAQs
 *      aren't dumped into a 5,000px scroll. A section saves on its own.
 *   2. Search appearance — the shared static-meta panel for /faqs.
 *
 * State model: `items` holds the loaded sections (source of truth); each
 * <SectionCard> owns its own draft derived from them and PUTs on Save,
 * then the parent reloads. Open/closed state lives in the parent so
 * opening one section doesn't blow away another's unsaved edits.
 */

import { useEffect, useMemo, useState } from 'react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminShell from '@/components/AdminShell';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import RichTextEditor from '@/components/common/RichTextEditor';
import StaticPageMetaPanel from '@/components/StaticPageMetaPanel';
import { EditorPage, EditorHeader, Field, AddButton, RowTools, AccordionRow, IconButton, IconTrash, IconPlus, IconHelp } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type FaqItem = {
  _id?: string;
  question: string;
  answer: string;
  order: number;
};

type FaqSection = {
  _id: string;
  title: string;
  order: number;
  isActive: boolean;
  faqs: FaqItem[];
  updatedAt?: string;
};

export default function FaqsAdminPage() {
  const [items, setItems] = useState<FaqSection[] | null>(null);

  // Accordion state lives in the PARENT so opening / closing a section
  // doesn't unmount its <SectionCard> and lose unsaved edits.
  const [openSectionIds, setOpenSectionIds] = useState<Set<string>>(new Set());

  // Optimistic "new section" row — prepended with a temporary id so the
  // SectionCard renders the create flow instead of the update flow.
  const [newSectionDraft, setNewSectionDraft] = useState<FaqSection | null>(null);

  const load = () => api.get('/faqs/admin')
    .then((r) => setItems(unwrap<{ items?: any[] }>(r).items || []))
    .catch((err: any) => { notifyError(err, M.pages.couldntLoadFAQs); setItems([]); });
  useEffect(() => { void load(); }, []);

  function toggleSection(id: string) {
    setOpenSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startNew() {
    const tempId = `__new-${Date.now()}`;
    setNewSectionDraft({ _id: tempId, title: '', order: (items || []).length, isActive: true, faqs: [] });
    setOpenSectionIds((prev) => new Set(prev).add(tempId));
  }

  function discardNew() {
    if (!newSectionDraft) return;
    setOpenSectionIds((prev) => { const next = new Set(prev); next.delete(newSectionDraft._id); return next; });
    setNewSectionDraft(null);
  }

  async function handleSaved() {
    // Reload to pick up the canonical server-side _id and normalisation.
    setNewSectionDraft(null);
    await load();
  }

  async function handleDeleted(sectionId: string) {
    setOpenSectionIds((prev) => { const next = new Set(prev); next.delete(sectionId); return next; });
    await load();
  }

  const sortedSections = useMemo(() => [...(items || [])].sort((a, b) => a.order - b.order), [items]);
  const questionCount = sortedSections.reduce((n, s) => n + s.faqs.length, 0);

  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <EditorHeader
          icon={<IconHelp />}
          title="FAQs"
          meta={['/faqs', items ? `${sortedSections.length} ${sortedSections.length === 1 ? 'section' : 'sections'} · ${questionCount} ${questionCount === 1 ? 'question' : 'questions'}` : null, 'Changes reach the storefront within a minute']}
          actions={<AdminButton color="primary" onPress={startNew} isDisabled={!!newSectionDraft}><IconPlus /> New section</AdminButton>}
        />

        <div className={form.main}>
          <section className={form.panel} aria-labelledby="faq-sections-heading">
            <div className={`${form.head} ${form.headRow}`}>
              <div><h2 id="faq-sections-heading">Sections</h2><p>Groups of questions, in this order. Open a section to edit its questions; each section saves on its own.</p></div>
              <AdminButton variant="bordered" size="sm" onPress={startNew} isDisabled={!!newSectionDraft}><IconPlus /> New section</AdminButton>
            </div>
            <div className={form.grid}>
              <div className={`${form.full} ${form.rows}`}>
                {!items ? (
                  <div className={form.empty}>Loading sections…</div>
                ) : sortedSections.length === 0 && !newSectionDraft ? (
                  <div className={form.empty}>No sections yet. Add the first one — for example “Orders &amp; delivery”.</div>
                ) : (
                  <>
                    {newSectionDraft && (
                      <SectionCard section={newSectionDraft} isNew isOpen onToggle={discardNew} onSaved={handleSaved} onDeleted={() => discardNew()} />
                    )}
                    {sortedSections.map((s) => (
                      <SectionCard key={s._id} section={s} isOpen={openSectionIds.has(s._id)} onToggle={() => toggleSection(s._id)} onSaved={handleSaved} onDeleted={() => handleDeleted(s._id)} />
                    ))}
                  </>
                )}
              </div>
            </div>
          </section>

          <StaticPageMetaPanel route="/faqs" pageTitle="FAQs" supportsContent={false} />
        </div>
      </EditorPage>
    </AdminShell>
  );
}

/* ─────── SectionCard — one collapsible section ─────── */

function SectionCard({
  section,
  isOpen,
  isNew = false,
  onToggle,
  onSaved,
  onDeleted,
}: {
  section: FaqSection;
  isOpen: boolean;
  isNew?: boolean;
  onToggle: () => void;
  onSaved: (s: FaqSection) => void;
  onDeleted: (id: string) => void;
}) {
  // Local draft, re-seeded from the parent only when this section's
  // server copy actually changes (key on _id + updatedAt), so an
  // unrelated parent re-render never clobbers unsaved edits.
  const seedKey = `${section._id}:${section.updatedAt || ''}`;
  const [draftState, setDraftState] = useState<{ key: string; form: { title: string; order: number; isActive: boolean; faqs: FaqItem[] }; openQ: Set<number> }>(() => ({
    key: seedKey,
    form: { title: section.title, order: section.order, isActive: section.isActive, faqs: section.faqs.map((f) => ({ ...f })) },
    openQ: new Set(),
  }));
  const draft = draftState.key === seedKey ? draftState : {
    key: seedKey,
    form: { title: section.title, order: section.order, isActive: section.isActive, faqs: section.faqs.map((f) => ({ ...f })) },
    openQ: new Set<number>(),
  };
  const form_ = draft.form;
  const openQIdx = draft.openQ;
  const setForm = (fn: (p: typeof form_) => typeof form_) => setDraftState((d) => { const cur = d.key === seedKey ? d : draft; return { ...cur, form: fn(cur.form) }; });
  const setOpenQIdx = (fn: (p: Set<number>) => Set<number>) => setDraftState((d) => { const cur = d.key === seedKey ? d : draft; return { ...cur, openQ: fn(cur.openQ) }; });
  const [saving, setSaving] = useState(false);

  function toggleQ(idx: number) {
    setOpenQIdx((prev) => { const next = new Set(prev); if (next.has(idx)) next.delete(idx); else next.add(idx); return next; });
  }
  function addQuestion() {
    setOpenQIdx((prev) => new Set(prev).add(form_.faqs.length));
    setForm((p) => ({ ...p, faqs: [...p.faqs, { question: '', answer: '', order: p.faqs.length }] }));
  }
  function removeQuestion(idx: number) {
    setForm((p) => ({ ...p, faqs: p.faqs.filter((_, i) => i !== idx) }));
    setOpenQIdx((prev) => {
      const next = new Set<number>();
      // Re-index opened questions so indices stay valid after splice.
      prev.forEach((i) => { if (i < idx) next.add(i); else if (i > idx) next.add(i - 1); });
      return next;
    });
  }
  function moveQuestion(idx: number, delta: -1 | 1) {
    const target = idx + delta;
    if (target < 0 || target >= form_.faqs.length) return;
    setForm((p) => {
      const next = [...p.faqs];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...p, faqs: next.map((f, i) => ({ ...f, order: i })) };
    });
    setOpenQIdx((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => { if (i === idx) next.add(target); else if (i === target) next.add(idx); else next.add(i); });
      return next;
    });
  }
  function patchQuestion(idx: number, patch: Partial<FaqItem>) {
    setForm((p) => ({ ...p, faqs: p.faqs.map((f, i) => (i === idx ? { ...f, ...patch } : f)) }));
  }

  async function save() {
    const cleaned = {
      ...form_,
      title: form_.title.trim(),
      faqs: form_.faqs.map((f, i) => ({ ...f, order: i, question: f.question.trim() })).filter((f) => f.question && f.answer),
    };
    if (!cleaned.title) {
      notifyWarning(M.pages.sectionTitleIsRequired);
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const data = unwrap<{ item: any }>(await api.post('/faqs/admin', cleaned));
        notifySuccess(M.pages.sectionCreated);
        onSaved(data.item);
      } else {
        const data = unwrap<{ item: any }>(await api.put(`/faqs/admin/${section._id}`, cleaned));
        notifySuccess(M.pages.sectionUpdated);
        onSaved(data.item);
      }
    } catch (err: any) {
      notifyError(err, M.pages.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (isNew) { onDeleted(section._id); return; }
    const n = section.faqs.length;
    if (!(await confirmDialog({
      title: `Delete “${section.title}”?`,
      message: `${n ? `Its ${n} ${n === 1 ? 'question comes' : 'questions come'} off the FAQs page. ` : ''}This can’t be undone.`,
      destructive: true,
      confirmLabel: 'Delete section',
    }))) return;
    try {
      await api.delete(`/faqs/admin/${section._id}`);
      notifySuccess(M.pages.sectionDeleted);
      onDeleted(section._id);
    } catch (err: any) {
      notifyError(err, M.pages.couldntDelete);
    }
  }

  return (
    <AccordionRow
      open={isOpen}
      onToggle={onToggle}
      title={isNew ? (form_.title || <em>New section</em>) : section.title}
      meta={`${form_.faqs.length} ${form_.faqs.length === 1 ? 'question' : 'questions'}${form_.isActive ? '' : ' · hidden'} · order ${form_.order}`}
      tools={!isNew && <IconButton label={`Delete section ${section.title}`} danger onClick={remove}><IconTrash /></IconButton>}
    >
      <div className={form.grid} style={{ padding: 0 }}>
        <AdminInput label="Section title" isRequired placeholder="e.g. Orders & delivery" value={form_.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} autoFocus={isNew} />
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
          <AdminInput label="Order" type="number" value={String(form_.order)} onChange={(e) => setForm((p) => ({ ...p, order: Number(e.target.value) || 0 }))} description="Lower first." />
          <Field label="Visibility">
            <div className={form.inlineSwitch}><strong>{form_.isActive ? 'Shown' : 'Hidden'}</strong><AdminSwitch isSelected={form_.isActive} onValueChange={(v) => setForm((p) => ({ ...p, isActive: v }))} aria-label="Section shown" /></div>
          </Field>
        </div>

        <div className={`${form.subhead} ${form.sectionRow}`}>
          <div>Questions<p>Rows missing a question or answer are dropped on save.</p></div>
          <span className={form.pill}>{form_.faqs.length}</span>
        </div>
        <div className={`${form.full} ${form.rows}`}>
          {form_.faqs.length === 0 && <div className={form.empty}>No questions yet.</div>}
          {form_.faqs.map((faq, idx) => (
            <AccordionRow
              key={idx}
              open={openQIdx.has(idx)}
              onToggle={() => toggleQ(idx)}
              num={`Q${idx + 1}`}
              title={faq.question || <em>Untitled question</em>}
              tools={<RowTools index={idx} count={form_.faqs.length} noun="question" onMove={(d) => moveQuestion(idx, d)} onRemove={() => removeQuestion(idx)} />}
            >
              <AdminInput label="Question" isRequired placeholder="e.g. How do I track my order?" value={faq.question} onChange={(e) => patchQuestion(idx, { question: e.target.value })} />
              <Field label="Answer" required>
                <RichTextEditor value={faq.answer} onChange={(html) => patchQuestion(idx, { answer: html })} ariaLabel={`Question ${idx + 1} answer`} minHeight={160} />
              </Field>
            </AccordionRow>
          ))}
          <AddButton onClick={addQuestion}>Add question</AddButton>
        </div>

        <div className={`${form.full} ${form.accFoot}`}>
          {isNew ? <button type="button" className={form.linkBtn} onClick={remove}>Discard</button> : <span />}
          <AdminButton color="primary" onPress={save} isLoading={saving}>{isNew ? 'Create section' : 'Save section'}</AdminButton>
        </div>
      </div>
    </AccordionRow>
  );
}
