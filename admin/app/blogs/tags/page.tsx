'use client';

/**
 * Blog tags, in the workspace layout: count, search, an inline "add a tag"
 * box in the toolbar, and the tags as chips with their post counts and a
 * remove control. Data: GET/POST /admin/blog/tags, DELETE /admin/blog/tags/:id.
 */
import { useEffect, useMemo, useState } from 'react';
import AdminButton from '@/components/AdminButton';
import ModuleTabs from '@/components/ModuleTabs';
import { api, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { useActiveSite } from '@/lib/useActiveSite';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';
import styles from '../blogs.module.css';

type Tag = { _id: string; name: string; slug: string; postCount?: number };

export default function BlogTagsPage() {
  const site = useActiveSite();
  const [items, setItems] = useState<Tag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);

  const load = () => api.get('/admin/blog/tags')
    .then((r) => { setItems(unwrap<{ items?: any[] }>(r).items || []); setError(null); })
    .catch((e) => setError(e?.response?.status >= 500 || !e?.response ? 'Tags are unavailable right now.' : 'Tags couldn’t be loaded.'));
  useEffect(() => { void load(); }, [site, attempt]);

  const all = useMemo(() => items || [], [items]);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return q ? all.filter((t) => t.name.toLowerCase().includes(q)) : all; }, [all, search]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try { await api.post('/admin/blog/tags', { name: name.trim() }); notifySuccess(M.blogs.tagAdded); setName(''); await load(); }
    catch (err: any) { notifyError(err, M.blogs.couldntAdd); }
    finally { setAdding(false); }
  }
  async function remove(t: Tag) {
    const n = t.postCount || 0;
    const ok = await confirmDialog({ title: `Delete the tag “${t.name}”?`, message: n ? `It comes off ${n} ${n === 1 ? 'post' : 'posts'}. This can’t be undone.` : 'This can’t be undone.', destructive: true, confirmLabel: 'Delete tag' });
    if (!ok) return;
    try { await api.delete(`/admin/blog/tags/${t._id}`); notifySuccess(M.blogs.tagDeleted); await load(); }
    catch (err: any) { notifyError(err, M.blogs.couldntDelete); }
  }

  return (
    <div className={list.page}>
      <ModuleTabs moduleKey="blogs" />
      <section className={list.workspace} aria-labelledby="tags-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="tags-heading">Tags <span className={list.count}>{items ? all.length : '…'}</span></h2>
            <p>Free-form labels on posts, for related-article links and tag pages. Adding a name that already exists merges into it.</p>
          </div>
          <form className={list.headerActions} onSubmit={add}>
            <label className={list.search} style={{ width: 240 }}>
              <IconTag /><span className="sr-only">New tag name</span>
              <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="New tag, e.g. winter-gear" />
            </label>
            <AdminButton color="primary" type="submit" isLoading={adding} isDisabled={!name.trim()}><IconPlus /> Add tag</AdminButton>
          </form>
        </div>
        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch /><span className="sr-only">Search tags</span>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tags" />
              {search && <button type="button" className={list.clearSearch} onClick={() => setSearch('')} aria-label="Clear search"><IconClose /></button>}
            </label>
          </div>
          <div className={list.results}>{items && <span>{filtered.length ? `${filtered.length} ${filtered.length === 1 ? 'tag' : 'tags'}` : 'No results'}</span>}</div>
        </div>

        {error && !items ? (
          <div className={list.state} role="alert"><span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span><h3>Couldn’t load tags</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button></div>
        ) : !items ? (
          <div className={list.skeleton} role="status" aria-label="Loading tags"><span /><span /></div>
        ) : filtered.length === 0 ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconTag /></span>
            <h3>{search.trim() ? `No tags match “${search.trim()}”` : 'No tags yet'}</h3>
            <p>{search.trim() ? 'Try a different name.' : 'Add a tag above, or add them while writing a post.'}</p>
            {search.trim() && <button type="button" className={list.stateLink} onClick={() => setSearch('')}>Clear search</button>}
          </div>
        ) : (
          <div className={styles.tagCloud}>
            {filtered.map((t) => (
              <span key={t._id} className={styles.tag}>
                <span className={styles.tagName}>{t.name}</span>
                <span className={styles.tagCount} title={`${t.postCount || 0} posts`}>{t.postCount || 0}</span>
                <button type="button" className={styles.tagRemove} onClick={() => remove(t)} aria-label={`Delete tag ${t.name}`} title="Delete tag"><IconClose /></button>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconPlus() { return <svg {...svg} width="14" height="14"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconTag() { return <svg {...svg}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>; }
