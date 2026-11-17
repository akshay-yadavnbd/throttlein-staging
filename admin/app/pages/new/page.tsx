'use client';

/**
 * Create-page form — full-page editor in the workspace layout. Admin
 * picks a template, fills in title, slug, filter, on-page content and
 * SEO, then creates the page; the server creates the Page record and we
 * redirect to the matching template editor for further edits.
 *
 * Mirrors /pages/dynamic/[id] so the controls feel familiar; the only
 * difference is that nothing exists in the DB yet, so save POSTs.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminSelect from '@/components/AdminSelect';
import AdminTextarea from '@/components/AdminTextarea';
import MultiPick from '@/components/MultiPick';
import AdminShell from '@/components/AdminShell';
import RichTextEditor from '@/components/common/RichTextEditor';
import ImageSlot from '@/components/media/ImageSlot';
import SellerCategoryFields, {
  EMPTY_SELLER_CATEGORY,
  type SellerCategoryValue,
} from '@/components/SellerCategoryFields';
import { StatusChip } from '@/components/ui';
import { EditorPage, BackLink, EditorHeader, Field, Counter, IconLayout, IconExternal } from '@/components/EditorShell';
import { api, unwrap, envelopeOrLegacy } from '@/lib/api';
import { useActiveSite } from '@/lib/useActiveSite';
import { previewUrl } from '@/lib/storefrontUrl';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type Cat = { _id: string; name: string; slug: string };
type Brand = { _id: string; name: string; slug: string };

type Template = 'products-list' | 'brands-list' | 'categories-list' | 'prose' | 'seller-category' | 'seller-category-2';

const TEMPLATES: {
  key: Template;
  label: string;
  blurb: string;
  /** True when the template renders the product catalogue. Only the
   *  main site has one, so these are hidden on other properties. */
  needsCatalog?: boolean;
  /** Restricts the template to one property. `seller-category` renders
   *  seller chrome and lives under /sell-online/, so it has no route on
   *  the storefront. */
  onlySite?: 'main' | 'seller';
}[] = [
  { key: 'products-list',   label: 'Products list',   blurb: 'Category-style grid filtered by category and brand.', needsCatalog: true },
  { key: 'brands-list',     label: 'Brands list',     blurb: 'Renders like the /brands index.', needsCatalog: true },
  { key: 'categories-list', label: 'Categories list', blurb: 'Renders the category index.', needsCatalog: true },
  { key: 'prose',           label: 'Prose',           blurb: 'Plain content at /page/<slug>.' },
  { key: 'seller-category', label: 'Seller category', blurb: '“Sell <X> Online” landing page at /sell-online/<slug>.', onlySite: 'seller' },
  // Same data + URL as the template above; only the storefront layout
  // differs (Figma node 4853:552 — centred hero, accordion "why",
  // eligibility cards, timeline steps).
  { key: 'seller-category-2', label: 'Seller category 2', blurb: 'The same “Sell <X> Online” page in the alternate layout.', onlySite: 'seller' },
];

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export default function NewPageEditor() {
  const router = useRouter();
  const site = useActiveSite();
  const isMainSite = site === 'main';

  /**
   * Templates offered for the active site.
   *
   * The three list templates render the product catalogue, and only the
   * main site has one. Offering them on the seller property produced a
   * dead end: the Categories picker fetches `/categories/admin`, which a
   * `seller-pages`-only editor gets a 403 from, so the list came back
   * empty while the save handler still insisted on at least one category.
   */
  const templates = useMemo(
    () =>
      TEMPLATES.filter(
        (t) =>
          (isMainSite ? true : !t.needsCatalog) &&
          (!t.onlySite || t.onlySite === site),
      ),
    [isMainSite, site],
  );

  // Identity. Prose is the default off the main site because it's the
  // only template available there.
  const [pickedTemplate, setTemplate] = useState<Template>(
    isMainSite ? 'products-list' : 'prose',
  );
  // Guard against the site switching while this form is open — if the
  // picked template is no longer offered, fall back to prose rather
  // than leaving an unsaveable selection in place.
  const template: Template = templates.some((t) => t.key === pickedTemplate) ? pickedTemplate : 'prose';
  const [title, setTitle] = useState('');
  // The slug follows the title until the admin types in the slug field.
  const [typedSlug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const slug = slugTouched ? typedSlug : slugify(title);

  // Product filter for products-list pages — ONE multi-select for
  // categories (at least one required) and one for brands. Pages live
  // at the top-level URL /<slug>; categories/brands only scope the grid.
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [filterBrandIds, setFilterBrandIds] = useState<string[]>([]);
  const [filterProductId] = useState('');
  const [locationLevel] = useState<'' | 'city' | 'state' | 'country'>('');
  const [locationValue] = useState('');

  // Body / on-page content / SEO
  const [body, setBody] = useState('');
  const [sellerCategory, setSellerCategory] =
    useState<SellerCategoryValue>(EMPTY_SELLER_CATEGORY);
  const [contentTitle, setContentTitle] = useState('');
  const [contentDescription, setContentDescription] = useState('');
  const [bottomTitle, setBottomTitle] = useState('');
  const [bottomDescription, setBottomDescription] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [ogImage, setOgImage] = useState('');
  const [isPublished, setIsPublished] = useState(true);

  // Lookups
  const [categories, setCategories] = useState<Cat[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [catsRes, brandsRes] = await Promise.all([
          // Admin returns { flat: [...], tree: [...] }. We want the flat
          // list so sub-categories show alongside their parents.
          api.get('/categories/admin').then(envelopeOrLegacy).catch(() => ({ data: { flat: [] } })),
          api.get('/brands').then(envelopeOrLegacy).catch(() => ({ data: { items: [] } })),
        ]);
        if (!mounted) return;
        // Only ACTIVE categories/brands — inactive ones don't exist on
        // the storefront, so picking them would silently show nothing.
        const cats =
          catsRes.data?.flat ||
          catsRes.data?.items ||
          catsRes.data?.categories ||
          [];
        setCategories(cats.filter((c: any) => c.isActive !== false));
        const brandList = brandsRes.data?.items || brandsRes.data?.brands || [];
        setBrands(brandList.filter((b: any) => b.isActive !== false));
      } catch {
        /* swallow — lookups are non-critical */
      }
    })();
    return () => { mounted = false; };
  }, []);

  const isSellerTpl = template === 'seller-category' || template === 'seller-category-2';
  const hasFilter = template === 'products-list' || isSellerTpl;
  // All pages live at the top-level URL — /<slug>; seller category pages
  // under /sell-online/, prose at /page/.
  const urlPreview = useMemo(
    () => isSellerTpl ? `/sell-online/${slug || '…'}` : template === 'prose' ? `/page/${slug || '…'}` : `/${slug || '…'}`,
    [slug, template, isSellerTpl],
  );
  const templateLabel = templates.find((t) => t.key === template)?.label || template;

  // Core save — POSTs the form, returns the created page so callers
  // can decide whether to redirect, preview, or both.
  async function performSave() {
    if (!title.trim()) {
      notifyWarning(M.pages.titleIsRequired);
      return null;
    }
    // Products-list pages need at least one category to scope the grid.
    if (template === 'products-list' && categoryIds.length === 0) {
      notifyWarning(M.pages.pickAtLeastOneCategoryForThis);
      return null;
    }
    setSaving(true);
    try {
      const body_: any = {
        title: title.trim(),
        slug: slug.trim() || slugify(title),
        body,
        contentTitle: contentTitle.trim(),
        contentDescription: contentDescription.trim(),
        bottomTitle: bottomTitle.trim(),
        bottomDescription,
        seoTitle: seoTitle.trim(),
        seoDescription: seoDescription.trim(),
        ogImage,
        isPublished,
      };
      if (template === 'prose') {
        body_.type = 'prose';
      } else {
        body_.type = 'dynamic';
        body_.template = template;
        // Pages live at the top-level /<slug> — no category URL prefix.
        body_.parentCategory = null;
        if (isSellerTpl) body_.sellerCategory = sellerCategory;
        body_.filter = {
          // First selected category doubles as the legacy single
          // `category` (breadcrumb / primary); `categories` carries the
          // full selection for the grid.
          category: categoryIds[0] || null,
          categories: categoryIds,
          // `brand` stays null — a set single brand would exclude the
          // page from top-level URL resolution (the resolver treats
          // filter.brand as a URL-segment marker). `brands` carries the
          // whole selection for the product filter.
          brand: null,
          brands: filterBrandIds,
          product: filterProductId || null,
          locationLevel,
          locationValue: slugify(locationValue),
        };
      }
      return unwrap<{ page: any }>(await api.post('/pages', body_)).page;
    } catch (e: any) {
      notifyError(e, M.pages.couldntCreate);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    const page = await performSave();
    if (!page) return;
    notifySuccess(M.pages.pageCreated);
    if (page.type === 'prose') router.push(`/pages/prose/${page._id}`);
    else router.push(`/pages/dynamic/${page._id}`);
  }

  // Save the page and open the public URL in a new tab. Pre-opens
  // window.open() *before* the network call so popup blockers don't
  // kill it.
  async function saveAndPreview() {
    const previewWindow = window.open('about:blank', '_blank');
    const page = await performSave();
    if (!page) {
      previewWindow?.close();
      return;
    }
    const path =
      page.type === 'prose'
        ? `/page/${page.slug}`
        : page.template === 'seller-category' || page.template === 'seller-category-2'
          ? `/sell-online/${page.slug}`
          : `/${page.slug}`;
    notifySuccess(M.pages.pageCreatedOpeningPreview);
    if (previewWindow) previewWindow.location.href = previewUrl(site, path);
  }

  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages">All pages</BackLink>
        <EditorHeader
          icon={<IconLayout />}
          title={<>{title || 'New page'}<StatusChip label={isPublished ? 'Will publish' : 'Draft'} status={isPublished ? 'published' : 'draft'} /></>}
          meta={[templateLabel, urlPreview]}
        />

        <form className={form.layout} onSubmit={(e) => { e.preventDefault(); save(); }}>
          <section className={form.panel}>
            <div className={form.grid}>
              <div className={form.section}><h3>Page</h3><p>What this page renders, and where it lives. The template can be changed later.</p></div>
              <Field label="Template" htmlFor="page-template" hint={templates.find((t) => t.key === template)?.blurb}>
                <AdminSelect id="page-template" fullWidth ariaLabel="Template" value={template} onChange={(v) => setTemplate(v as Template)} options={templates.map((t) => ({ value: t.key, label: t.label }))} />
              </Field>
              <div />
              <AdminInput label="Title" isRequired value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. LS2 Helmets & Jackets" autoFocus />
              <AdminInput label="Slug" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} placeholder="made-from-the-title" description={`Public URL: ${urlPreview}`} />

              {hasFilter && (
                <>
                  <div className={form.section}><h3>Products filter</h3><p>Which products show on this page. At least one category is required; brands are optional.</p></div>
                  <div className={form.full}>
                    <MultiPick label="Categories" placeholder="Search and add a category…" description="Products from every selected category show on the page." items={categories} selected={categoryIds} onChange={setCategoryIds} />
                  </div>
                  <div className={form.full}>
                    <MultiPick label="Brands (optional)" placeholder="Search and add a brand…" description="When set, only these brands’ products show." items={brands} selected={filterBrandIds} onChange={setFilterBrandIds} />
                  </div>
                </>
              )}

              {isSellerTpl && <SellerCategoryFields value={sellerCategory} onChange={setSellerCategory} />}

              {template === 'prose' ? (
                <>
                  <div className={form.section}><h3>Page content</h3><p>The page body. Headings, links, lists, bold and italic are supported.</p></div>
                  <div className={form.full}><RichTextEditor value={body} onChange={setBody} placeholder="Write the page content…" ariaLabel="Page body" minHeight={320} /></div>
                </>
              ) : (
                <>
                  <div className={form.section}><h3>Top of the page</h3><p>Replaces the heading and the intro line above the grid. Optional.</p></div>
                  <AdminInput label="Title" value={contentTitle} onChange={(e) => setContentTitle(e.target.value)} placeholder={title || 'Falls back to the page title'} maxLength={150} />
                  <AdminTextarea label="Intro" value={contentDescription} onChange={(e) => setContentDescription(e.target.value)} minRows={2} maxLength={500} />

                  <div className={form.section}><h3>Below the grid</h3><p>SEO copy after the product, brand or category grid — headings, links and lists are fine.</p></div>
                  <div className={form.full}><AdminInput label="Title" value={bottomTitle} onChange={(e) => setBottomTitle(e.target.value)} placeholder="e.g. Why buy riding gear on THROTTLEIN?" maxLength={150} /></div>
                  <div className={form.full}><RichTextEditor value={bottomDescription} onChange={setBottomDescription} ariaLabel="Bottom content" minHeight={200} /></div>
                </>
              )}

              <div className={form.section}><h3>Search engines</h3><p>What Google and link previews show. Optional — blank fields fall back to the title and the first paragraph.</p></div>
              <div>
                <AdminInput label="Meta title" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder={title || 'Falls back to the page title'} />
                <Counter value={seoTitle} max={60} hint="Aim for 50–60 characters." />
              </div>
              <div>
                <AdminTextarea label="Meta description" value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} minRows={2} maxRows={3} />
                <Counter value={seoDescription} max={160} hint="Aim for 150–160 characters." />
              </div>
              <div className={`${form.full} ${form.upload}`}>
                <Field label="Social preview image" hint="1200×630 PNG or JPG.">
                  <ImageSlot label="" aspect="aspect-[1200/630]" className="w-[240px] max-w-full" hint="No image" value={ogImage} onChange={setOgImage} uploadEndpoint="/pages/upload-og" />
                </Field>
              </div>
            </div>
          </section>

          <aside className={form.rail} aria-label="Publish">
            <div className={form.railTitle}>Publish</div>
            <div className={form.toggleRow}><div><strong>Published</strong><span>Unpublished pages return 404 on the storefront.</span></div><AdminSwitch isSelected={isPublished} onValueChange={setIsPublished} aria-label="Published" /></div>
            <div className={form.railActions}>
              <AdminButton color="primary" type="submit" isLoading={saving} isDisabled={!title.trim()}>Create page</AdminButton>
              <button type="button" className={form.railLink} onClick={saveAndPreview} disabled={!title.trim() || saving}><IconExternal /> Create &amp; preview</button>
              <AdminButton variant="bordered" as={Link} href="/pages" isDisabled={saving}>Cancel</AdminButton>
            </div>
          </aside>
        </form>
      </EditorPage>
    </AdminShell>
  );
}
