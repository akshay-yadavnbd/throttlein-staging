'use client';

/**
 * Static-route SEO override editor, in the workspace form layout.
 *
 * Backs Page records with type='static-meta' — each row provides a SEO
 * meta override for a hard-coded storefront route (e.g. /products, /sell).
 * The storefront's generateMetadata on those routes checks for a
 * matching Page and uses its seoTitle/seoDescription/ogImage if present,
 * otherwise falls back to the in-code defaults.
 *
 * Routes themselves live in `admin/lib/staticPages.ts`; this editor is
 * just the meta override surface for any of those entries. The on-page
 * content fields only show for routes flagged `supportsContent` (today:
 * /products) — the others render their body from code.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import AdminShell from '@/components/AdminShell';
import RichTextEditor from '@/components/common/RichTextEditor';
import ImageSlot from '@/components/media/ImageSlot';
import { StatusChip } from '@/components/ui';
import { EditorPage, BackLink, EditorHeader, EditorSkeleton, Field, Counter, IconSearch, IconExternal } from '@/components/EditorShell';
import { SerpPreview, TITLE_MAX, DESC_MAX } from '@/components/SeoFields';
import { api, unwrap } from '@/lib/api';
import { findStaticPage } from '@/lib/staticPages';
import { SELLER_STATIC_PAGES } from '@/lib/sellerStaticPages';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';

export default function StaticMetaEditor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [staticRoute, setStaticRoute] = useState('');
  const [site, setSite] = useState<'main' | 'seller'>('main');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [ogImage, setOgImage] = useState('');
  const [isPublished, setIsPublished] = useState(true);
  const [contentTitle, setContentTitle] = useState('');
  const [contentDescription, setContentDescription] = useState('');
  const [bottomTitle, setBottomTitle] = useState('');
  const [bottomDescription, setBottomDescription] = useState('');

  useEffect(() => {
    let mounted = true;
    api.get(`/pages/id/${id}`).then((r) => {
      const data = unwrap<{ page: any }>(r);
      if (!mounted) return;
      const p = data.page;
      setTitle(p.title || '');
      setStaticRoute(p.staticRoute || '');
      setSite(p.site === 'seller' ? 'seller' : 'main');
      setSeoTitle(p.seoTitle || '');
      setSeoDescription(p.seoDescription || '');
      setOgImage(p.ogImage || '');
      setIsPublished(p.isPublished !== false);
      setContentTitle(p.contentTitle || '');
      setContentDescription(p.contentDescription || '');
      setBottomTitle(p.bottomTitle || '');
      setBottomDescription(p.bottomDescription || '');
      setLoaded(true);
    }).catch((e: any) => { if (mounted) notifyError(e, M.pages.couldntLoad); });
    return () => { mounted = false; };
  }, [id]);

  /* Does this route actually render the on-page content fields? Looked
     up per-property, since the two manifests are separate. */
  const entry = site === 'seller'
    ? SELLER_STATIC_PAGES.find((p) => p.route === staticRoute)
    : findStaticPage(staticRoute);
  const supportsContent = !!entry?.supportsContent;

  const origin = site === 'seller'
    ? (process.env.NEXT_PUBLIC_SELLER_URL || 'https://seller.throttlein.com')
    : (process.env.NEXT_PUBLIC_SITE_URL || 'https://throttlein.com');
  const liveUrl = `${origin}${staticRoute === '/' ? '' : staticRoute}`;

  async function save() {
    setSaving(true);
    try {
      await api.put(`/pages/${id}`, {
        title: title.trim(),
        seoTitle: seoTitle.trim(),
        seoDescription: seoDescription.trim(),
        ogImage,
        isPublished,
        contentTitle: contentTitle.trim(),
        contentDescription: contentDescription.trim(),
        bottomTitle: bottomTitle.trim(),
        bottomDescription,
        // type + staticRoute aren't user-editable here — keep the
        // record's identity stable.
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
          icon={<IconSearch />}
          title={<>{title || entry?.title || staticRoute}<StatusChip label={isPublished ? 'Override on' : 'Override off'} status={isPublished ? 'seo_override' : 'inactive'} /></>}
          meta={['Search appearance', liveUrl.replace(/^https?:\/\//, ''), site === 'seller' ? 'Seller site' : 'Storefront']}
        />

        <form className={form.layout} onSubmit={(e) => { e.preventDefault(); save(); }}>
          <section className={form.panel}>
            <div className={form.grid}>
              <div className={form.section}><h3>Search appearance</h3><p>How this page looks in Google and when shared. Blank fields fall back to the defaults built into the storefront route.</p></div>
              <div>
                <AdminInput label="Meta title" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder="Leave blank for the built-in default" />
                <Counter value={seoTitle} max={TITLE_MAX} hint="Aim for 50–60 characters." />
              </div>
              <div>
                <AdminTextarea label="Meta description" minRows={2} maxRows={4} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} placeholder="Leave blank for the built-in default" />
                <Counter value={seoDescription} max={DESC_MAX} hint="Aim for 150–160 characters." />
              </div>
              <div className={`${form.full} ${form.upload}`}>
                <Field label="Social share image" hint="Shown on WhatsApp, X and LinkedIn previews. 1200×630 works best.">
                  <ImageSlot label="" aspect="aspect-[1200/630]" className="w-[240px] max-w-full" hint="No image" value={ogImage} onChange={setOgImage} uploadEndpoint="/pages/upload-og" />
                </Field>
              </div>
              {/* Preview sits last — it reads as the result of the fields above. */}
              <div className={form.full}><SerpPreview description={seoDescription} origin={origin} route={staticRoute} title={seoTitle} /></div>

              {supportsContent ? (
                <>
                  <div className={form.section}><h3>Top of the page</h3><p>Replaces the page heading and the intro line above the grid.</p></div>
                  <AdminInput label="Title" value={contentTitle} onChange={(e) => setContentTitle(e.target.value)} placeholder="e.g. All Motorcycle Products" />
                  <AdminTextarea label="Intro" minRows={2} value={contentDescription} onChange={(e) => setContentDescription(e.target.value)} placeholder="Short intro paragraph under the title" />

                  <div className={form.section}><h3>Below the grid</h3><p>SEO copy after the product grid — headings, links and lists are fine.</p></div>
                  <div className={form.full}><AdminInput label="Title" value={bottomTitle} onChange={(e) => setBottomTitle(e.target.value)} placeholder="e.g. Why buy motorcycle gear on THROTTLEIN?" /></div>
                  <div className={form.full}><RichTextEditor onChange={setBottomDescription} value={bottomDescription} ariaLabel="Bottom content" minHeight={200} /></div>
                </>
              ) : (
                /* Explicit rather than silent: an admin who edited
                   /products and then opened /about would otherwise wonder
                   where the content fields went. */
                <>
                  <div className={form.section}><h3>On-page content</h3></div>
                  <p className={`${form.full} ${form.info}`}><b>{staticRoute}</b> renders its body from code, so only the search fields above apply here. On-page copy is editable on listing routes such as <b>/products</b>.</p>
                </>
              )}
            </div>
          </section>

          <aside className={form.rail} aria-label="Publish">
            <div className={form.railTitle}>Publish</div>
            <div className={form.toggleRow}>
              <div><strong>Override active</strong><span>{isPublished ? <>These values are live on <b>{staticRoute}</b>.</> : <>Off — the storefront uses its built-in defaults for <b>{staticRoute}</b>.</>}</span></div>
              <AdminSwitch isSelected={isPublished} onValueChange={setIsPublished} aria-label="Override active" />
            </div>
            {/* Internal title lives here, not in the SEO panel — it isn't
                public meta. */}
            <AdminInput label="Internal title" value={title} onChange={(e) => setTitle(e.target.value)} description="Shown in the admin pages list only — never public." />
            <div className={form.railActions}>
              <AdminButton color="primary" type="submit" isLoading={saving}>Save changes</AdminButton>
              <a className={form.railLink} href={liveUrl} target="_blank" rel="noopener noreferrer"><IconExternal /> View live page</a>
              <AdminButton variant="bordered" as={Link} href="/pages" isDisabled={saving}>Cancel</AdminButton>
            </div>
          </aside>
        </form>
      </EditorPage>
    </AdminShell>
  );
}
