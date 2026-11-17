'use client';

/**
 * Dynamic Page editor — backs Page records with type='dynamic', in the
 * workspace form layout: identity header (title, template, URL), one
 * panel of sections (page, products filter, seller-category fields,
 * top/bottom content, search engines) and a sticky publish rail.
 *
 * The storefront's dynamic catch-all route uses these fields to render
 * the appropriate template with the saved filter applied.
 */

import { use, useEffect, useState } from 'react';
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
  toSellerCategoryValue,
  type SellerCategoryValue,
} from '@/components/SellerCategoryFields';
import { StatusChip } from '@/components/ui';
import { EditorPage, BackLink, EditorHeader, EditorSkeleton, Field, Counter, IconLayout, IconExternal } from '@/components/EditorShell';
import { api, unwrap, envelopeOrLegacy } from '@/lib/api';
import { useActiveSite } from '@/lib/useActiveSite';
import { previewUrl } from '@/lib/storefrontUrl';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

type Cat = { _id: string; name: string; slug: string };
type Brand = { _id: string; name: string; slug: string };
type Product = { _id: string; name: string; slug?: string };

type PageDoc = {
  _id: string;
  slug: string;
  title: string;
  type: string;
  template: 'products-list' | 'brands-list' | 'categories-list' | 'seller-category' | 'seller-category-2';
  sellerCategory?: any;
  parentCategory?: Cat | string | null;
  filter?: {
    category?: Cat | string | null;
    brand?: Brand | string | null;
    // Multi-select variants — extra categories widen the grid, brands
    // narrow it. Single `category`/`brand` above stay the URL drivers.
    categories?: (Cat | string)[];
    brands?: (Brand | string)[];
    product?: Product | string | null;
    locationLevel?: '' | 'city' | 'state' | 'country';
    locationValue?: string;
  };
  body: string;
  contentTitle?: string;
  contentDescription?: string;
  bottomTitle?: string;
  bottomDescription?: string;
  seoTitle: string;
  seoDescription: string;
  ogImage: string;
  isPublished: boolean;
  updatedAt?: string;
};

