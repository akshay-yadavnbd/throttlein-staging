'use client';

/**
 * SellerGuideForm — full-page editor for a single Seller Guide, in the
 * workspace form layout (same family as the blog post editor): identity
 * header, one panel of sections (guide, search engines) and a sticky
 * rail with visibility, publish date, order, the hero image and Save.
 *
 * Used by /pages/sell/new (create) and /pages/sell/<id> (edit). Image
 * uploads go through POST /seller-guides/upload for both the hero and
 * the share image.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import RichTextEditor from '@/components/common/RichTextEditor';
import ImageSlot from '@/components/media/ImageSlot';
import { StatusChip } from '@/components/ui';
import { EditorHeader, Field, Counter, IconDoc } from '@/components/EditorShell';
import { api, imageUrl } from '@/lib/api';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type Mode = 'create' | 'edit';

type Initial = {
  _id?: string;
  title?: string;
  slug?: string;
  shortDescription?: string;
  content?: string;
  image?: string;
  order?: number;
  isActive?: boolean;
  publishedAt?: string | null;
  metaTitle?: string;
  metaDescription?: string;
  ogImage?: string;
};

/** Slugify — matches the backend's. */
function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

export default function SellerGuideForm({
  mode,
  initial = {},
  id,
}: {
  mode: Mode;
  initial?: Initial;
  id?: string;
}) {
  const router = useRouter();

  const [title, setTitle] = useState(initial.title || '');
  const [slug, setSlug] = useState(initial.slug || '');
  // While the admin hasn't edited the slug, typing in the title keeps
  // regenerating it. Existing rows load with this `true` so the slug
  // doesn't get rewritten under them while fixing a title typo.
  const [slugDirty, setSlugDirty] = useState<boolean>(!!initial.slug);
  const [shortDescription, setShortDescription] = useState(initial.shortDescription || '');
  const [content, setContent] = useState(initial.content || '');
  const [image, setImage] = useState(initial.image || '');
  const [order, setOrder] = useState<number>(typeof initial.order === 'number' ? initial.order : 0);
  const [isActive, setIsActive] = useState<boolean>(initial.isActive !== false);
  const [publishedAt, setPublishedAt] = useState<string>(
    initial.publishedAt ? new Date(initial.publishedAt).toISOString().slice(0, 16) : ''
  );
  const [metaTitle, setMetaTitle] = useState(initial.metaTitle || '');
  const [metaDescription, setMetaDescription] = useState(initial.metaDescription || '');
  const [ogImage, setOgImage] = useState(initial.ogImage || '');
  const [saving, setSaving] = useState(false);

  const slugAutoFromTitle = useMemo(() => slugify(title), [title]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      notifyWarning(M.sellerGuideForm.titleIsRequired);
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        title: title.trim(),
        shortDescription: shortDescription.trim(),
        content,
        image,
        order: Number(order) || 0,
        isActive,
        metaTitle: metaTitle.trim(),
        metaDescription: metaDescription.trim(),
        ogImage,
      };
      // Send slug only when the admin actually supplied one; the
      // backend auto-derives it from the title otherwise.
      if (slug.trim() || slugDirty) {
        payload.slug = slug.trim() || slugify(title);
      }
      // ISO string for the API; explicitly null when cleared (an empty
      // string would coerce to "Invalid Date").
      payload.publishedAt = publishedAt ? new Date(publishedAt).toISOString() : null;

      if (mode === 'create') {
        await api.post('/seller-guides', payload);
        notifySuccess(M.sellerGuideForm.guideCreated);
      } else {
        await api.put(`/seller-guides/${id}`, payload);
        notifySuccess(M.sellerGuideForm.guideUpdated);
      }
      router.replace('/pages/sell');
    } catch (err: any) {
      notifyError(err, M.sellerGuideForm.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <EditorHeader
        image={image ? imageUrl(image) : undefined}
        icon={<IconDoc />}
        title={<>{title || (mode === 'create' ? 'New guide' : 'Untitled guide')}<StatusChip label={isActive ? 'Active' : 'Hidden'} status={isActive ? 'active' : 'inactive'} /></>}
        meta={[
          <>/seller/guide/{slug || slugAutoFromTitle || '…'}</>,
          publishedAt ? `Dated ${new Date(publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : null,
        ]}
      />

      <div className={form.layout}>
        <section className={form.panel}>
          <div className={form.grid}>
            <div className={form.section}><h3>Guide</h3><p>Title, web address, the card blurb and the full guide.</p></div>
            <div className={form.full}>
              <AdminInput
                label="Title"
                isRequired
                value={title}
                onChange={(e) => { const v = e.target.value; setTitle(v); if (!slugDirty) setSlug(slugify(v)); }}
                placeholder="e.g. How to price your first listing"
                autoFocus={mode === 'create'}
              />
            </div>
            <AdminInput label="Slug" value={slug} onChange={(e) => { setSlug(slugify(e.target.value)); setSlugDirty(true); }} placeholder={slugAutoFromTitle || 'made-from-the-title'} startContent={<span className={form.prefix}>/seller/guide/</span>} description="Leave blank to make one from the title." />
            <div>
              <AdminTextarea label="Short description" value={shortDescription} onChange={(e) => setShortDescription(e.target.value.slice(0, 500))} placeholder="A quick guide to landing the price that converts…" minRows={2} maxRows={3} />
              <Counter value={shortDescription} max={500} hint="Shown on the card — two or three lines." />
            </div>
            <div className={form.full}>
              <Field label="Content">
                <RichTextEditor value={content} onChange={setContent} placeholder="Write the full guide — the toolbar has headings, lists, links and images." ariaLabel="Guide content" minHeight={480} />
              </Field>
            </div>

            <div className={form.section}><h3>Search engines</h3><p>What Google and link previews show. Optional — blank fields fall back to the title, short description and hero image.</p></div>
            <div>
              <AdminInput label="Meta title" value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder={title || 'Falls back to the guide title'} />
              <Counter value={metaTitle} max={60} hint="Aim for 50–60 characters." />
            </div>
            <div>
              <AdminTextarea label="Meta description" value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} placeholder={shortDescription || 'Falls back to the short description'} minRows={2} maxRows={3} />
              <Counter value={metaDescription} max={160} hint="Aim for 150–160 characters." />
            </div>
            <div className={`${form.full} ${form.upload}`}>
              <Field label="Social preview image" hint="1200×630. Falls back to the hero image.">
                <ImageSlot label="" aspect="aspect-[1200/630]" className="w-[240px] max-w-full" hint="No image" value={ogImage} onChange={setOgImage} uploadEndpoint="/seller-guides/upload" />
              </Field>
            </div>
          </div>
        </section>

        <aside className={form.rail} aria-label="Guide settings">
          <div className={form.railGroup}>
            <div className={form.railTitle}>Publish</div>
            <div className={form.toggleRow}><div><strong>Active</strong><span>When off, the guide is hidden from the seller home and its page returns 404.</span></div><AdminSwitch isSelected={isActive} onValueChange={setIsActive} aria-label="Active" /></div>
            <AdminInput type="datetime-local" label="Publish date" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} description="Shown under the title. Blank uses the creation date." />
            <AdminInput type="number" label="Order" value={String(order)} onChange={(e) => setOrder(Number(e.target.value) || 0)} description="Lower numbers show first." />
          </div>
          <div className={form.railGroup}>
            <div className={form.railTitle}>Hero image</div>
            <p className={form.railHint}>The card thumbnail and the hero on the guide page. 4:3 works best.</p>
            <ImageSlot label="" aspect="aspect-[4/3]" hint="No image yet" value={image} onChange={setImage} uploadEndpoint="/seller-guides/upload" />
          </div>
          <div className={form.railActions}>
            <AdminButton color="primary" type="submit" isLoading={saving}>{mode === 'create' ? 'Create guide' : 'Save changes'}</AdminButton>
            <AdminButton variant="bordered" as={Link} href="/pages/sell" isDisabled={saving}>Cancel</AdminButton>
            {mode === 'edit' && initial.slug && slug && slug !== initial.slug && <p className={form.railNote}>Slug changed — the old guide URL stops working once you save.</p>}
          </div>
        </aside>
      </div>
    </form>
  );
}
