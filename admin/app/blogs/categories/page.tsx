'use client';

/**
 * Blog categories, in the workspace list layout: count, search, "Add
 * category" in the header, and a table — name with its parent, URL,
 * description, posts, status. Add and edit share one modal (shared modal
 * styles); Delete is in the row menu and says how many posts lose the
 * category.
 *
 * Data: GET/POST /admin/blog/categories, PUT/DELETE /admin/blog/categories/:id.
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminSelect from '@/components/AdminSelect';
import AdminTextarea from '@/components/AdminTextarea';
import ModuleTabs from '@/components/ModuleTabs';
import { RowActions, StatusChip } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { useActiveSite } from '@/lib/useActiveSite';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';
import modal from '@/components/AdminModal.module.css';
import form from '@/components/AdminForm.module.css';

type Category = { _id: string; name: string; slug: string; description?: string; order: number; isActive: boolean; postCount?: number; parent?: { _id: string; name: string } | string | null };
type Draft = { name: string; slug: string; description: string; order: string; isActive: boolean; parent: string };
const empty: Draft = { name: '', slug: '', description: '', order: '0', isActive: true, parent: '' };
const parentId = (c: Category) => (typeof c.parent === 'string' ? c.parent : c.parent?._id || '');

export default function BlogCategoriesPage() {
  const site = useActiveSite();
  const [items, setItems] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{ id?: string; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/admin/blog/categories')
    .then((r) => { setItems(unwrap<{ items?: any[] }>(r).items || []); setError(null); })
    .catch((e) => setError(e?.response?.status >= 500 || !e?.response ? 'Categories are unavailable right now.' : 'Categories couldn’t be loaded.'));
  useEffect(() => { void load(); }, [site, attempt]);

  const all = useMemo(() => items || [], [items]);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return q ? all.filter((c) => c.name.toLowerCase().includes(q) || c.slug.includes(q)) : all; }, [all, search]);
  const nameOf = (id: string) => all.find((c) => c._id === id)?.name;

  async function save() {
    if (!editor) return;
    const d = editor.draft;
    if (!d.name.trim()) { notifyWarning(M.blogForm.categoryNameIsRequired); return; }
    setSaving(true);
    const body = { name: d.name.trim(), slug: d.slug.trim() || undefined, description: d.description.trim(), order: Number(d.order) || 0, isActive: d.isActive, parent: d.parent || null };
    try {
      if (editor.id) { await api.put(`/admin/blog/categories/${editor.id}`, body); notifySuccess(M.blogs.categoryUpdated); }
      else { await api.post('/admin/blog/categories', body); notifySuccess(M.blogs.categoryCreated); }
      setEditor(null); await load();
    } catch (e: any) { notifyError(e, editor.id ? M.blogs.couldntUpdate : M.blogs.couldntCreate); }
    finally { setSaving(false); }
  }
  async function remove(c: Category) {
    const n = c.postCount || 0;
    const ok = await confirmDialog({ title: `Delete ${c.name}?`, message: n ? `${n} ${n === 1 ? 'post becomes' : 'posts become'} uncategorised. This can’t be undone.` : 'This can’t be undone.', destructive: true, confirmLabel: 'Delete category' });
    if (!ok) return;
    try { await api.delete(`/admin/blog/categories/${c._id}`); notifySuccess(M.blogs.categoryDeleted); await load(); }
    catch (e: any) { notifyError(e, M.blogs.couldntDelete); }
  }
  const openEdit = (c: Category) => setEditor({ id: c._id, draft: { name: c.name, slug: c.slug || '', description: c.description || '', order: String(c.order ?? 0), isActive: c.isActive, parent: parentId(c) } });
  const set = (patch: Partial<Draft>) => setEditor((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const onRowClick = (e: React.MouseEvent, c: Category) => { if ((e.target as HTMLElement).closest('a,button')) return; openEdit(c); };

  return (
    <div className={list.page}>
      <ModuleTabs moduleKey="blogs" />
      <section className={list.workspace} aria-labelledby="blog-categories-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="blog-categories-heading">Blog categories <span className={list.count}>{items ? all.length : '…'}</span></h2>
            <p>How posts are grouped on the blog. A category can sit under another; hidden ones keep their posts but leave the menu.</p>
          </div>
          <div className={list.headerActions}><AdminButton color="primary" onPress={() => setEditor({ draft: empty })}><IconPlus /> Add category</AdminButton></div>
        </div>
        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch /><span className="sr-only">Search categories</span>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or slug" />
              {search && <button type="button" className={list.clearSearch} onClick={() => setSearch('')} aria-label="Clear search"><IconClose /></button>}
            </label>
          </div>
          <div className={list.results}>{items && <span>{filtered.length ? `${filtered.length} ${filtered.length === 1 ? 'category' : 'categories'}` : 'No results'}</span>}</div>
        </div>

        {error && !items ? (
          <div className={list.state} role="alert"><span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span><h3>Couldn’t load categories</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button></div>
        ) : !items ? (
          <div className={list.skeleton} role="status" aria-label="Loading categories"><span /><span /><span /></div>
        ) : filtered.length === 0 ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconFolder /></span>
            <h3>{search.trim() ? `No categories match “${search.trim()}”` : 'No categories yet'}</h3>
            <p>{search.trim() ? 'Try a different name or slug.' : 'Add the first category so posts can be grouped.'}</p>
            {search.trim() ? <button type="button" className={list.stateLink} onClick={() => setSearch('')}>Clear search</button> : <button type="button" className={list.stateAction} onClick={() => setEditor({ draft: empty })}>Add category</button>}
          </div>
        ) : (
          <>
            <div className={list.tableWrap}>
              <table className={list.table}>
                <caption className="sr-only">Blog categories</caption>
                <thead><tr><th scope="col">Category</th><th scope="col">Description</th><th scope="col">Posts</th><th scope="col">Order</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c._id} onClick={(e) => onRowClick(e, c)}>
                      <td><span className={list.primary}>{typeof c.parent === 'object' && c.parent?.name ? <span className="text-[#8a939b] font-normal">{c.parent.name} / </span> : null}{c.name}</span><span className={list.sub}>/blog/category/{c.slug}</span></td>
                      <td>{c.description ? <span className={list.reason}>{c.description}</span> : <span className="text-[#8a939b]">—</span>}</td>
                      <td className={c.postCount ? '' : 'text-[#8a939b]'}>{c.postCount || 0}</td>
                      <td className="text-[#8a939b]">{c.order}</td>
                      <td><StatusChip label={c.isActive ? 'Active' : 'Hidden'} status={c.isActive ? 'active' : 'inactive'} /></td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <RowActions ariaLabel={`More actions for ${c.name}`} items={[{ key: 'delete', label: 'Delete category…', hint: c.postCount ? `${c.postCount} posts become uncategorised` : undefined, tone: 'danger', onSelect: () => remove(c) }]} />
                          <button type="button" className={list.openLink} onClick={() => openEdit(c)} aria-label={`Edit ${c.name}`} title="Edit"><IconArrow /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={list.cards}>
              {filtered.map((c) => (
                <button key={c._id} type="button" className={`${list.card} w-full text-left`} onClick={() => openEdit(c)}>
                  <div className={list.cardTop}>
                    <div className="min-w-0"><span className={list.primary}>{c.name}</span><span className={list.sub}>/{c.slug} · {c.postCount || 0} posts</span></div>
                    <StatusChip label={c.isActive ? 'Active' : 'Hidden'} status={c.isActive ? 'active' : 'inactive'} />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <Modal isOpen={!!editor} onClose={() => !saving && setEditor(null)} placement="center" size="lg" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
        <ModalContent>
          {editor && (
            <>
              <ModalHeader className={modal.header}>
                <span className={`${modal.icon} ${modal.info}`}><IconFolder /></span>
                <div className="min-w-0 flex-1">
                  <div className={modal.eyebrow}>{editor.id ? 'Edit category' : 'New category'}</div>
                  <div className={modal.title}>{editor.id ? editor.draft.name || 'Category' : 'Add a blog category'}</div>
                  <div className={modal.sub}>{editor.id ? 'Changing the slug changes the category’s address.' : 'The slug is made from the name unless you set one.'}</div>
                </div>
                <button type="button" className={modal.close} onClick={() => setEditor(null)} disabled={saving} aria-label="Close"><IconClose /></button>
              </ModalHeader>
              <ModalBody className={modal.body}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <AdminInput label="Name" isRequired variant="bordered" value={editor.draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Reviews" autoFocus />
                  <AdminInput label="Slug" variant="bordered" value={editor.draft.slug} onChange={(e) => set({ slug: e.target.value })} placeholder="made from the name" description="/blog/category/<slug>" />
                  <div className="sm:col-span-2">
                    <label className={form.label} htmlFor="blog-cat-parent">Parent category</label>
                    <AdminSelect id="blog-cat-parent" fullWidth ariaLabel="Parent category" value={editor.draft.parent} onChange={(v) => set({ parent: v })} options={[{ value: '', label: 'None — top level' }, ...all.filter((c) => c._id !== editor.id).map((c) => ({ value: c._id, label: c.name }))]} />
                    {editor.draft.parent && <p className={form.help}>Shown under {nameOf(editor.draft.parent)}.</p>}
                  </div>
                  <div className="sm:col-span-2"><AdminTextarea label="Description" variant="bordered" minRows={2} maxRows={4} value={editor.draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Optional — shown on the category page" /></div>
                  <AdminInput label="Order" type="number" variant="bordered" value={editor.draft.order} onChange={(e) => set({ order: e.target.value })} description="Lower numbers show first." />
                  <div className={form.toggleRow} style={{ borderTop: 0, paddingTop: 22 }}><div><strong>Active</strong><span>Visible in the blog menu.</span></div><AdminSwitch isSelected={editor.draft.isActive} onValueChange={(v) => set({ isActive: v })} aria-label="Active" /></div>
                </div>
              </ModalBody>
              <ModalFooter className={modal.footer}>
                <AdminButton variant="bordered" onPress={() => setEditor(null)} isDisabled={saving}>Cancel</AdminButton>
                <AdminButton color="primary" onPress={save} isLoading={saving}>{editor.id ? 'Save changes' : 'Add category'}</AdminButton>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow() { return <svg {...svg} width="14" height="14"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconPlus() { return <svg {...svg} width="14" height="14"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconFolder() { return <svg {...svg}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>; }
