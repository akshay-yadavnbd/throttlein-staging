'use client';

/**
 * Blog authors, in the workspace list layout: count, search, "Add author"
 * in the header, and a table — avatar, name and role, bio, posts, status —
 * that turns into cards on narrow panels. Rows open the author editor;
 * Delete is in the row menu and spells out which posts lose their byline
 * (the roster is shared across both sites).
 *
 * Data: GET /admin/blog/authors, DELETE /admin/blog/authors/:id.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminButton from '@/components/AdminButton';
import ModuleTabs from '@/components/ModuleTabs';
import { RowActions, StatusChip } from '@/components/ui';
import { api, imageUrl, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { useActiveSite } from '@/lib/useActiveSite';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';

type Author = { _id: string; name: string; slug: string; role?: string; bio?: string; avatarUrl?: string; credentials?: string[]; isActive: boolean; postCount?: number; otherSitePostCount?: number };
const initials = (name: string) => (name || '?').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();

export default function BlogAuthorsPage() {
  const router = useRouter();
  const site = useActiveSite();
  const [items, setItems] = useState<Author[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');

  const load = () => api.get('/admin/blog/authors')
    .then((r) => { setItems(unwrap<{ items?: any[] }>(r).items || []); setError(null); })
    .catch((e) => setError(e?.response?.status >= 500 || !e?.response ? 'Authors are unavailable right now.' : 'Authors couldn’t be loaded.'));
  useEffect(() => { void load(); }, [site, attempt]);

  const all = useMemo(() => items || [], [items]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? all.filter((a) => a.name.toLowerCase().includes(q) || (a.role || '').toLowerCase().includes(q) || (a.bio || '').toLowerCase().includes(q)) : all;
  }, [all, search]);

  async function remove(a: Author) {
    const here = a.postCount || 0, elsewhere = a.otherSitePostCount || 0;
    const parts = [here && `${here} ${here === 1 ? 'post' : 'posts'} on this site`, elsewhere && `${elsewhere} on the other site`].filter(Boolean);
    const ok = await confirmDialog({
      title: `Delete ${a.name}?`,
      message: parts.length ? `${parts.join(' and ')} will fall back to the default “Throttlein Team” byline.${elsewhere ? ' Authors are shared across both sites.' : ''} This can’t be undone.` : 'This can’t be undone.',
      destructive: true, confirmLabel: 'Delete author',
    });
    if (!ok) return;
    try { await api.delete(`/admin/blog/authors/${a._id}`); notifySuccess(M.blogs.authorDeleted); setItems((prev) => (prev || []).filter((x) => x._id !== a._id)); }
    catch (e: any) { notifyError(e, M.blogs.couldntDelete); }
  }
  const onRowClick = (e: React.MouseEvent, a: Author) => { if ((e.target as HTMLElement).closest('a,button')) return; router.push(`/blogs/authors/${a._id}`); };

  return (
    <div className={list.page}>
      <ModuleTabs moduleKey="blogs" />
      <section className={list.workspace} aria-labelledby="authors-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="authors-heading">Authors <span className={list.count}>{items ? all.length : '…'}</span></h2>
            <p>The bylines available on posts, with the bio and credentials shown at the end of each article. Authors are shared by both sites.</p>
          </div>
          <div className={list.headerActions}><AdminButton color="primary" onPress={() => router.push('/blogs/authors/new')}><IconPlus /> Add author</AdminButton></div>
        </div>
        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch /><span className="sr-only">Search authors</span>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, role or bio" />
              {search && <button type="button" className={list.clearSearch} onClick={() => setSearch('')} aria-label="Clear search"><IconClose /></button>}
            </label>
          </div>
          <div className={list.results}>{items && <span>{filtered.length ? `${filtered.length} ${filtered.length === 1 ? 'author' : 'authors'}` : 'No results'}</span>}</div>
        </div>

        {error && !items ? (
          <div className={list.state} role="alert"><span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span><h3>Couldn’t load authors</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button></div>
        ) : !items ? (
          <div className={list.skeleton} role="status" aria-label="Loading authors"><span /><span /><span /></div>
        ) : filtered.length === 0 ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconPeople /></span>
            <h3>{search.trim() ? `No authors match “${search.trim()}”` : 'No authors yet'}</h3>
            <p>{search.trim() ? 'Try a different name or role.' : 'Add at least one author before publishing — they appear in the byline and the author card.'}</p>
            {search.trim() ? <button type="button" className={list.stateLink} onClick={() => setSearch('')}>Clear search</button> : <Link className={list.stateAction} href="/blogs/authors/new">Add author</Link>}
          </div>
        ) : (
          <>
            <div className={list.tableWrap}>
              <table className={list.table}>
                <caption className="sr-only">Blog authors</caption>
                <thead><tr><th scope="col">Author</th><th scope="col">Bio</th><th scope="col">Posts</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a._id} onClick={(e) => onRowClick(e, a)}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar a={a} />
                          <div className="min-w-0"><Link className={list.primary} href={`/blogs/authors/${a._id}`}>{a.name}</Link><span className={list.sub}>{a.role || `/${a.slug}`}</span></div>
                        </div>
                      </td>
                      <td>{a.bio ? <span className={list.reason}>{a.bio}</span> : <span className="text-[#8a939b]">No bio</span>}{a.credentials?.length ? <div className={list.chips} style={{ marginTop: 6 }}>{a.credentials.slice(0, 3).map((c, i) => <span key={i} className={list.chip}>{c}</span>)}{a.credentials.length > 3 && <span className={list.more}>+{a.credentials.length - 3}</span>}</div> : null}</td>
                      <td className={a.postCount ? '' : 'text-[#8a939b]'}>{a.postCount || 0}{a.otherSitePostCount ? <span className={list.sub}>+{a.otherSitePostCount} on the other site</span> : null}</td>
                      <td><StatusChip label={a.isActive ? 'Active' : 'Hidden'} status={a.isActive ? 'active' : 'inactive'} /></td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <RowActions ariaLabel={`More actions for ${a.name}`} items={[{ key: 'delete', label: 'Delete author…', hint: a.postCount ? `${a.postCount} posts lose the byline` : undefined, tone: 'danger', onSelect: () => remove(a) }]} />
                          <Link className={list.openLink} href={`/blogs/authors/${a._id}`} aria-label={`Edit ${a.name}`} title="Edit author"><IconArrow /></Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={list.cards}>
              {filtered.map((a) => (
                <Link key={a._id} className={list.card} href={`/blogs/authors/${a._id}`}>
                  <div className={list.cardTop}>
                    <div className="flex items-center gap-3 min-w-0"><Avatar a={a} /><div className="min-w-0"><span className={list.primary}>{a.name}</span><span className={list.sub}>{a.role || 'No role'} · {a.postCount || 0} posts</span></div></div>
                    <StatusChip label={a.isActive ? 'Active' : 'Hidden'} status={a.isActive ? 'active' : 'inactive'} />
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Avatar({ a }: { a: Author }) {
  return a.avatarUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img alt="" className="h-9 w-9 flex-none rounded-full border border-[#edf0f2] object-cover" src={imageUrl(a.avatarUrl)} />
    : <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[#191d21] text-[11px] font-semibold text-[#bdff00]">{initials(a.name)}</span>;
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow() { return <svg {...svg} width="14" height="14"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconPlus() { return <svg {...svg} width="14" height="14"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconPeople() { return <svg {...svg}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>; }
