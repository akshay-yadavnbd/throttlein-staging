'use client';

/**
 * Prose pages list — `/pages/prose`.
 *
 * Lists every static-prose page in the CMS and lets admins add, edit
 * (via the per-page editor at /pages/prose/[id]), or delete them.
 * Backed by /api/pages.
 *
 * Pages can be drafts (`isPublished: false`) — these still show in the
 * admin list but 404 publicly until toggled live.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Button, Spinner, Chip, Card, CardBody, CardHeader } from '@heroui/react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminShell from '@/components/AdminShell';
import AdminInput from '@/components/AdminInput';
import HeroStat from '@/components/HeroStat';
import { api, unwrap, envelopeOrLegacy } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { useActiveSite } from '@/lib/useActiveSite';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';

type Page = {
  _id: string;
  slug: string;
  title: string;
  body?: string;
  seoTitle?: string;
  seoDescription?: string;
  isPublished: boolean;
  order: number;
  updatedAt?: string;
};

/** Slugify mirrors the backend hook so the placeholder accurately
 *  previews what the server would generate from a blank slug. */
function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export default function ProsePagesIndex() {
  // Refetch when the sidebar's site switcher moves — this screen's
  // rows are site-scoped.
  const site = useActiveSite();
  const router = useRouter();
  const [items, setItems] = useState<Page[]>([]);
  // Which site the list was last loaded for — "loading" is derived from
  // the mismatch rather than set inside the effect.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== site;

  // Quick-add form state
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const slugTouched = useRef(false);

  const load = useCallback(() => api.get('/pages', { params: { all: 1 } }).then(envelopeOrLegacy)
    .then(({ data }) => setItems(data.items || []))
    .catch((e: any) => notifyError(e, M.pages.couldntLoadPages))
    .finally(() => setLoadedFor(site)), [site]);
  useEffect(() => { void load(); }, [load]);

  const publishedCount = useMemo(
    () => items.filter((p) => p.isPublished).length,
    [items]
  );
  const totalCount = items.length;

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      notifyWarning(M.pages.titleIsRequired);
      return;
    }
    setCreating(true);
    try {
      const data = unwrap<{ page: { _id: string } }>(await api.post('/pages', { title, slug }));
      notifySuccess(M.pages.pageCreatedOpeningEditor);
      setTitle('');
      setSlug('');
      slugTouched.current = false;
      // Jump to the editor for the freshly created page
      router.push(`/pages/prose/${data.page._id}`);
    } catch (e: any) {
      notifyError(e, M.pages.couldntCreate);
    } finally {
      setCreating(false);
    }
  }

  async function remove(p: Page) {
    if (!(await confirmDialog({
      title: 'Delete page',
      message: `Delete "${p.title}"? The URL /page/${p.slug} will 404 after this.`,
      destructive: true,
      confirmLabel: 'Delete',
    }))) return;
    try {
      await api.delete(`/pages/${p._id}`);
      notifySuccess(M.pages.deleted);
      void load();
    } catch (e: any) {
      notifyError(e, M.pages.couldntDelete);
    }
  }

  async function togglePublish(p: Page, next: boolean) {
    try {
      await api.put(`/pages/${p._id}`, { isPublished: next });
      setItems((prev) =>
        prev.map((x) => (x._id === p._id ? { ...x, isPublished: next } : x))
      );
    } catch (e: any) {
      notifyError(e, M.pages.couldntUpdate);
    }
  }

  return (
    <AdminShell>
      {/* Breadcrumb */}
      <nav className="text-xs text-default-500 mb-3">
        <Link href="/pages" className="hover:text-brand-black">Pages</Link>
        <span className="mx-1.5">/</span>
        <span className="text-brand-black font-medium">Static pages</span>
      </nav>

      {/* HERO */}
      <div className="relative mb-6 rounded-2xl bg-brand-black text-white overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, #FFFFFF 0 1px, transparent 1px 14px)',
          }}
        />
        <div className="relative px-6 sm:px-8 py-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex flex-col gap-1.5 max-w-2xl">
            <div className="text-[10px] uppercase tracking-[0.3em] font-semibold text-white/60">
              Content · Static pages
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold leading-tight">
              About, Privacy, Terms, FAQ…
            </h1>
            <p className="text-sm text-white/70 leading-relaxed">
              Add any number of prose pages. Each renders at <code className="text-white/90">/p/&lt;slug&gt;</code>
              {' '}on the storefront. Markdown is supported in the body.
            </p>
          </div>
          <div className="flex items-stretch gap-3">
            <HeroStat label="Published" value={publishedCount} accent="emerald" />
            <HeroStat label="Total" value={totalCount} accent="indigo" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        {/* ─────────── QUICK ADD ─────────── */}
        <Card className="lg:sticky lg:top-[4.25rem] shadow-sm border border-default-200">
          <CardHeader className="flex items-center gap-3 px-6 pt-6 pb-3 border-b border-default-200">
            <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 grid place-items-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-brand-black">Add new page</div>
              <div className="text-xs text-default-500">Title + slug. You&apos;ll be sent to the body editor next.</div>
            </div>
          </CardHeader>
          <CardBody className="px-6 py-5">
            <form onSubmit={submitAdd} className="flex flex-col gap-4">
              <AdminInput
                label="Title"
                isRequired
                value={title}
                onChange={(e) => {
                  const v = e.target.value;
                  setTitle(v);
                  // Live-track slug from title until the admin types one explicitly.
                  if (!slugTouched.current) setSlug(slugify(v));
                }}
                placeholder="e.g. About Us"
              />
              <AdminInput
                label="Slug"
                description="URL segment — appears at /p/<slug>. Auto-generated from title if blank."
                value={slug}
                onChange={(e) => {
                  slugTouched.current = true;
                  setSlug(e.target.value);
                }}
                placeholder={title ? slugify(title) : 'about-us'}
              />
              <Button
                type="submit"
                color="primary"
                className="font-semibold w-full mt-2"
                isLoading={creating}
              >
                Create &amp; edit body →
              </Button>
            </form>
          </CardBody>
        </Card>

        {/* ─────────── LIST ─────────── */}
        <Card className="shadow-sm border border-default-200">
          <CardHeader className="flex items-center gap-3 px-6 pt-6 pb-3 border-b border-default-200">
            <span className="w-9 h-9 rounded-lg bg-default-100 text-default-600 grid place-items-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <polyline points="14 3 14 8 19 8" />
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-brand-black">All static pages</div>
              <div className="text-xs text-default-500">{items.length} total</div>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {loading ? (
              <div className="py-10 flex items-center justify-center gap-2 text-default-500">
                <Spinner size="sm" /> Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="py-16 text-center text-default-500">
                <div className="text-sm font-medium text-default-700">No static pages yet</div>
                <div className="text-xs mt-1">Create your first page from the panel on the left.</div>
              </div>
            ) : (
              <Table aria-label="Static pages" removeWrapper className="min-w-full">
                <TableHeader>
                  <TableColumn>TITLE</TableColumn>
                  <TableColumn>SLUG</TableColumn>
                  <TableColumn>STATUS</TableColumn>
                  <TableColumn>UPDATED</TableColumn>
                  <TableColumn>ACTIONS</TableColumn>
                </TableHeader>
                <TableBody>
                  {items.map((p) => (
                    <TableRow key={p._id}>
                      <TableCell>
                        <Link
                          href={`/pages/prose/${p._id}`}
                          className="text-sm font-semibold text-brand-black hover:underline"
                        >
                          {p.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-default-100 rounded px-1.5 py-0.5 text-default-700">
                          /p/{p.slug}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AdminSwitch
                            isSelected={p.isPublished}
                            onValueChange={(v) => togglePublish(p, v)}
                            aria-label="Toggle published"
                          />
                          <Chip
                            size="sm"
                            variant="flat"
                            color={p.isPublished ? 'success' : 'default'}
                          >
                            {p.isPublished ? 'Published' : 'Draft'}
                          </Chip>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-default-500">
                          {p.updatedAt
                            ? new Date(p.updatedAt).toLocaleDateString('en-IN', {
                                day: '2-digit', month: 'short', year: 'numeric',
                              })
                            : '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            as={Link}
                            href={`/pages/prose/${p._id}`}
                            size="sm"
                            variant="bordered"
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            color="danger"
                            variant="flat"
                            onPress={() => remove(p)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </AdminShell>
  );
}
