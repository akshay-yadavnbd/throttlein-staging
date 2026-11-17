'use client';

/**
 * Home page master editor — `/pages/home`, in the workspace form layout.
 *
 * All home-route content lives here: four section editors (hero banners,
 * promo blocks, seller CTA, home SEO block) as collapsible rows that
 * mount their editor in place, a search-appearance section for the
 * page's own meta, and a sticky publish rail whose one Save drives every
 * section editor and the page record together.
 *
 * Editors are LAZILY mounted — a row only renders its editor once it
 * has been opened — so the page stays snappy and doesn't fire four API
 * calls on load. Each editor exposes `save(): Promise<void>` through a
 * ref; saveAll() runs them in parallel with Promise.allSettled and
 * surfaces one combined toast. Editors never opened resolve trivially.
 */

import { useEffect, useRef, useState } from 'react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminShell from '@/components/AdminShell';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import ImageSlot from '@/components/media/ImageSlot';
import { StatusChip } from '@/components/ui';
import { EditorPage, BackLink, EditorHeader, EditorSkeleton, Field, Counter, IconHome, IconExternal, IconChevron } from '@/components/EditorShell';
import { SerpPreview, TITLE_MAX, DESC_MAX } from '@/components/SeoFields';
import { api, envelopeOrLegacy } from '@/lib/api';
import HeroBannersEditor, { type HeroBannersEditorHandle } from '@/components/home-editors/HeroBannersEditor';
import PromoBlocksEditor, { type PromoBlocksEditorHandle } from '@/components/home-editors/PromoBlocksEditor';
import SellerCtaEditor, { type SellerCtaEditorHandle } from '@/components/home-editors/SellerCtaEditor';
import HomeSeoBlockEditor, { type HomeSeoBlockEditorHandle } from '@/components/home-editors/HomeSeoBlockEditor';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';
import list from '@/components/WorkspaceList.module.css';

type HomePage = {
  _id: string;
  slug: string;
  title: string;
  type: 'home' | 'prose';
  seoTitle?: string;
  seoDescription?: string;
  ogImage?: string;
  isPublished: boolean;
  updatedAt?: string;
};

/** Generic handle exposed by every section editor. */
type EditorHandle = { save: () => Promise<void> };

type SectionKey = 'hero-banners' | 'promo-blocks' | 'seller-cta' | 'home-seo';

const SECTIONS: { key: SectionKey; title: string; subtitle: string }[] = [
  { key: 'hero-banners', title: 'Hero banners', subtitle: 'The swiper at the top of the storefront — desktop and mobile crops with click-through links.' },
  { key: 'promo-blocks', title: 'Promo blocks', subtitle: 'The three-card promo group. Add, remove, reorder.' },
  { key: 'seller-cta', title: 'Seller callout', subtitle: '“Take your offline business online” near the foot of the page — two photos, heading and button.' },
  { key: 'home-seo', title: 'SEO block', subtitle: 'The “Explore more” chips and the content block at the foot of the home page.' },
];

