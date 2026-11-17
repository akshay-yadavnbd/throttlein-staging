'use client';

/**
 * Shared testimonial editor, rendered inside the modal on /testimonials.
 *
 * The fields map 1:1 onto the storefront card: avatar, name, company,
 * and the quote. Feedback is rich text rather than a plain textarea:
 * sellers' quotes routinely want a bolded figure ("5x growth") or a line
 * break between two thoughts, and the storefront already renders
 * sanitised HTML through RichTextView.
 *
 * The site is NOT a field here. It comes from the sidebar's site
 * switcher, forwarded on every request as `X-Admin-Site` by the axios
 * interceptor in lib/api.ts, and the backend scopes the write by it.
 */

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import RichTextEditor from '@/components/common/RichTextEditor';
import ImageSlot from '@/components/media/ImageSlot';
import { Field } from '@/components/EditorShell';
import { api } from '@/lib/api';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

export type TestimonialFormState = {
  name: string;
  company: string;
  avatar: string;
  quote: string;
  order: number;
  isActive: boolean;
};

export const emptyTestimonialForm: TestimonialFormState = {
  name: '',
  company: '',
  avatar: '',
  quote: '',
  order: 0,
  isActive: true,
};

/**
 * TipTap emits `<p></p>` for an empty document, so a blank editor still
 * posts a non-empty string. Strip tags before deciding whether the
 * author actually wrote anything. Mirrors `isBlankHtml` in the backend.
 */
function isBlankHtml(html: string): boolean {
  return !String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Initials fallback, matching what the storefront card renders when a
 *  testimonial has no avatar. */
function initialsOf(name: string): string {
  return (
    String(name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || '')
      .join('')
      .toUpperCase() || '?'
  );
}

export default function TestimonialForm({
  mode,
  initial,
  testimonialId,
  onSaved,
  onCancel,
  actionsPortal,
}: {
  mode: 'create' | 'edit';
  initial: TestimonialFormState;
  testimonialId?: string;
  onSaved?: () => void;
  /** Dismiss without saving (modal host). Falls back to the list route. */
  onCancel?: () => void;
  /** A modal host's footer element: Cancel / Save render there, outside
   *  the scrolling body, so they're always in reach. */
  actionsPortal?: HTMLElement | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [draft, setForm] = useState<TestimonialFormState>(initial);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!draft.name.trim()) {
      notifyWarning(M.testimonials.nameIsRequired);
      return;
    }
    if (isBlankHtml(draft.quote)) {
      notifyWarning(M.testimonials.feedbackIsRequired);
      return;
    }

    const payload = {
      ...draft,
      name: draft.name.trim(),
      company: draft.company.trim(),
    };

    setSaving(true);
    try {
      if (mode === 'create') {
        await api.post('/testimonials/admin', payload);
        notifySuccess(M.testimonials.testimonialCreated);
      } else {
        await api.put(`/testimonials/admin/${testimonialId}`, payload);
        notifySuccess(M.testimonials.testimonialUpdated);
      }
      if (onSaved) onSaved();
      else router.push('/testimonials');
    } catch (err: any) {
      notifyError(err, M.testimonials.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  const actions = (
    <>
      {/* Visibility sits beside Save — it's the last decision before
          saving, not a form field to scroll for. */}
      <label className="mr-auto flex cursor-pointer items-center gap-3">
        <AdminSwitch isSelected={draft.isActive} onValueChange={(v) => setForm((f) => ({ ...f, isActive: v }))} aria-label="Published" />
        <span className="text-[12px] leading-tight text-[#39434c]"><b className="block font-semibold text-[#252c32]">{draft.isActive ? 'Published' : 'Draft'}</b>{draft.isActive ? 'Visible on the site after saving.' : 'Saved but hidden from the site.'}</span>
      </label>
      <AdminButton variant="bordered" type="button" onPress={() => (onCancel ? onCancel() : router.push('/testimonials'))} isDisabled={saving}>Cancel</AdminButton>
      <AdminButton color="primary" onPress={() => formRef.current?.requestSubmit()} isLoading={saving}>{mode === 'create' ? 'Create testimonial' : 'Save changes'}</AdminButton>
    </>
  );

  return (
    <form ref={formRef} className={form.grid} style={{ padding: 0 }} onSubmit={submit}>
      {/* Laid out like the card itself: photo on the left, name and
          business beside it, the quote underneath — so the admin fills
          it in the order a visitor reads it, with no scrolling on a
          laptop screen. */}
      <div className={form.section}><h3>Who is speaking</h3><p>Shown at the top of the card — photo, name in bold, business name beneath it.</p></div>
      <div className={`${form.full} flex items-start gap-4`}>
        <Field label="Photo" className="flex-none">
          <ImageSlot label="" aspect="aspect-square" className="w-[96px]" hint={initialsOf(draft.name)} value={draft.avatar} onChange={(key) => setForm({ ...draft, avatar: key })} uploadEndpoint="/testimonials/upload" />
        </Field>
        <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_112px]">
          <AdminInput isRequired label="Name" value={draft.name} onChange={(e) => setForm({ ...draft, name: e.target.value })} placeholder="Raju Lunawath" autoFocus={mode === 'create'} />
          <AdminInput label="Business name" value={draft.company} onChange={(e) => setForm({ ...draft, company: e.target.value })} placeholder="Revgearzz" description="Optional — blank for an individual seller." />
          <AdminInput label="Order" type="number" value={String(draft.order)} onChange={(e) => setForm({ ...draft, order: Number(e.target.value) || 0 })} description="Lower shows first." />
          <p className={`${form.help} sm:col-span-3`} style={{ marginTop: -6 }}>Photo is optional — a square 160×160 or larger; without one the card shows the initials “{initialsOf(draft.name)}”.</p>
        </div>
      </div>

      <div className={form.section}><h3>Feedback</h3><p>The quote, a few sentences. The storefront adds the quotation marks — bold a figure or add a line break if it helps.</p></div>
      <div className={form.full}>
        <RichTextEditor ariaLabel="Testimonial feedback" minHeight={110} onChange={(html) => setForm((f) => ({ ...f, quote: html }))} placeholder="Beginning with a single category, the support and platform from Throttlein allowed me to expand rapidly…" value={draft.quote} />
      </div>


      {actionsPortal ? createPortal(actions, actionsPortal) : <div className={`${form.full} ${form.accFoot}`} style={{ justifyContent: 'flex-end' }}>{actions}</div>}
    </form>
  );
}
