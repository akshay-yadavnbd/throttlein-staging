'use client';

/**
 * SellerFaqEditor — the FAQ block on the seller landing page
 * (seller.throttlein.com/, "Have any questions?"), as one workspace panel
 * of collapsible question rows.
 *
 * Backed by the same site-scoped FaqSection API the main /faqs page
 * uses (GET/POST/PUT /api/faqs/admin — the axios interceptor's
 * X-Admin-Site header scopes every call to the seller property, which
 * is guaranteed here because /pages/sell is a SELLER_ONLY_PATH).
 *
 * ONE section, not the main page's grouped many-section layout: the
 * seller landing page renders a single flat accordion, so the editor
 * manages the first seller section's questions and creates that
 * section on first save if the property has none. The section title is
 * never rendered on the storefront, so it isn't editable here.
 *
 * Whole-section save (one PUT), matching the controller's replace
 * semantics. Answers are stored as the editor's HTML.
 */

import { useEffect, useState } from 'react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import RichTextEditor from '@/components/common/RichTextEditor';
import { Field, AddButton, RowTools, AccordionRow } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type FaqItem = { question: string; answer: string };

type SectionDoc = {
  _id: string;
  title: string;
  isActive: boolean;
  faqs: { question: string; answer: string; order?: number }[];
};

export default function SellerFaqEditor() {
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [items, setItems] = useState<FaqItem[] | null>(null);
  const [saving, setSaving] = useState(false);
  // Set after any local edit — Save stays quiet until there's something to save.
  const [dirty, setDirty] = useState(false);
  // First row open by default.
  const [openIdx, setOpenIdx] = useState<Set<number>>(new Set([0]));

  useEffect(() => {
    api.get('/faqs/admin').then((r) => {
      const data = unwrap<{ items?: any[] }>(r);
      // Belt and braces: the API is already scoped by X-Admin-Site, but
      // this editor writes with a whole-section PUT, so grabbing the
      // wrong doc would OVERWRITE main-site content. Only accept a
      // section explicitly stored as the seller's.
      const first: (SectionDoc & { site?: string }) | undefined = (data?.items || []).filter((s: any) => s?.site === 'seller')[0];
      if (first) {
        setSectionId(first._id);
        setIsActive(first.isActive !== false);
        setItems((first.faqs || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((f) => ({ question: f.question, answer: f.answer })));
      } else {
        setItems([]);
      }
    }).catch((err: any) => { notifyError(err, M.sellEditors.couldntLoadFAQs); setItems([]); });
  }, []);

  const list = items || [];

  function toggle(i: number) {
    setOpenIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function patch(i: number, field: keyof FaqItem, value: string) {
    setItems((prev) => (prev || []).map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
    setDirty(true);
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    setItems((prev) => {
      const next = [...(prev || [])];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    // Open state follows the ITEM, not the slot.
    setOpenIdx((prev) => {
      const next = new Set<number>();
      for (const k of prev) next.add(k === i ? j : k === j ? i : k);
      return next;
    });
    setDirty(true);
  }

  async function remove(i: number) {
    const ok = await confirmDialog({
      title: 'Remove this question?',
      message: `“${list[i].question || 'Untitled question'}” comes off the seller landing page on the next save.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setItems((prev) => (prev || []).filter((_, idx) => idx !== i));
    setOpenIdx((prev) => {
      const next = new Set<number>();
      for (const k of prev) {
        if (k === i) continue;
        next.add(k > i ? k - 1 : k);
      }
      return next;
    });
    setDirty(true);
  }

  function add() {
    setOpenIdx((open) => new Set([...open, list.length]));
    setItems((prev) => [...(prev || []), { question: '', answer: '' }]);
    setDirty(true);
  }

  /** Strip tags to decide whether a rich-text answer is really empty. */
  function textOf(html: string): string {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  async function save() {
    const cleaned = list.map((it, i) => ({ question: it.question.trim(), answer: it.answer, order: i }));
    if (cleaned.some((it) => !it.question || !textOf(it.answer))) {
      notifyWarning(M.sellEditors.everyQuestionNeedsBothAQuestionAnd);
      return;
    }
    setSaving(true);
    try {
      const payload = { title: 'Have any questions?', isActive, faqs: cleaned };
      if (sectionId) {
        await api.put(`/faqs/admin/${sectionId}`, payload);
      } else {
        // First save on a property with no section yet — create it.
        const data = unwrap<{ item?: { _id: string } }>(await api.post('/faqs/admin', payload));
        setSectionId(data?.item?._id || null);
      }
      setDirty(false);
      notifySuccess(M.sellEditors.fAQsSaved);
    } catch (err: any) {
      notifyError(err, M.sellEditors.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={form.panel} aria-labelledby="seller-faq-heading">
      <div className={`${form.head} ${form.headRow}`}>
        <div><h2 id="seller-faq-heading">FAQ <span className={form.pill}>{items ? list.length : '…'}</span></h2><p>The “Have any questions?” accordion on the seller landing page, in this order.</p></div>
        <div className={form.toggleCell}>
          <AdminSwitch isSelected={isActive} onValueChange={(v) => { setIsActive(v); setDirty(true); }} aria-label="FAQ shown" />
          <span>{isActive ? 'Shown' : 'Hidden'}</span>
        </div>
      </div>
      <div className={form.grid}>
        {!items ? (
          <div className={`${form.full} ${form.empty}`}>Loading FAQs…</div>
        ) : (
          <>
            <div className={`${form.full} ${form.rows}`}>
              {list.length === 0 && <div className={form.empty}>No questions yet — add the first one below.</div>}
              {list.map((it, i) => (
                <AccordionRow
                  key={i}
                  open={openIdx.has(i)}
                  onToggle={() => toggle(i)}
                  num={`${i + 1}.`}
                  title={it.question || <em>Untitled question</em>}
                  tools={<RowTools index={i} count={list.length} noun="question" onMove={(d) => move(i, d)} onRemove={() => remove(i)} />}
                >
                  <AdminInput label="Question" isRequired placeholder="e.g. Is there a setup fee?" value={it.question} onChange={(e) => patch(i, 'question', e.target.value)} />
                  <Field label="Answer" required>
                    <RichTextEditor value={it.answer} onChange={(html) => patch(i, 'answer', html)} ariaLabel={`FAQ ${i + 1} answer`} minHeight={160} />
                  </Field>
                </AccordionRow>
              ))}
            </div>
            <div className={`${form.full} ${form.accFoot}`}>
              <AddButton onClick={add}>Add question</AddButton>
              <AdminButton color="primary" isLoading={saving} isDisabled={!dirty} onPress={save}>Save FAQs</AdminButton>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
