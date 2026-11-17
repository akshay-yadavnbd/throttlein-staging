'use client';

/**
 * Blog post editor, in the workspace form layout: identity header, one
 * main panel of titled sections (post, key takeaways, references, FAQ,
 * search engines) beside a rail of grouped settings (publish, featured
 * image, author, category, tags), and a sticky action bar — the form is
 * far taller than any viewport, so Save has to travel with the admin.
 *
 * Data unchanged: GET /admin/blog/{categories,tags,authors} for the
 * pickers, POST /admin/blog or PUT /admin/blog/:id on save, inline
 * category creation via POST /admin/blog/categories.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminSelect from '@/components/AdminSelect';
import AdminTextarea from '@/components/AdminTextarea';
import RichTextEditor from '@/components/common/RichTextEditor';
import ImageSlot from '@/components/media/ImageSlot';
import { StatusChip } from '@/components/ui';
import {
  EditorHeader, Field, Counter, AddButton, RowTools, AccordionRow, IconClose, IconDoc, IconSearch,
} from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type Mode = 'create' | 'edit';

type Category = {
  _id: string;
  name: string;
  parent?: { _id: string; name: string } | string | null;
};
type Tag = { _id: string; name: string };
type AuthorOption = { _id: string; name: string; role?: string };

type Initial = {
  _id?: string;
  title?: string;
  slug?: string;
  excerpt?: string;
  body?: string;
  featuredImage?: string;
  category?: { _id: string; name: string } | null | string;
  categories?: ({ _id: string; name: string } | string)[];
  tags?: ({ _id: string; name: string } | string)[];
  author?: { _id: string; name: string } | null | string;
  status?: 'draft' | 'published' | 'scheduled' | 'archived';
  publishedAt?: string | null;
  metaTitle?: string;
  metaDescription?: string;
  ogImage?: string;
  isFeatured?: boolean;
  faqs?: { question: string; answer: string }[];
  faqHeading?: string;
  keyTakeaways?: string;
  references?: { title: string; url: string }[];
};

const FAQ_MAX = 10;
const REF_MAX = 30;
const STATUS_LABEL: Record<NonNullable<Initial['status']>, string> = {
  draft: 'Draft', published: 'Published', scheduled: 'Scheduled', archived: 'Archived',
};

export default function BlogForm({
  mode,
  initial = {},
  id,
}: {
  mode: Mode;
  initial?: Initial;
  id?: string;
}) {
  const router = useRouter();

  // ─── Core fields ─────────────────────────────────────────────────────
  const [title, setTitle] = useState(initial.title || '');
  const [slug, setSlug] = useState(initial.slug || '');
  const [excerpt, setExcerpt] = useState(initial.excerpt || '');
  const [body, setBody] = useState(initial.body || '');
  const [featuredImage, setFeaturedImage] = useState(initial.featuredImage || '');
  const [status, setStatus] = useState<NonNullable<Initial['status']>>(initial.status || 'draft');
  const [publishedAt, setPublishedAt] = useState<string>(
    initial.publishedAt ? new Date(initial.publishedAt).toISOString().slice(0, 16) : ''
  );
  const [isFeatured, setIsFeatured] = useState(!!initial.isFeatured);

  // ─── Taxonomy ────────────────────────────────────────────────────────
  // Multi-select categories — array of selected ids. Primary stays as
  // the existing `categoryId` (used for listing pills + JSON-LD).
  const initialCategoryId = typeof initial.category === 'string'
    ? initial.category
    : (initial.category as any)?._id || '';
  const initialCategoryIds = (initial.categories || [])
    .map((c: any) => (typeof c === 'string' ? c : c?._id))
    .filter(Boolean) as string[];
  // Make sure the primary (legacy single category) is part of the
  // selected set if it isn't already — keeps older posts consistent.
  const seedSelected = initialCategoryId && !initialCategoryIds.includes(initialCategoryId)
    ? [initialCategoryId, ...initialCategoryIds]
    : initialCategoryIds;
  const [categoryId, setCategoryId] = useState<string>(initialCategoryId);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(seedSelected);
  const [categorySearch, setCategorySearch] = useState('');

  // Walk up the parent chain to collect ancestor ids. Used so clicking
  // a sub-category auto-checks its parent (and grandparent, …) — the
  // post is recorded as belonging to every level of the hierarchy. The
  // deepest one the admin clicked stays the primary `categoryId`.
  function collectAncestorIds(id: string, cats: Category[]): string[] {
    const byId = new Map(cats.map((c) => [c._id, c]));
    const chain: string[] = [id];
    const guard = new Set<string>([id]); // avoid loops
    let cursor = byId.get(id);
    while (cursor && (cursor as any).parent) {
      const p = (cursor as any).parent;
      const parentId = typeof p === 'string' ? p : p?._id;
      if (!parentId || guard.has(parentId)) break;
      chain.push(parentId);
      guard.add(parentId);
      cursor = byId.get(parentId);
    }
    return chain;
  }

  function selectCategory(id: string) {
    const chain = collectAncestorIds(id, categories);
    setSelectedCategoryIds(chain);
    setCategoryId(id); // deepest clicked = primary
  }

  function clearCategory() {
    setSelectedCategoryIds([]);
    setCategoryId('');
  }
  // Inline new-category form state.
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryParent, setNewCategoryParent] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);

  async function createCategoryInline() {
    const name = newCategoryName.trim();
    if (!name) {
      notifyWarning(M.blogForm.categoryNameIsRequired);
      return;
    }
    setCreatingCategory(true);
    try {
      const data = unwrap<{ category: any }>(await api.post('/admin/blog/categories', {
        name,
        parent: newCategoryParent || null,
      }));
      const cat = data.category;
      // Add to the local categories list (sorted by name to match server)
      setCategories((prev) => {
        const next = [...prev, cat];
        next.sort((a, b) => a.name.localeCompare(b.name));
        return next;
      });
      // Auto-select the new category (and make it primary if none yet).
      setSelectedCategoryIds((prev) => [...prev, cat._id]);
      setCategoryId((prevPrimary) => prevPrimary || cat._id);
      setNewCategoryName('');
      setNewCategoryParent('');
      setShowAddCategory(false);
      notifySuccess(M.blogForm.added(cat.name));
    } catch (err: any) {
      notifyError(err, M.blogForm.couldntCreateCategory);
    } finally {
      setCreatingCategory(false);
    }
  }
  const initialTagIds = (initial.tags || [])
    .map((t: any) => (typeof t === 'string' ? t : t?._id))
    .filter(Boolean) as string[];
  const [tagIds, setTagIds] = useState<string[]>(initialTagIds);
  const [tagInput, setTagInput] = useState('');

  // Author byline — referenced from the BlogAuthor collection. Distinct
  // from createdBy (the admin User who created the post in the CMS).
  const initialAuthorId = typeof initial.author === 'string'
    ? initial.author
    : (initial.author as any)?._id || '';
  const [authorId, setAuthorId] = useState(initialAuthorId);

  // Lookup data
  const [categories, setCategories] = useState<Category[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [authors, setAuthors] = useState<AuthorOption[]>([]);

  // ─── SEO ──────────────────────────────────────────────────────────────
  const [metaTitle, setMetaTitle] = useState(initial.metaTitle || '');
  const [metaDescription, setMetaDescription] = useState(initial.metaDescription || '');
  const [ogImage, setOgImage] = useState(initial.ogImage || '');

  // ─── FAQs ────────────────────────────────────────────────────────────
  // Optional accordion at the foot of the article; the storefront only
  // shows it when at least one row has a question.
  const [faqs, setFaqs] = useState<{ question: string; answer: string }[]>(
    Array.isArray(initial.faqs) ? initial.faqs : []
  );
  const [faqHeading, setFaqHeading] = useState(initial.faqHeading || '');

  // ─── Key takeaways (rich HTML) ───────────────────────────────────────
  const [keyTakeaways, setKeyTakeaways] = useState(initial.keyTakeaways || '');

  // ─── References / sources ────────────────────────────────────────────
  // {title, url} citation rows, numbered at the foot of the article.
  // Capped at 30 by the backend.
  const [references, setReferences] = useState<{ title: string; url: string }[]>(
    Array.isArray(initial.references) ? initial.references : []
  );
  function addReference() {
    if (references.length >= REF_MAX) {
      notifyWarning(M.blogForm.referencesCap(REF_MAX));
      return;
    }
    setReferences((prev) => [...prev, { title: '', url: '' }]);
  }
  function updateReference(i: number, patch: Partial<{ title: string; url: string }>) {
    setReferences((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeReference(i: number) {
    setReferences((prev) => prev.filter((_, idx) => idx !== i));
  }
  function moveReference(i: number, dir: -1 | 1) {
    setReferences((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  // Which FAQ rows are expanded. Existing FAQs load collapsed; newly
  // added rows open so the admin can start typing straight away.
  const [openFaqs, setOpenFaqs] = useState<Set<number>>(new Set());
  function toggleFaq(i: number) {
    setOpenFaqs((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  function addFaq() {
    if (faqs.length >= FAQ_MAX) {
      notifyWarning(M.blogForm.faqCap(FAQ_MAX));
      return;
    }
    setOpenFaqs((prevSet) => new Set([...prevSet, faqs.length]));
    setFaqs((prev) => [...prev, { question: '', answer: '' }]);
  }
  function updateFaq(i: number, patch: Partial<{ question: string; answer: string }>) {
    setFaqs((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeFaq(i: number) {
    setFaqs((prev) => prev.filter((_, idx) => idx !== i));
    // Re-index the open-set so higher indices shift down by one.
    setOpenFaqs((prev) => {
      const next = new Set<number>();
      prev.forEach((idx) => {
        if (idx < i) next.add(idx);
        else if (idx > i) next.add(idx - 1);
      });
      return next;
    });
  }
  function moveFaq(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= faqs.length) return;
    setFaqs((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    // Swap open-states for i and j so the same row stays expanded.
    setOpenFaqs((prev) => {
      const next = new Set(prev);
      const hasI = next.has(i);
      const hasJ = next.has(j);
      next.delete(i);
      next.delete(j);
      if (hasI) next.add(j);
      if (hasJ) next.add(i);
      return next;
    });
  }

  // ─── Misc ─────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/admin/blog/categories').then((r) => setCategories(unwrap<{ items?: any[] }>(r).items || [])).catch(() => {});
    api.get('/admin/blog/tags').then((r) => setAllTags(unwrap<{ items?: any[] }>(r).items || [])).catch(() => {});
    api.get('/admin/blog/authors').then((r) => setAuthors(unwrap<{ items?: any[] }>(r).items || [])).catch(() => {});
  }, []);

  // Flatten categories into a depth-aware list so the picker can indent
  // sub-categories under their parent. While searching, show the
  // matches flat so results don't hide under collapsed parents.
  const categoryRows = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (q) {
      return categories
        .filter((c) => c.name.toLowerCase().includes(q))
        .map((c) => ({ _id: c._id, name: c.name, depth: 0 }));
    }
    const getParentId = (c: Category): string | null => {
      const p = (c as any).parent;
      if (!p) return null;
      return typeof p === 'string' ? p : p._id || null;
    };
    const childrenOf = new Map<string | null, Category[]>();
    for (const c of categories) {
      const key = getParentId(c);
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key)!.push(c);
    }
    for (const arr of childrenOf.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    const flat: { _id: string; name: string; depth: number }[] = [];
    const walk = (parentKey: string | null, depth: number) => {
      const kids = childrenOf.get(parentKey) || [];
      for (const c of kids) {
        flat.push({ _id: c._id, name: c.name, depth });
        walk(c._id, depth + 1);
      }
    };
    walk(null, 0);
    // Surface any orphans (parent missing from the local list) at root.
    const seen = new Set(flat.map((r) => r._id));
    for (const c of categories) {
      if (!seen.has(c._id)) flat.push({ _id: c._id, name: c.name, depth: 0 });
    }
    return flat;
  }, [categories, categorySearch]);

  // Auto-slug from title in create mode (until a custom slug is typed).
  const slugAutoFromTitle = useMemo(() => {
    return title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  }, [title]);
  const slugPlaceholder = slugAutoFromTitle || 'made-from-the-title';

  function addTagByName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    // If it matches an existing tag, add by _id. Otherwise add as raw name
    // and let the backend findOrCreate it on save.
    const existing = allTags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    const value = existing ? existing._id : trimmed;
    setTagIds((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setTagInput('');
  }

  function removeTag(value: string) {
    setTagIds((prev) => prev.filter((t) => t !== value));
  }

  function tagLabel(value: string) {
    return allTags.find((t) => t._id === value)?.name || value;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      notifyWarning(M.blogForm.titleIsRequired);
      return;
    }
    if (status === 'scheduled' && !publishedAt) {
      notifyWarning(M.blogForm.pickAPublishAtDateForScheduled);
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        title: title.trim(),
        excerpt: excerpt.trim(),
        body,
        featuredImage,
        category: categoryId || null,
        categories: selectedCategoryIds,
        author: authorId || null,
        tags: tagIds,
        status,
        isFeatured,
        metaTitle: metaTitle.trim(),
        metaDescription: metaDescription.trim(),
        ogImage,
        // Strip blank rows so the storefront can do `faqs.length > 0`.
        faqs: faqs
          .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
          .filter((f) => f.question),
        faqHeading: faqHeading.trim(),
        keyTakeaways,
        references: references
          .map((r) => ({ title: r.title.trim(), url: r.url.trim() }))
          .filter((r) => r.title && r.url),
      };
      if (slug.trim()) payload.slug = slug.trim();
      if (publishedAt) payload.publishedAt = new Date(publishedAt).toISOString();

      if (mode === 'create') {
        await api.post('/admin/blog', payload);
        notifySuccess(M.blogForm.postCreated);
      } else {
        await api.put(`/admin/blog/${id}`, payload);
        notifySuccess(M.blogForm.postUpdated);
      }
      router.replace('/blogs');
    } catch (err: any) {
      notifyError(err, M.blogForm.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  const authorName = authors.find((a) => a._id === authorId)?.name;
  const filledFaqs = faqs.filter((f) => f.question.trim()).length;
  const filledRefs = references.filter((r) => r.title.trim() && r.url.trim()).length;

  return (
    <form onSubmit={submit}>
      <EditorHeader
        icon={<IconDoc />}
        title={<>{title || (mode === 'create' ? 'New post' : 'Untitled post')}<StatusChip label={STATUS_LABEL[status]} status={status} />{isFeatured && <StatusChip label="Featured" status="approved" />}</>}
        meta={[
          <>/blog/{slug || slugAutoFromTitle || '…'}</>,
          authorName ? `By ${authorName}` : 'Byline: Throttlein Team',
          initial.publishedAt ? `Published ${new Date(initial.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : null,
        ]}
      />

      <div className={`${form.layout} ${form.wideRail}`}>
        <section className={form.panel}>
          <div className={form.grid}>
            <div className={form.section}><h3>Post</h3><p>Title, web address, the short summary shown on listing cards, and the article itself.</p></div>
            <div className={form.full}><AdminInput label="Title" isRequired value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Best motorcycle helmets in India 2026" autoFocus={mode === 'create'} /></div>
            <AdminInput label="Slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={slugPlaceholder} startContent={<span className={form.prefix}>/blog/</span>} description="Leave blank to make one from the title." />
            <AdminTextarea label="Excerpt" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="One or two sentences for the listing card and search results." minRows={2} maxRows={3} />
            <div className={form.full}>
              <Field label="Body" required>
                <RichTextEditor value={body} onChange={setBody} placeholder="Start writing — the toolbar has headings, lists, links and images." ariaLabel="Blog body" minHeight={520} />
              </Field>
            </div>

            <div className={form.section}><h3>Key takeaways</h3><p>Optional. A short list rendered above the article body — the three to five points a reader should leave with.</p></div>
            <div className={form.full}><RichTextEditor value={keyTakeaways} onChange={setKeyTakeaways} placeholder="Add the most important takeaways…" ariaLabel="Key takeaways" minHeight={180} /></div>

            <div className={`${form.section} ${form.sectionRow}`}>
              <div><h3>References &amp; sources</h3><p>Numbered at the foot of the article, in this order. Rows missing a title or link are dropped on save.</p></div>
              <span className={form.pill}>{filledRefs} / {REF_MAX}</span>
            </div>
            <div className={`${form.full} ${form.rows}`}>
              {references.length === 0 && <div className={form.empty}>No references yet.</div>}
              {references.map((r, i) => (
                <div key={i} className={form.row}>
                  <AdminInput label="Title" value={r.title} onChange={(e) => updateReference(i, { title: e.target.value })} placeholder="e.g. BIS standard IS 4151:2015" />
                  <AdminInput label="Link" type="url" value={r.url} onChange={(e) => updateReference(i, { url: e.target.value })} placeholder="https://…" />
                  <RowTools index={i} count={references.length} noun="reference" onMove={(d) => moveReference(i, d)} onRemove={() => removeReference(i)} />
                </div>
              ))}
              <AddButton onClick={addReference} disabled={references.length >= REF_MAX}>Add reference</AddButton>
            </div>

            <div className={`${form.section} ${form.sectionRow}`}>
              <div><h3>FAQ</h3><p>An accordion at the end of the article, also published as FAQ structured data. Hidden until at least one question is filled in.</p></div>
              <span className={form.pill}>{filledFaqs} / {FAQ_MAX}</span>
            </div>
            <div className={form.full}><AdminInput label="Section heading" value={faqHeading} onChange={(e) => setFaqHeading(e.target.value)} placeholder="Have any questions?" description="Blank uses the default heading." /></div>
            <div className={`${form.full} ${form.rows}`}>
              {faqs.length === 0 && <div className={form.empty}>No questions yet — the section stays hidden.</div>}
              {faqs.map((f, i) => (
                <AccordionRow
                  key={i}
                  open={openFaqs.has(i)}
                  onToggle={() => toggleFaq(i)}
                  num={`${i + 1}.`}
                  title={f.question.trim() || <em>Untitled question</em>}
                  tools={<RowTools index={i} count={faqs.length} noun="question" onMove={(d) => moveFaq(i, d)} onRemove={() => removeFaq(i)} />}
                >
                  <AdminInput label="Question" isRequired value={f.question} onChange={(e) => updateFaq(i, { question: e.target.value })} placeholder="Type the question…" />
                  <Field label="Answer" required>
                    <RichTextEditor value={f.answer} onChange={(html) => updateFaq(i, { answer: html })} placeholder="Answer — links, bold and lists are fine." ariaLabel={`FAQ ${i + 1} answer`} minHeight={160} />
                  </Field>
                </AccordionRow>
              ))}
              <AddButton onClick={addFaq} disabled={faqs.length >= FAQ_MAX}>Add question</AddButton>
            </div>

            <div className={form.section}><h3>Search engines</h3><p>What Google and link previews show. Optional — blank fields fall back to the title, excerpt and featured image.</p></div>
            <div>
              <AdminInput label="Meta title" value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder={title || 'Falls back to the post title'} />
              <Counter value={metaTitle} max={60} hint="Aim for 50–60 characters." />
            </div>
            <div>
              <AdminTextarea label="Meta description" value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} placeholder={excerpt || 'Falls back to the excerpt'} minRows={2} maxRows={3} />
              <Counter value={metaDescription} max={160} hint="Aim for 150–160 characters." />
            </div>
            <div className={`${form.full} ${form.upload}`}>
              <Field label="Social preview image" hint="1200×630. Falls back to the featured image.">
                <ImageSlot label="" aspect="aspect-[1200/630]" className="w-[240px] max-w-full" hint="No image" value={ogImage} onChange={setOgImage} uploadEndpoint="/admin/blog/upload-image" proxyUrl />
              </Field>
            </div>
          </div>
        </section>

        <aside className={`${form.rail} ${form.railStatic}`} aria-label="Post settings">
          <div className={form.railGroup}>
            <div className={form.railTitle}>Publish</div>
            <Field label="Status" htmlFor="post-status">
              <AdminSelect id="post-status" fullWidth ariaLabel="Status" value={status} onChange={(v) => setStatus(v as NonNullable<Initial['status']>)} options={(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
            </Field>
            {(status === 'scheduled' || status === 'published') && (
              <AdminInput
                type="datetime-local"
                label="Publish at"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
                description={status === 'scheduled' ? 'Stays a draft until this time, then publishes itself.' : 'Sets the order on the public blog index.'}
              />
            )}
            <div className={form.toggleRow}>
              <div><strong>Feature this post</strong><span>Shown in the /blog hero. Falls back to the latest post.</span></div>
              <AdminSwitch isSelected={isFeatured} onValueChange={setIsFeatured} aria-label="Feature this post" />
            </div>
          </div>

          <div className={form.railGroup}>
            <div className={form.railTitle}>Featured image</div>
            <ImageSlot label="" aspect="aspect-[4/3]" hint="No image yet" value={featuredImage} onChange={setFeaturedImage} uploadEndpoint="/admin/blog/upload-image" proxyUrl />
          </div>

          <div className={form.railGroup}>
            <div className={form.railTitle}>Author</div>
            <AdminSelect fullWidth ariaLabel="Author" value={authorId} onChange={setAuthorId} options={[{ value: '', label: 'Throttlein Team (default)' }, ...authors.map((a) => ({ value: a._id, label: `${a.name}${a.role ? ` — ${a.role}` : ''}` }))]} />
            <Link href="/blogs/authors" className={form.linkBtn}>Manage authors</Link>
          </div>

          <div className={form.railGroup}>
            <div className={form.railTitle}>Category</div>
            <p className={form.railHint}>Pick the most specific one — its parents are included automatically.</p>
            <AdminInput aria-label="Search categories" size="sm" value={categorySearch} onChange={(e) => setCategorySearch(e.target.value)} placeholder="Search categories" startContent={<span className={form.prefix}><IconSearch /></span>} />
            <div className={form.checkList}>
              {categories.length === 0 && (
                <div className={form.checkEmpty}>No categories yet. Add one below or in <Link href="/blogs/categories" className={form.linkBtn}>Categories</Link>.</div>
              )}
              {categoryRows.map((row) => {
                const checked = selectedCategoryIds.includes(row._id);
                const isLeaf = categoryId === row._id;
                const isAncestor = checked && !isLeaf;
                return (
                  <label key={row._id} style={{ paddingLeft: `${12 + row.depth * 16}px` }} className={`${form.checkRow} ${isLeaf ? form.checkRowLeaf : ''} ${isAncestor ? form.checkRowParent : ''}`}>
                    {row.depth > 0 && <span aria-hidden style={{ color: '#b8c2cb' }}>└</span>}
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        // Clicking a row makes it the primary and checks its
                        // ancestors; clicking the current primary clears all.
                        if (e.target.checked || !isLeaf) selectCategory(row._id);
                        else clearCategory();
                      }}
                    />
                    <span>{row.name}</span>
                    {isAncestor && <span className={form.checkTag}>Parent</span>}
                  </label>
                );
              })}
            </div>
            <div className={form.checkFoot}>
              <button type="button" className={form.linkBtn} onClick={clearCategory} disabled={selectedCategoryIds.length === 0}>Clear</button>
              <span>{selectedCategoryIds.length === 0 ? 'None selected' : `${selectedCategoryIds.length} in chain`}</span>
            </div>
            {!showAddCategory ? (
              <AddButton onClick={() => setShowAddCategory(true)}>New category</AddButton>
            ) : (
              <div className={form.rowStack}>
                <AdminInput
                  label="Name"
                  size="sm"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createCategoryInline(); } }}
                  placeholder="e.g. Touring tips"
                  autoFocus
                />
                <Field label="Parent">
                  <AdminSelect fullWidth ariaLabel="Parent category" value={newCategoryParent} onChange={setNewCategoryParent} options={[{ value: '', label: 'Top level (no parent)' }, ...categories.map((c) => ({ value: c._id, label: c.name }))]} />
                </Field>
                <div className="flex items-center gap-2">
                  <AdminButton color="primary" size="sm" onPress={createCategoryInline} isLoading={creatingCategory} isDisabled={!newCategoryName.trim()}>Create</AdminButton>
                  <AdminButton variant="bordered" size="sm" onPress={() => { setShowAddCategory(false); setNewCategoryName(''); setNewCategoryParent(''); }}>Cancel</AdminButton>
                </div>
              </div>
            )}
          </div>

          <div className={form.railGroup}>
            <div className={form.railTitle}>Tags</div>
            <div className={form.chips}>
              {tagIds.length === 0 && <span className={form.railHint}>No tags yet — type one below and press Enter.</span>}
              {tagIds.map((t) => (
                <span key={t} className={form.chip}>
                  {tagLabel(t)}
                  <button type="button" className={form.chipRemove} onClick={() => removeTag(t)} aria-label={`Remove tag ${tagLabel(t)}`}><IconClose /></button>
                </span>
              ))}
            </div>
            <AdminInput
              aria-label="Add tag"
              size="sm"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagByName(tagInput); } }}
              placeholder="Type and press Enter"
            />
            {allTags.length > 0 && (
              <div className={form.chips}>
                {allTags.filter((t) => !tagIds.includes(t._id)).slice(0, 10).map((t) => (
                  <button key={t._id} type="button" className={form.suggest} onClick={() => setTagIds((prev) => [...prev, t._id])}>+ {t.name}</button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div className={form.bar}>
          <span className={form.barInfo}>{mode === 'create' ? 'Nothing is saved until you create the post.' : `Editing “${initial.title || 'post'}”`}</span>
          <AdminButton variant="bordered" as={Link} href="/blogs" isDisabled={saving}>Cancel</AdminButton>
          <AdminButton color="primary" type="submit" isLoading={saving}>{mode === 'create' ? 'Create post' : 'Save changes'}</AdminButton>
        </div>
      </div>
    </form>
  );
}
