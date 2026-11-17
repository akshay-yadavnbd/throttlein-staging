'use client';

/**
 * Editor for the `seller-category` template — the "Sell <X> Online" landing
 * pages on the seller property. Renders as titled sections inside the page
 * editor's main panel (the parent supplies the `form.grid`).
 *
 * ONLY the category-specific fields appear here. The design's benefit cards,
 * "why sell" cards, 7 onboarding steps, video, tips and closing CTA are shared
 * across every category page and live in frontend/lib/sellerCategoryContent.ts,
 * so they are deliberately NOT editable per page — otherwise a wording change
 * means re-editing every category, and a new page starts from 40 blank fields.
 *
 * The "Types" and "Brands" grids are absent for the same reason: they resolve
 * live from the linked category's children and brands, so they can't go stale.
 * Pick the category in the Filter section and both grids populate themselves.
 */

import { useState } from 'react';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import RichTextEditor from '@/components/common/RichTextEditor';
import ImageSlot from '@/components/media/ImageSlot';
import { Field, AddButton, RowTools, AccordionRow } from '@/components/EditorShell';
import { imageUrl } from '@/lib/api';
import { storefrontOrigin } from '@/lib/storefrontUrl';
import { notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

export type FaqRow = { question: string; answer: string };
/** One slide of the "Why sell" slider / one card of the steps accordion —
 *  both Template-2 sections use the same {title, body, image} shape. */
export type WhyCardRow = { title: string; body: string; image: string };

export type SellerCategoryValue = {
  /** Short link label — see the "Category naming" section for where it shows. */
  linkTitle: string;
  noun: string;
  nounPlural: string;
  heroBodyOne: string;
  heroBodyTwo: string;
  heroImage: string;
  expandHeading: string;
  expandBody: string;
  expandImage: string;
  /* ── "Why sell" slider (Template 2) ──
     All optional; blank fields / no slides fall back to the shared
     built-in copy, so older pages keep rendering unchanged. */
  whyHeading: string;
  whyIntro: string;
  whyCards: WhyCardRow[];
  /* ── "How to register" steps accordion (Template 2) ── */
  stepsHeading: string;
  stepsIntro: string;
  steps: WhyCardRow[];
  /** Closing CTA band background photo (Template 2) — blank keeps the built-in. */
  closingImage: string;
  eligibilityBody: string;
  eligibilityImage: string;
  /** Template-2 banner heading — blank falls back to the shared heading. */
  eligibilityHeading: string;
  /** Template-2 banner photo collage, in display order. */
  eligibilityImages: string[];
  /** @deprecated merged into eligibilityBody; kept so old records survive a save. */
  eligibilityIntro: string;
  eligibilityItems: string[];
  eligibilityFootnote: string;
  /* ── Video block ──
     `videoId` is the BARE YouTube id. The field accepts a pasted URL
     and the backend reduces it to the id on save, so editors can paste
     whatever they copied. */
  videoHeading: string;
  videoThumbnail: string;
  videoId: string;
  faq: FaqRow[];
};

export const EMPTY_SELLER_CATEGORY: SellerCategoryValue = {
  linkTitle: '',
  noun: '', nounPlural: '',
  heroBodyOne: '', heroBodyTwo: '', heroImage: '',
  expandHeading: '', expandBody: '', expandImage: '',
  whyHeading: '', whyIntro: '', whyCards: [],
  stepsHeading: '', stepsIntro: '', steps: [],
  closingImage: '',
  eligibilityBody: '', eligibilityImage: '',
  eligibilityHeading: '', eligibilityImages: [],
  eligibilityIntro: '', eligibilityItems: [], eligibilityFootnote: '',
  videoHeading: '', videoThumbnail: '', videoId: '',
  faq: [],
};

/** Normalise whatever the API returned into a fully-populated value, so every
 *  input is controlled and React never warns about switching modes. */
export function toSellerCategoryValue(raw: any): SellerCategoryValue {
  const r = raw || {};
  // One-way migration on load: records written before the three eligibility
  // fields were merged get composed into HTML so the editor shows their
  // existing content instead of appearing blank. Saving then persists it as
  // `eligibilityBody` and the legacy fields stop being read.
  const legacyItems: string[] = Array.isArray(r.eligibilityItems) ? r.eligibilityItems : [];
  const composedLegacy = [
    r.eligibilityIntro ? `<p>${escapeHtml(r.eligibilityIntro)}</p>` : '',
    legacyItems.length
      ? `<ul>${legacyItems.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
      : '',
    r.eligibilityFootnote ? `<p>${escapeHtml(r.eligibilityFootnote)}</p>` : '',
  ].filter(Boolean).join('');

  return {
    ...EMPTY_SELLER_CATEGORY,
    ...r,
    // AFTER the spreads: `...r` would otherwise overwrite this with the raw
    // (possibly undefined) stored value and lose the composed legacy content —
    // and an undefined value would make the editor an uncontrolled input.
    eligibilityBody: r.eligibilityBody || composedLegacy || '',
    eligibilityItems: Array.isArray(r.eligibilityItems) ? r.eligibilityItems : [],
    // Same reason as above — `...r` can carry undefined for records saved
    // before these fields existed, which would make the inputs uncontrolled.
    videoHeading: r.videoHeading || '',
    videoThumbnail: r.videoThumbnail || '',
    videoId: r.videoId || '',
    whyHeading: r.whyHeading || '',
    whyIntro: r.whyIntro || '',
    whyCards: Array.isArray(r.whyCards)
      ? r.whyCards.map((c: any) => ({
          title: c?.title || '', body: c?.body || '', image: c?.image || '',
        }))
      : [],
    stepsHeading: r.stepsHeading || '',
    stepsIntro: r.stepsIntro || '',
    closingImage: r.closingImage || '',
    steps: Array.isArray(r.steps)
      ? r.steps.map((c: any) => ({
          title: c?.title || '', body: c?.body || '', image: c?.image || '',
        }))
      : [],
    eligibilityHeading: r.eligibilityHeading || '',
    eligibilityImages: Array.isArray(r.eligibilityImages)
      ? r.eligibilityImages.filter(Boolean)
      : [],
    faq: Array.isArray(r.faq)
      ? r.faq.map((f: any) => ({ question: f?.question || '', answer: f?.answer || '' }))
      : [],
  };
}

/** Minimal escape for composing legacy plain-text values into HTML. */
function escapeHtml(v: string): string {
  return String(v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function SellerCategoryFields({
  value,
  onChange,
}: {
  value: SellerCategoryValue;
  onChange: (next: SellerCategoryValue) => void;
}) {
  const set = <K extends keyof SellerCategoryValue>(k: K, v: SellerCategoryValue[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <>
      <div className={form.section}>
        <h3>Seller category page</h3>
        <p>
          Only the category-specific parts live here. The benefits, &ldquo;why sell&rdquo; cards,
          registration steps, video, tips and closing banner are shared by every category page
          and are edited in code, so they stay consistent. The <b>Types</b> and <b>Top brands</b>{' '}
          grids fill themselves from the category picked in the products filter.
        </p>
      </div>

      <div className={form.subhead}>Short title<p>How this page is labelled wherever it appears as a link — the &ldquo;Choose your categories&rdquo; box on the Sell Online page and the categories band in the footer. The page title above stays the H1. Blank uses the page title.</p></div>
      <AdminInput label="Short title" placeholder="Sell Helmets Online" value={value.linkTitle} onValueChange={(v) => set('linkTitle', v)} description="Keep it short — these sit four across." />

      <div className={form.subhead}>Category naming<p>Substituted into the shared headings: with &ldquo;Helmets&rdquo; and &ldquo;motorcycle helmets&rdquo; you get &ldquo;Why Sell Motorcycle Helmets on ThrottleIn?&rdquo; and &ldquo;Tips to Increase Your Helmets Sales Online&rdquo;.</p></div>
      <AdminInput label="Short name" placeholder="Helmets" value={value.noun} onValueChange={(v) => set('noun', v)} description="Used in short headings." />
      <AdminInput label="Full name" placeholder="motorcycle helmets" value={value.nounPlural} onValueChange={(v) => set('nounPlural', v)} description="Used mid-sentence. Lowercase unless it’s a proper noun." />

      <div className={form.subhead}>Hero<p>The H1 is the page title — no separate field, so they can never disagree.</p></div>
      <AdminTextarea label="First paragraph" minRows={2} value={value.heroBodyOne} onValueChange={(v) => set('heroBodyOne', v)} />
      <AdminTextarea label="Second paragraph" minRows={2} value={value.heroBodyTwo} onValueChange={(v) => set('heroBodyTwo', v)} />
      <div className={form.full}>
        <ImageField label="Hero product image" hint="Shown on a white card, around 316×316. A transparent PNG works best." value={value.heroImage} onChange={(v) => set('heroImage', v)} />
      </div>

      <div className={form.subhead}>&ldquo;Expand your business&rdquo; section</div>
      <div className={form.full}><AdminInput label="Heading" placeholder="Expand Your Helmet Business Online" value={value.expandHeading} onValueChange={(v) => set('expandHeading', v)} /></div>
      {/* Rich text, not a textarea: this is the page's main SEO copy. */}
      <div className={form.full}>
        <Field label="Body copy" hint="The page’s main SEO copy. Headings, links and lists are supported.">
          <RichTextEditor value={value.expandBody} onChange={(v) => set('expandBody', v)} ariaLabel="Expand section body copy" minHeight={240} />
        </Field>
      </div>
      <div className={form.full}>
        <ImageField label="Wide image" hint="Full width, around 1232×526." value={value.expandImage} onChange={(v) => set('expandImage', v)} />
      </div>

      <div className={form.subhead}>&ldquo;Why sell&rdquo; slider<p>The auto-advancing slider on Template 2 (one slide every 4 seconds; visitors can also click a title). Leave everything blank to keep the built-in slides. The {'{category}'} token is replaced with this page’s category name.</p></div>
      <div className={form.full}><AdminInput label="Heading" placeholder="Why Sell {category} on ThrottleIn?" value={value.whyHeading} onValueChange={(v) => set('whyHeading', v)} /></div>
      <div className={form.full}><AdminTextarea label="Intro paragraph" minRows={2} placeholder="Selling {category} online through a motorcycle-focused marketplace can help you…" value={value.whyIntro} onValueChange={(v) => set('whyIntro', v)} /></div>
      <div className={form.full}><WhyCardList items={value.whyCards} onChange={(whyCards) => set('whyCards', whyCards)} /></div>

      <div className={form.subhead}>&ldquo;How to register&rdquo; steps<p>The steps slider on Template 2 — one card shows the active step and advances every 4 seconds. Leave everything blank to keep the seven built-in steps. The {'{category}'} token works here too.</p></div>
      <div className={form.full}><AdminInput label="Heading" placeholder="How to Register and Sell {category} Online" value={value.stepsHeading} onValueChange={(v) => set('stepsHeading', v)} /></div>
      <div className={form.full}><AdminTextarea label="Intro paragraph" minRows={2} placeholder="You can begin your online selling journey by completing the following steps." value={value.stepsIntro} onValueChange={(v) => set('stepsIntro', v)} /></div>
      <div className={form.full}>
        <WhyCardList
          items={value.steps}
          onChange={(steps) => set('steps', steps)}
          noun="step"
          titlePlaceholder="Create Your Seller Account"
          bodyPlaceholder="Shown when this step is open. {category} is replaced with the page's category."
          imageHint="Shown on the white frame beside the text while this step is active, around 720×520 (fitted, not cropped). Leave empty to use the built-in illustration for that position."
          emptyNote="No custom steps — the page shows the seven built-in steps until you add one. Adding any step replaces the whole built-in set."
        />
      </div>

      <div className={form.subhead}>&ldquo;Who can sell&rdquo; section</div>
      <div className={form.full}><AdminInput label="Heading" placeholder="Who Can Sell {category} on ThrottleIn?" value={value.eligibilityHeading} onValueChange={(v) => set('eligibilityHeading', v)} description="Shown in white inside the dark banner on Template 2. Blank keeps the built-in heading." /></div>
      {/* One editor for the whole left column — intro, the list and the
          closing note. Bullet lists get the design's circle-check marks
          automatically. On Template 2 the first paragraph becomes the
          banner's white lead line and each list item becomes one card. */}
      <div className={form.full}>
        <Field label="Content" hint="Intro, then a bullet list (rendered with tick icons; one card per item on Template 2), then any closing note.">
          <RichTextEditor value={value.eligibilityBody} onChange={(v) => set('eligibilityBody', v)} ariaLabel="Who can sell content" minHeight={300} />
        </Field>
      </div>
      <div className={form.full}>
        <ImageField label="Side image (Template 1)" hint="Roughly square, around 596×560. Template 2 uses it as a single collage photo when the list below is empty." value={value.eligibilityImage} onChange={(v) => set('eligibilityImage', v)} />
      </div>
      <div className={form.full}>
        <EligibilityImageList items={value.eligibilityImages} onChange={(eligibilityImages) => set('eligibilityImages', eligibilityImages)} />
      </div>

      <div className={form.subhead}>Onboarding video<p>Optional. The section is hidden on the page unless a video ID is set. Clicking the thumbnail plays the video in a popup — visitors stay on the page.</p></div>
      <AdminInput label="Section title" placeholder="Watch seller onboarding guide" value={value.videoHeading} onValueChange={(v) => set('videoHeading', v)} description="Heading above the video, and the caption over the thumbnail." />
      <AdminInput label="YouTube video ID" placeholder="dQw4w9WgXcQ" value={value.videoId} onValueChange={(v) => set('videoId', v)} description="Just the ID — a full YouTube link works too; it’s reduced to the ID on save." />
      <div className={form.full}>
        <ImageField label="Thumbnail" hint="16:9 (1280×720 is ideal). Leave empty to use YouTube’s own thumbnail." value={value.videoThumbnail} onChange={(v) => set('videoThumbnail', v)} />
      </div>

      <div className={form.subhead}>Closing CTA band</div>
      <div className={form.full}>
        <ImageField label="Background photo" hint="Wide photo behind the dark closing banner (“Start Selling … Today”), around 1512×429. The photo shows through on the left; the right fades to black. Blank keeps the built-in photo." value={value.closingImage} onChange={(v) => set('closingImage', v)} />
      </div>

      <div className={form.subhead}>FAQ<p>Per page, because the questions are category-specific — and this block is also published as FAQ structured data for search engines.</p></div>
      <div className={form.full}><FaqList items={value.faq} onChange={(faq) => set('faq', faq)} /></div>
    </>
  );
}

/* ── Reusable bits ─────────────────────────────────────────────────── */

/** Upload-or-paste image field. The tile opens the MediaPicker (library +
 *  upload to the existing /pages/upload-og endpoint); a URL / path can
 *  still be pasted beside it. */
function ImageField({
  label, hint, value, onChange,
}: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} hint={hint}>
      <div className={form.upload}>
        <ImageSlot
          label=""
          aspect="aspect-[7/5]"
          className="w-[180px]"
          hint="No image"
          value={value}
          onChange={onChange}
          uploadEndpoint="/pages/upload-og"
          acceptedTypes="image/png,image/jpeg,image/webp,image/avif"
          /* Storefront-static paths (/images/…) live in the Next app's
             /public — the admin/backend origins 404 on them, so the
             thumbnail loads from the storefront origin instead. */
          previewSrc={(v) => (v.startsWith('/images/') ? `${storefrontOrigin('main')}${v}` : imageUrl(v))}
        />
        <div className="flex-1 min-w-[200px]">
          <AdminInput aria-label={`${label} URL`} size="sm" placeholder="…or paste an image URL / path" value={value} onValueChange={onChange} />
        </div>
      </div>
    </Field>
  );
}

/** Repeater for the Template-2 "Who can sell" banner collage photos.
 *  Order here = display order in the scrolling collage. */
function EligibilityImageList({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <Field label="Banner photos (Template 2)" hint="Two square photos shown diagonally overlapped on the dark banner’s right — the first sits top-left, the second bottom-right in front. Only the first two are shown. Empty falls back to the single side image above.">
      <div className={form.rows}>
        {items.map((img, i) => (
          <div key={i} className={form.rowStack}>
            <div className={form.rowStackHead}>
              <span>Photo {i + 1}</span>
              <span />
              <RowTools index={i} count={items.length} noun="photo" onMove={(d) => move(i, d)} onRemove={() => onChange(items.filter((_, k) => k !== i))} />
            </div>
            <ImageField label={`Photo ${i + 1}`} value={img} onChange={(v) => { const next = [...items]; next[i] = v; onChange(next); }} />
          </div>
        ))}
        <AddButton onClick={() => onChange([...items, ''])}>Add photo</AddButton>
      </div>
    </Field>
  );
}

/** Repeater for {title, body, image} rows — the "Why sell" slides and the
 *  "How to register" steps both use it, with their own wording. Row order
 *  is display order on the page. */
function WhyCardList({
  items, onChange,
  noun = 'slide',
  titlePlaceholder = 'Reach Motorcycle Riders',
  bodyPlaceholder = "Shown when this slide is open. {category} is replaced with the page's category.",
  imageHint = 'Shown on the right while this slide is open, around 356×335. Leave empty for the built-in illustration.',
  emptyNote = 'No custom slides — the page shows the six built-in slides until you add one. Adding any slide replaces the whole built-in set.',
}: {
  items: WhyCardRow[]; onChange: (v: WhyCardRow[]) => void;
  noun?: string; titlePlaceholder?: string; bodyPlaceholder?: string;
  imageHint?: string; emptyNote?: string;
}) {
  const setRow = (i: number, patch: Partial<WhyCardRow>) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const Noun = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;
  return (
    <div className={form.rows}>
      {items.length === 0 && <div className={form.empty}>{emptyNote}</div>}
      {items.map((row, i) => (
        <div key={i} className={form.rowStack}>
          <div className={form.rowStackHead}>
            <span>{noun} {i + 1}</span>
            <AdminInput aria-label={`${Noun} ${i + 1} title`} size="sm" placeholder={titlePlaceholder} value={row.title} onValueChange={(v) => setRow(i, { title: v })} />
            <RowTools index={i} count={items.length} noun={noun} onMove={(d) => move(i, d)} onRemove={() => onChange(items.filter((_, k) => k !== i))} />
          </div>
          <AdminTextarea aria-label={`${Noun} ${i + 1} body`} minRows={2} placeholder={bodyPlaceholder} value={row.body} onValueChange={(v) => setRow(i, { body: v })} />
          <ImageField label={`${Noun} image`} hint={imageHint} value={row.image} onChange={(v) => setRow(i, { image: v })} />
        </div>
      ))}
      <AddButton onClick={() => onChange([...items, { title: '', body: '', image: '' }])}>Add {noun}</AddButton>
    </div>
  );
}

/** FAQ editor (mirrors BlogForm's): collapsible rows with the question as
 *  the title and move / remove tools; expanding a row reveals the question
 *  input and a rich-text answer. Newly added rows open automatically. */
const FAQ_MAX = 10;

function FaqList({ items, onChange }: { items: FaqRow[]; onChange: (v: FaqRow[]) => void }) {
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const setRow = (i: number, patch: Partial<FaqRow>) =>
    onChange(items.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const add = () => {
    if (items.length >= FAQ_MAX) {
      notifyWarning(M.sellerCategoryFields.upToQuestionsGoogleRarelySurfacesMore(FAQ_MAX));
      return;
    }
    onChange([...items, { question: '', answer: '' }]);
    setOpenSet((prev) => new Set([...prev, items.length]));
  };
  const remove = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i));
    // Re-index the open-set so higher indices shift down by one.
    setOpenSet((prev) => {
      const next = new Set<number>();
      prev.forEach((idx) => {
        if (idx < i) next.add(idx);
        else if (idx > i) next.add(idx - 1);
      });
      return next;
    });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    // Keep the same ROWS open after the swap.
    setOpenSet((prev) => {
      const nextSet = new Set(prev);
      const hadI = prev.has(i);
      const hadJ = prev.has(j);
      if (hadI) nextSet.add(j); else nextSet.delete(j);
      if (hadJ) nextSet.add(i); else nextSet.delete(i);
      return nextSet;
    });
  };

  return (
    <div className={form.rows}>
      <div className={form.checkFoot}><span>Questions</span><span className={form.pill}>{items.filter((f) => f.question.trim()).length} / {FAQ_MAX}</span></div>
      {items.length === 0 && <div className={form.empty}>No questions yet — the FAQ section is hidden on the page until you add one.</div>}
      {items.map((row, i) => (
        <AccordionRow
          key={i}
          open={openSet.has(i)}
          onToggle={() => toggle(i)}
          num={`${i + 1}.`}
          title={row.question.trim() || <em>Untitled question</em>}
          tools={<RowTools index={i} count={items.length} noun="question" onMove={(d) => move(i, d)} onRemove={() => remove(i)} />}
        >
          <AdminInput label="Question" isRequired placeholder="Type the question…" value={row.question} onValueChange={(v) => setRow(i, { question: v })} />
          <Field label="Answer" required>
            <RichTextEditor value={row.answer} onChange={(html) => setRow(i, { answer: html })} placeholder="Answer — links, bold and lists are fine." ariaLabel={`FAQ ${i + 1} answer`} minHeight={160} />
          </Field>
        </AccordionRow>
      ))}
      <AddButton onClick={add} disabled={items.length >= FAQ_MAX}>Add question</AddButton>
    </div>
  );
}