export default function HomePageMasterEditor() {
  const [page, setPage] = useState<HomePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Per-editor imperative handles. `.current` is null while the editor
  // is unmounted (its row hasn't been opened yet).
  const heroRef = useRef<HeroBannersEditorHandle | null>(null);
  const promoRef = useRef<PromoBlocksEditorHandle | null>(null);
  const sellerCtaRef = useRef<SellerCtaEditorHandle | null>(null);
  const homeSeoRef = useRef<HomeSeoBlockEditorHandle | null>(null);

  // Open rows. Multi-open so two sections can be compared side by side;
  // "ever opened" is tracked separately so collapsing keeps the editor
  // (and its unsaved edits) mounted.
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const [everOpened, setEverOpened] = useState<Set<string>>(new Set());

  /** Storefront origin — used by the SERP preview and the view link. */
  const storefrontOrigin = (
    process.env.NEXT_PUBLIC_STOREFRONT_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://throttlein.com'
  ).replace(/\/$/, '');

  const load = () => api.get('/pages/home').then(envelopeOrLegacy)
    .then(({ data }) => { setPage(data.page as HomePage); setError(null); })
    .catch((e: any) => {
      if (e?.response?.status === 404) {
        notifyWarning(M.pages.homePageRecordMissingRestartTheBackend);
        setError('missing');
      } else {
        notifyError(e, M.pages.couldntLoadHomePage);
        setError('failed');
      }
    });
  useEffect(() => { void load(); }, []);

  /** Save the page-meta record (SEO meta + visibility + OG image).
   *  Throws on failure so saveAll() can fold it into the combined toast. */
  async function savePageMeta() {
    if (!page) return;
    try {
      await api.put(`/pages/${page._id}`, {
        seoTitle: page.seoTitle,
        seoDescription: page.seoDescription,
        ogImage: page.ogImage,
        isPublished: page.isPublished,
      });
    } catch (e: any) {
      notifyError(e, M.pages.couldntSaveThePageDetails);
      throw e;
    }
  }

  /** Master save — every section editor + the page meta in parallel. */
  async function saveAll() {
    if (!page) return;
    setSaving(true);
    try {
      const runRef = (r: React.RefObject<EditorHandle | null>) =>
        r.current ? r.current.save() : Promise.resolve();
      const results = await Promise.allSettled([
        runRef(heroRef),
        runRef(promoRef),
        runRef(sellerCtaRef),
        runRef(homeSeoRef),
        savePageMeta(),
      ]);
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed === 0) {
        notifySuccess(M.pages.allChangesSaved);
      } else if (failed === results.length) {
        notifyWarning(M.pages.saveFailed);
      } else {
        notifyWarning(M.pages.sectionFailedToSave(failed, failed === 1 ? '' : 's'));
      }
      // Reload page-meta so the "Updated <time>" stamp refreshes.
      void load();
    } finally {
      setSaving(false);
    }
  }

  const sections = SECTIONS;
  const allOpen = openKeys.size === sections.length;
  function toggle(key: string) {
    setOpenKeys((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    setEverOpened((prev) => new Set(prev).add(key));
  }
  function toggleAll() {
    if (allOpen) { setOpenKeys(new Set()); return; }
    setOpenKeys(new Set(sections.map((s) => s.key)));
    setEverOpened(new Set(sections.map((s) => s.key)));
  }

  if (!page) {
    return (
      <AdminShell>
        <EditorPage moduleKey="pages">
          <BackLink href="/pages">All pages</BackLink>
          {error === 'missing' ? (
            <section className={`${list.workspace} ${list.state}`}><h3>Home page record missing</h3><p>Restart the backend to seed the system Home page, then refresh.</p></section>
          ) : error ? (
            <section className={`${list.workspace} ${list.state}`} role="alert"><h3>Couldn’t load the home page</h3><p>Try again in a moment.</p><button type="button" className={list.stateAction} onClick={() => { setError(null); void load(); }}>Try again</button></section>
          ) : (
            <EditorSkeleton label="Loading home page" />
          )}
        </EditorPage>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages">All pages</BackLink>
        <EditorHeader
          icon={<IconHome />}
          title={<>Home page<StatusChip label={page.isPublished ? 'Live' : 'Defaults'} status={page.isPublished ? 'live' : 'inactive'} /></>}
          meta={[
            storefrontOrigin.replace(/^https?:\/\//, ''),
            page.updatedAt ? `Saved ${new Date(page.updatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : null,
          ]}
        />

        <div className={form.layout}>
          <section className={form.panel}>
            <div className={form.grid}>
              <div className={`${form.section} ${form.sectionRow}`}>
                <div><h3>Sections</h3><p>Block-level content on the home route. Open one to edit it in place — everything saves together.</p></div>
                <button type="button" className={form.linkBtn} onClick={toggleAll}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
              </div>
              <div className={`${form.full} ${form.rows}`}>
                {sections.map((s) => {
                  const open = openKeys.has(s.key);
                  return (
                    <div key={s.key} className={form.acc}>
                      <button type="button" className={`${form.accToggle} ${form.accHead}`} style={{ width: '100%', padding: '12px 14px' }} onClick={() => toggle(s.key)} aria-expanded={open}>
                        <IconChevron />
                        <span className="min-w-0 flex-1">
                          <span className={form.cellPrimary}>{s.title}</span>
                          <span className={form.cellSub} style={{ whiteSpace: 'normal', maxWidth: 'none' }}>{s.subtitle}</span>
                        </span>
                      </button>
                      {everOpened.has(s.key) && (
                        <div className={form.accBody} style={{ display: open ? undefined : 'none' }}>
                          {s.key === 'hero-banners' && <HeroBannersEditor ref={heroRef} hideSaveButton />}
                          {s.key === 'promo-blocks' && <PromoBlocksEditor ref={promoRef} hideSaveButton />}
                          {s.key === 'seller-cta' && <SellerCtaEditor ref={sellerCtaRef} hideSaveButton />}
                          {s.key === 'home-seo' && <HomeSeoBlockEditor ref={homeSeoRef} hideSaveButton />}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className={form.section}><h3>Search engines</h3><p>How the home page looks in Google and when shared. Blank fields fall back to the page title and the built-in defaults.</p></div>
              <div>
                <AdminInput label="Meta title" value={page.seoTitle || ''} onChange={(e) => setPage({ ...page, seoTitle: e.target.value })} placeholder={page.title} />
                <Counter value={page.seoTitle || ''} max={TITLE_MAX} hint="Aim for 50–60 characters." />
              </div>
              <div>
                <AdminTextarea label="Meta description" minRows={2} maxRows={4} value={page.seoDescription || ''} onChange={(e) => setPage({ ...page, seoDescription: e.target.value })} placeholder="India's marketplace for motorcycle riders. Authentic gear and parts from verified sellers." />
                <Counter value={page.seoDescription || ''} max={DESC_MAX} hint="Aim for 150–160 characters." />
              </div>
              <div className={`${form.full} ${form.upload}`}>
                <Field label="Social share image" hint="Shown on WhatsApp, X and LinkedIn previews. 1200×630 works best.">
                  <ImageSlot label="" aspect="aspect-[1200/630]" className="w-[240px] max-w-full" hint="No image" value={page.ogImage || ''} onChange={(url) => setPage((pg) => (pg ? { ...pg, ogImage: url } : pg))} uploadEndpoint="/pages/upload-og" acceptedTypes="image/png,image/jpeg,image/webp,image/gif" />
                </Field>
              </div>
              <div className={form.full}><SerpPreview description={page.seoDescription || ''} fallbackTitle={page.title} origin={storefrontOrigin} route="/" title={page.seoTitle || ''} /></div>
            </div>
          </section>

          <aside className={form.rail} aria-label="Publish">
            <div className={form.railTitle}>Publish</div>
            <div className={form.toggleRow}>
              <div><strong>Live</strong><span>{page.isPublished ? 'The SEO meta and share image below are live on the storefront home page.' : 'Off — the home page still loads, but its meta falls back to the storefront defaults.'}</span></div>
              <AdminSwitch isSelected={page.isPublished} onValueChange={(v) => setPage({ ...page, isPublished: v })} aria-label="Live" />
            </div>
            <div className={form.railActions}>
              <AdminButton color="primary" onPress={saveAll} isLoading={saving}>Save changes</AdminButton>
              <a className={form.railLink} href={storefrontOrigin} target="_blank" rel="noreferrer"><IconExternal /> View storefront home</a>
              <p className={form.railMeta}>Saves every open section along with these search fields.</p>
            </div>
          </aside>
        </div>
      </EditorPage>
    </AdminShell>
  );
}