function idOf(v: any): string {
  if (!v) return '';
  return typeof v === 'string' ? v : v._id || '';
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const TEMPLATE_LABELS: Record<PageDoc['template'], string> = {
  'products-list':    'Products list',
  'brands-list':      'Brands list',
  'categories-list':  'Categories list',
  'seller-category':  'Seller category',
  'seller-category-2': 'Seller category 2',
};

/* `seller-category` renders seller-property chrome and lives under
   /sell-online/, so it is only offered while editing the seller site —
   picking it on the storefront would produce a page with no route. */
const TEMPLATES_BY_SITE: Record<string, PageDoc['template'][]> = {
  main:   ['products-list', 'brands-list', 'categories-list'],
  seller: ['products-list', 'brands-list', 'categories-list', 'seller-category', 'seller-category-2'],
};

export default function DynamicPageEditor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const site = useActiveSite();
  const { id } = use(params);
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [originalSlug, setOriginalSlug] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | undefined>(undefined);
  const [template, setTemplate] = useState<PageDoc['template']>('products-list');
  const [sellerCategory, setSellerCategory] =
    useState<SellerCategoryValue>(EMPTY_SELLER_CATEGORY);
  // ONE multi-select for categories (at least one required for
  // products-list) and one for brands. Pages live at the top-level
  // URL /<slug>; the selections only scope the product grid.
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [filterBrandIds, setFilterBrandIds] = useState<string[]>([]);
  const [filterProductId, setFilterProductId] = useState('');
  const [locationLevel, setLocationLevel] = useState<'' | 'city' | 'state' | 'country'>('');
  const [locationValue, setLocationValue] = useState('');
  const [body, setBody] = useState('');
  const [contentTitle, setContentTitle] = useState('');
  const [contentDescription, setContentDescription] = useState('');
  const [bottomTitle, setBottomTitle] = useState('');
  const [bottomDescription, setBottomDescription] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [ogImage, setOgImage] = useState('');
  const [isPublished, setIsPublished] = useState(true);

  // Lookups — `categories`/`brands` hold ACTIVE records (the pickable
  // options); the `all*` lists keep inactive ones too so chips for
  // legacy selections still show their names.
  const [categories, setCategories] = useState<Cat[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [allCategories, setAllCategories] = useState<Cat[]>([]);
  const [allBrands, setAllBrands] = useState<Brand[]>([]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      api.get(`/pages/id/${id}`),
      api.get('/categories/admin').then(envelopeOrLegacy).catch(() => ({ data: { flat: [] } })),
      api.get('/brands').then(envelopeOrLegacy).catch(() => ({ data: { items: [] } })),
    ]).then(([pageRes, catsRes, brandsRes]) => {
      if (!mounted) return;
      const p: PageDoc = unwrap<{ page: PageDoc }>(pageRes).page;
      setTitle(p.title || '');
      setSlug(p.slug || '');
      setOriginalSlug(p.slug || '');
      setUpdatedAt(p.updatedAt);
      setTemplate(p.template || 'products-list');
      setSellerCategory(toSellerCategoryValue(p.sellerCategory));
      // Back-compat: older pages set `parentCategory` but not
      // `filter.category` (or vice-versa); merge the multi array with the
      // legacy single category so older pages load their selection.
      const primaryCatId = idOf(p.filter?.category) || idOf(p.parentCategory);
      setCategoryIds(Array.from(new Set([
        primaryCatId,
        ...(p.filter?.categories || []).map(idOf),
      ].filter(Boolean))));
      const brandIds = (p.filter?.brands || []).map(idOf).filter(Boolean);
      const legacyBrand = idOf(p.filter?.brand);
      setFilterBrandIds(brandIds.length ? brandIds : legacyBrand ? [legacyBrand] : []);
      setFilterProductId(idOf(p.filter?.product));
      setLocationLevel((p.filter?.locationLevel as any) || '');
      setLocationValue(p.filter?.locationValue || '');
      setBody(p.body || '');
      setContentTitle(p.contentTitle || '');
      setContentDescription(p.contentDescription || '');
      setBottomTitle(p.bottomTitle || '');
      setBottomDescription(p.bottomDescription || '');
      setSeoTitle(p.seoTitle || '');
      setSeoDescription(p.seoDescription || '');
      setOgImage(p.ogImage || '');
      setIsPublished(p.isPublished !== false);
      // Only ACTIVE categories/brands are pickable — inactive ones don't
      // exist on the storefront. Full lists kept for chip labels.
      const cats = catsRes.data?.flat || catsRes.data?.items || catsRes.data?.categories || [];
      setAllCategories(cats);
      setCategories(cats.filter((c: any) => c.isActive !== false));
      const brandList = brandsRes.data?.items || brandsRes.data?.brands || [];
      setAllBrands(brandList);
      setBrands(brandList.filter((b: any) => b.isActive !== false));
      setLoaded(true);
    }).catch((e: any) => {
      if (mounted) notifyError(e, M.pages.couldntLoadPage);
    });
    return () => { mounted = false; };
  }, [id]);

  const isSellerTpl = template === 'seller-category' || template === 'seller-category-2';
  const hasFilter = template === 'products-list' || isSellerTpl;
  const urlPath = isSellerTpl ? `/sell-online/${slug || '…'}` : `/${slug || '…'}`;

  async function save() {
    if (!title.trim()) {
      notifyWarning(M.pages.titleIsRequired);
      return;
    }
    // The category requirement only applies where a catalogue exists.
    // Off the main site `/categories/admin` 403s for a seller-only
    // editor, so the picker is empty — blocking the save on it would
    // make the page permanently uneditable, including its SEO fields.
    if (site === 'main' && template === 'products-list' && categoryIds.length === 0) {
      notifyWarning(M.pages.pickAtLeastOneCategoryForThis);
      return;
    }
    setSaving(true);
    try {
      await api.put(`/pages/${id}`, {
        title: title.trim(),
        slug: slug.trim() || slugify(title),
        type: 'dynamic',
        template,
        // Pages live at the top-level /<slug> — no category URL prefix.
        parentCategory: null,
        filter: {
          // First selected category doubles as the legacy single
          // `category` (breadcrumb / primary); `categories` carries the
          // full selection for the grid.
          category: categoryIds[0] || null,
          categories: categoryIds,
          // `brand` stays null — a set single brand would exclude the
          // page from top-level URL resolution. `brands` carries the
          // whole selection for the product filter.
          brand: null,
          brands: filterBrandIds,
          product: filterProductId || null,
          locationLevel,
          locationValue: locationValue.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        },
        body,
        contentTitle: contentTitle.trim(),
        contentDescription: contentDescription.trim(),
        bottomTitle: bottomTitle.trim(),
        bottomDescription,
        seoTitle: seoTitle.trim(),
        seoDescription: seoDescription.trim(),
        ogImage,
        isPublished,
        // Only sent for this template — the backend whitelists the keys,
        // and posting it for other templates would store dead data.
        ...(isSellerTpl ? { sellerCategory } : {}),
      });
      notifySuccess(M.pages.saved);
      router.push('/pages');
    } catch (e: any) {
      notifyError(e, M.pages.couldntSave);
    } finally {
      setSaving(false);
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

  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages">All pages</BackLink>
        <EditorHeader
          icon={<IconLayout />}
          title={<>{title || 'Untitled page'}<StatusChip label={isPublished ? 'Published' : 'Draft'} status={isPublished ? 'published' : 'draft'} /></>}
          meta={[
            TEMPLATE_LABELS[template],
            urlPath,
            updatedAt ? `Updated ${new Date(updatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : null,
          ]}
        />

        <form className={form.layout} onSubmit={(e) => { e.preventDefault(); save(); }}>
          <section className={form.panel}>
            <div className={form.grid}>
              <div className={form.section}><h3>Page</h3><p>Title, web address and which template renders it.</p></div>
              <AdminInput label="Title" isRequired value={title} onChange={(e) => setTitle(e.target.value)} />
              <AdminInput label="Slug" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} description="Lowercase letters, numbers and hyphens." />
              <Field label="Template" htmlFor="page-template">
                <AdminSelect id="page-template" fullWidth ariaLabel="Template" value={template} onChange={(v) => setTemplate(v as PageDoc['template'])} options={(TEMPLATES_BY_SITE[site] || TEMPLATES_BY_SITE.main).map((t) => ({ value: t, label: TEMPLATE_LABELS[t] }))} />
              </Field>

              {hasFilter && (
                <>
                  <div className={form.section}><h3>Products filter</h3><p>Which products show on this page. At least one category is required; brands are optional.</p></div>
                  <div className={form.full}>
                    <MultiPick label="Categories" placeholder="Search and add a category…" description="Products from every selected category show on the page." items={categories} labelItems={allCategories} selected={categoryIds} onChange={setCategoryIds} />
                  </div>
                  <div className={form.full}>
                    <MultiPick label="Brands (optional)" placeholder="Search and add a brand…" description="When set, only these brands’ products show." items={brands} labelItems={allBrands} selected={filterBrandIds} onChange={setFilterBrandIds} />
                  </div>
                </>
              )}

              {isSellerTpl && <SellerCategoryFields value={sellerCategory} onChange={setSellerCategory} />}

              {/* The legacy rich-text intro `body` is no longer editable
                  here; existing values are preserved on save. */}
              <div className={form.section}><h3>Top of the page</h3><p>Replaces the heading and the intro line above the grid. Optional.</p></div>
              <AdminInput label="Title" value={contentTitle} onChange={(e) => setContentTitle(e.target.value)} placeholder={title || 'Falls back to the page title'} maxLength={150} />
              <AdminTextarea label="Intro" value={contentDescription} onChange={(e) => setContentDescription(e.target.value)} minRows={2} maxLength={500} />

              <div className={form.section}><h3>Below the grid</h3><p>SEO copy after the product, brand or category grid — headings, links and lists are fine.</p></div>
              <div className={form.full}><AdminInput label="Title" value={bottomTitle} onChange={(e) => setBottomTitle(e.target.value)} placeholder="e.g. Why buy riding gear on THROTTLEIN?" maxLength={150} /></div>
              <div className={form.full}><RichTextEditor value={bottomDescription} onChange={setBottomDescription} ariaLabel="Bottom content" minHeight={200} /></div>

              <div className={form.section}><h3>Search engines</h3><p>What Google and link previews show. Optional — blank fields fall back to the title and the page body.</p></div>
              <div>
                <AdminInput label="Meta title" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder={title} />
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
              <AdminButton color="primary" type="submit" isLoading={saving}>Save changes</AdminButton>
              {/* Site-aware preview — see lib/storefrontUrl.ts. */}
              <a className={form.railLink} href={previewUrl(site, urlPath)} target="_blank" rel="noopener noreferrer" aria-disabled={!originalSlug}><IconExternal /> Open live page</a>
              <AdminButton variant="bordered" as={Link} href="/pages" isDisabled={saving}>Cancel</AdminButton>
              {originalSlug && slug !== originalSlug && <p className={form.railNote}>Slug changed — the old URL stops working once you save. Add a redirect if it’s linked from outside.</p>}
            </div>
          </aside>
        </form>
      </EditorPage>
    </AdminShell>
  );
}
