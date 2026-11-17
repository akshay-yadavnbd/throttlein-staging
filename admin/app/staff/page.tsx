'use client';

/**
 * Staff — `/staff`, in the workspace list layout: one panel with
 * All / Active / Suspended tabs, search, a table (cards on narrow
 * panels) and the invite / edit form in the shared modal.
 *
 * Lists every internal user (role='staff'); the superadmin invites new
 * ones (they set their own password from the emailed link), edits names,
 * roles and module access, suspends, reactivates and deletes. Sellers and
 * customers don't appear here.
 *
 * Backend pairing:
 *   GET    /api/admin/staff
 *   POST   /api/admin/staff                 { name, email, permissions[] }
 *   POST   /api/admin/staff/:id/resend-invite
 *   PATCH  /api/admin/staff/:id             { name?, permissions?, status?, password? }
 *   DELETE /api/admin/staff/:id
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminShell from '@/components/AdminShell';
import { RowActions, StatusChip } from '@/components/ui';
import { IconClose, IconPlus, IconSearch, IconUser } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import {
  MODULES_BY_KEY,
  MODULE_BY_PERMISSION,
  STAFF_ASSIGNABLE_MODULES,
  ALL_PERMISSION_KEYS,
  permKeyFor,
} from '@/lib/modules';
import { SITES, SITES_BY_KEY } from '@/lib/site';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';
import form from '@/components/AdminForm.module.css';
import modal from '@/components/AdminModal.module.css';

type StaffUser = {
  _id: string;
  name: string;
  email: string;
  permissions: string[];
  status: 'approved' | 'suspended';
  createdAt: string;
};

/** Resolve a stored permission key into a human label via the modules
 *  registry. Site-scoped keys ('seller-pages') read as "Pages · Seller";
 *  unknown keys fall back to the raw key so leftovers stay visible. */
function labelFor(key: string): string {
  const scoped = MODULE_BY_PERMISSION[key];
  if (scoped) {
    return scoped.site === 'main'
      ? scoped.module.label
      : `${scoped.module.label} · ${SITES_BY_KEY[scoped.site].label}`;
  }
  return MODULES_BY_KEY[key]?.label || key;
}

/**
 * Two preset role flavours in the form:
 *  - `admin`: every assignable module on both properties — re-snapshotted
 *    at save time, so an Admin always has the current full set.
 *  - `editor`: an explicit subset ticked in the module grid.
 * The backend still stores a plain `permissions[]`; the preset is derived
 * on edit by checking whether the user holds every current key.
 */
type StaffRole = 'admin' | 'editor';

function deriveRoleFromPermissions(permissions: string[]): StaffRole {
  const all = ALL_PERMISSION_KEYS;
  if (all.length === 0) return 'editor';
  return all.every((k) => permissions.includes(k)) ? 'admin' : 'editor';
}

type FormState = {
  name: string;
  email: string;
  /** Edit only — the superadmin can force-reset a password. Invites don't
   *  collect one; the invitee sets it from the emailed link. */
  password: string;
  role: StaffRole;
  permissions: Set<string>;
};

const emptyForm: FormState = { name: '', email: '', password: '', role: 'editor', permissions: new Set() };
type Filter = 'all' | 'active' | 'suspended';

export default function StaffPage() {
  const [items, setItems] = useState<StaffUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  /* One modal for invite and edit: `user` is null while inviting. */
  const [editor, setEditor] = useState<{ user: StaffUser | null; draft: FormState } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/admin/staff')
    .then((r) => { setItems(unwrap<{ items: StaffUser[] }>(r).items || []); setError(null); })
    .catch((e) => setError(e?.response?.status >= 500 || !e?.response ? 'The staff list is unavailable right now.' : 'Staff couldn’t be loaded.'));
  useEffect(() => { void load(); }, [attempt]);

  const all = useMemo(() => items || [], [items]);
  const activeCount = all.filter((u) => u.status === 'approved').length;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((u) => (filter === 'all' || (filter === 'active') === (u.status === 'approved')) && (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)));
  }, [all, filter, search]);

  function openCreate() { setEditor({ user: null, draft: emptyForm }); }
  function openEdit(u: StaffUser) {
    setEditor({
      user: u,
      draft: {
        name: u.name,
        email: u.email,
        password: '',
        // Re-derived so the UI stays right when the registry has grown
        // since the last edit.
        role: deriveRoleFromPermissions(u.permissions || []),
        permissions: new Set(u.permissions || []),
      },
    });
  }
  const set = (patch: Partial<FormState>) => setEditor((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  function togglePerm(key: string) {
    setEditor((e) => {
      if (!e) return e;
      const next = new Set(e.draft.permissions);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...e, draft: { ...e.draft, permissions: next } };
    });
  }

  /** Admin preset → every key on both properties, re-snapshotted now. */
  function resolvedPermissions(d: FormState): string[] {
    return d.role === 'admin' ? ALL_PERMISSION_KEYS : Array.from(d.permissions);
  }

  async function save() {
    if (!editor) return;
    const d = editor.draft;
    if (!editor.user && (!d.name.trim() || !d.email.trim())) { notifyWarning(M.staff.nameAndEmailAreRequired); return; }
    if (editor.user && !d.name.trim()) { notifyWarning(M.staff.nameIsRequired); return; }
    setSaving(true);
    try {
      if (!editor.user) {
        // No password in the request — the backend emails a set-password
        // link valid for 7 days.
        await api.post('/admin/staff', { name: d.name.trim(), email: d.email.trim(), permissions: resolvedPermissions(d) });
        notifySuccess(M.staff.inviteSentTo(d.email.trim()));
      } else {
        await api.patch(`/admin/staff/${editor.user._id}`, {
          name: d.name.trim(),
          permissions: resolvedPermissions(d),
          // Only sent when the superadmin typed one; blank means "keep".
          ...(d.password ? { password: d.password } : {}),
        });
        notifySuccess(M.staff.staffUserUpdated);
      }
      setEditor(null);
      void load();
    } catch (e: any) {
      notifyError(e, editor.user ? M.staff.couldntUpdateStaffUser : M.staff.couldntCreateStaffUser);
    } finally {
      setSaving(false);
    }
  }

  async function resendInvite(u: StaffUser) {
    const ok = await confirmDialog({
      title: 'Resend the invite email?',
      message: `${u.name} (${u.email}) gets a fresh set-password link valid for 7 days. Any older link stops working immediately.`,
      confirmLabel: 'Send email',
    });
    if (!ok) return;
    try {
      await api.post(`/admin/staff/${u._id}/resend-invite`);
      notifySuccess(M.staff.inviteReSentTo(u.email));
    } catch (e: any) {
      notifyError(e, M.staff.couldntResendInvite);
    }
  }

  async function toggleStatus(u: StaffUser) {
    const next = u.status === 'approved' ? 'suspended' : 'approved';
    const suspending = next === 'suspended';
    const ok = await confirmDialog({
      title: suspending ? `Suspend ${u.name}?` : `Reactivate ${u.name}?`,
      message: suspending
        ? 'They are signed out immediately and can’t sign back in until you reactivate them. Their module access is kept.'
        : 'They get back the access they had and can sign in again on their next attempt.',
      confirmLabel: suspending ? 'Suspend' : 'Reactivate',
      destructive: suspending,
    });
    if (!ok) return;
    try {
      await api.patch(`/admin/staff/${u._id}`, { status: next });
      notifySuccess(M.staff.marked(next));
      void load();
    } catch (e: any) {
      notifyError(e, M.staff.thatDidntWork);
    }
  }

  async function removeStaff(u: StaffUser) {
    const ok = await confirmDialog({
      title: `Delete ${u.name}?`,
      message: `${u.email} loses access immediately and the account is removed. This can’t be undone — to bring them back you’d send a new invite.`,
      confirmLabel: 'Delete user',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/staff/${u._id}`);
      notifySuccess(M.staff.deleted(u.name));
      void load();
    } catch (e: any) {
      notifyError(e, M.staff.couldntDelete);
    }
  }

  const roleOf = (u: StaffUser) => (u.permissions.length === 0 ? 'No access yet' : deriveRoleFromPermissions(u.permissions) === 'admin' ? 'Admin' : 'Editor');
  const modulesOf = (u: StaffUser) => (deriveRoleFromPermissions(u.permissions) === 'admin' ? 'Every module' : u.permissions.map(labelFor).join(', '));
  const added = (u: StaffUser) => new Date(u.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const onRowClick = (e: React.MouseEvent, u: StaffUser) => { if ((e.target as HTMLElement).closest('a,button')) return; openEdit(u); };
  const rowActions = (u: StaffUser) => [
    { key: 'edit', label: 'Edit access', hint: 'Name, role and modules', onSelect: () => openEdit(u) },
    { key: 'invite', label: 'Resend invite email', hint: u.email, onSelect: () => resendInvite(u) },
    u.status === 'approved'
      ? { key: 'suspend', label: 'Suspend access…', hint: 'They can’t sign in until reactivated', tone: 'danger' as const, onSelect: () => toggleStatus(u) }
      : { key: 'reactivate', label: 'Reactivate access', onSelect: () => toggleStatus(u) },
    { key: 'delete', label: 'Delete user…', hint: 'Asks for confirmation', tone: 'danger' as const, onSelect: () => removeStaff(u) },
  ];

  const scopedModules = STAFF_ASSIGNABLE_MODULES.filter((m) => m.siteScoped);
  const plainModules = STAFF_ASSIGNABLE_MODULES.filter((m) => !m.siteScoped);

  return (
    <AdminShell>
      <div className={list.page}>
        <section className={list.workspace} aria-labelledby="staff-heading">
          <div className={list.listHeader}>
            <div>
              <h2 id="staff-heading">Staff <span className={list.count}>{items ? all.length : '…'}</span></h2>
              <p>Teammates who sign in to this panel. Each one sees only the modules you grant; an Admin sees everything on both properties.</p>
            </div>
            <div className={list.headerActions}><AdminButton color="primary" onPress={openCreate}><IconPlus /> Invite staff</AdminButton></div>
          </div>
          <div className={list.stageFilters} role="group" aria-label="Filter staff">
            {([['all', 'All', all.length], ['active', 'Active', activeCount], ['suspended', 'Suspended', all.length - activeCount]] as [Filter, string, number][]).map(([id, label, n]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span>{items ? n : '…'}</span></button>
            ))}
          </div>
          <div className={list.toolbar}>
            <div className={list.toolbarLeft}>
              <label className={list.search}>
                <IconSearch /><span className="sr-only">Search staff</span>
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" />
                {search && <button type="button" className={list.clearSearch} onClick={() => setSearch('')} aria-label="Clear search"><IconClose /></button>}
              </label>
            </div>
            <div className={list.results}>{items && <span>{filtered.length ? `${filtered.length} ${filtered.length === 1 ? 'person' : 'people'}` : 'No results'}</span>}</div>
          </div>

          {error && !items ? (
            <div className={list.state} role="alert"><span className={`${list.stateIcon} ${list.errorIcon}`}><IconUser /></span><h3>Couldn’t load staff</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button></div>
          ) : !items ? (
            <div className={list.skeleton} role="status" aria-label="Loading staff"><span /><span /><span /></div>
          ) : filtered.length === 0 ? (
            <div className={list.state}>
              <span className={list.stateIcon}><IconUser /></span>
              <h3>{search.trim() ? `No one matches “${search.trim()}”` : filter !== 'all' ? 'No one in this filter' : 'No staff yet'}</h3>
              <p>{search.trim() || filter !== 'all' ? 'Try another search or filter.' : 'Invite a teammate to share the admin work — they choose their own password from the email.'}</p>
              {search.trim() || filter !== 'all' ? <button type="button" className={list.stateLink} onClick={() => { setSearch(''); setFilter('all'); }}>Clear filters</button> : <button type="button" className={list.stateAction} onClick={openCreate}>Invite staff</button>}
            </div>
          ) : (
            <>
              <div className={list.tableWrap}>
                <table className={list.table}>
                  <caption className="sr-only">Staff</caption>
                  <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Added</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {filtered.map((u) => (
                      <tr key={u._id} onClick={(e) => onRowClick(e, u)}>
                        <td>
                          <div className="flex items-center gap-3">
                            <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[#191d21] text-[11px] font-semibold text-[#bdff00]">{initials(u.name)}</span>
                            <div className="min-w-0"><span className={list.primary}>{u.name}</span><span className={list.sub}>{u.email}</span></div>
                          </div>
                        </td>
                        <td><span className={list.primary} style={{ fontWeight: 500 }}>{roleOf(u)}</span>{u.permissions.length > 0 && <span className={list.sub} style={{ maxWidth: 320 }} title={modulesOf(u)}>{modulesOf(u)}</span>}</td>
                        <td><StatusChip label={u.status === 'approved' ? 'Active' : 'Suspended'} status={u.status === 'approved' ? 'active' : 'suspended'} /></td>
                        <td className="text-[#8a939b]">{added(u)}</td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            <RowActions ariaLabel={`More actions for ${u.name}`} items={rowActions(u)} />
                            <button type="button" className={list.openLink} onClick={() => openEdit(u)} aria-label={`Edit ${u.name}`} title="Edit access"><IconArrow /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={list.cards}>
                {filtered.map((u) => (
                  <button key={u._id} type="button" className={`${list.card} w-full text-left`} onClick={() => openEdit(u)}>
                    <div className={list.cardTop}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[#191d21] text-[11px] font-semibold text-[#bdff00]">{initials(u.name)}</span>
                        <div className="min-w-0"><span className={list.primary}>{u.name}</span><span className={list.sub}>{roleOf(u)} · {u.email}</span></div>
                      </div>
                      <StatusChip label={u.status === 'approved' ? 'Active' : 'Suspended'} status={u.status === 'approved' ? 'active' : 'suspended'} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <Modal isOpen={!!editor} onClose={() => !saving && setEditor(null)} placement="center" size="2xl" scrollBehavior="inside" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
          <ModalContent>
            {editor && (
              <>
                <ModalHeader className={modal.header}>
                  <span className={`${modal.icon} ${modal.info}`}><IconUser /></span>
                  <div className="min-w-0 flex-1">
                    <div className={modal.eyebrow}>{editor.user ? 'Edit access' : 'Invite staff'}</div>
                    <div className={modal.title}>{editor.user ? editor.user.name : 'Add a teammate'}</div>
                    <div className={modal.sub}>{editor.user ? editor.user.email : 'They get an email with a one-time link to choose their own password, valid for 7 days. Resend it from the list if it expires.'}</div>
                  </div>
                  <button type="button" className={modal.close} onClick={() => setEditor(null)} aria-label="Close" disabled={saving}><IconClose /></button>
                </ModalHeader>
                <ModalBody className={modal.body}>
                  <div className={form.grid} style={{ padding: 0 }}>
                    {/* autoComplete=off keeps the browser from pre-filling the
                        admin's own email and password into an invite. */}
                    <AdminInput label="Name" isRequired value={editor.draft.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" autoFocus />
                    {editor.user
                      ? <AdminInput label="Reset password" type="password" value={editor.draft.password} onChange={(e) => set({ password: e.target.value })} placeholder="Leave blank to keep it" autoComplete="new-password" description="Only if they’re locked out — otherwise leave blank." />
                      : <AdminInput label="Email" type="email" isRequired value={editor.draft.email} onChange={(e) => set({ email: e.target.value })} autoComplete="off" description="The invite goes here." />}

                    <div className={`${form.section} ${form.sectionRow}`}>
                      <div><h3>Access</h3><p>{editor.draft.role === 'admin' ? 'Every module on both properties, including ones added later.' : 'Only the ticked modules. Pages and Blogs are granted per property.'}</p></div>
                      <div className={form.segment} role="group" aria-label="Role">
                        <button type="button" aria-pressed={editor.draft.role === 'admin'} onClick={() => set({ role: 'admin' })}>Admin</button>
                        <button type="button" aria-pressed={editor.draft.role === 'editor'} onClick={() => set({ role: 'editor' })}>Editor</button>
                      </div>
                    </div>
                    {editor.draft.role === 'editor' && (
                      <div className={`${form.full} ${form.checkList}`} style={{ maxHeight: 'none' }}>
                        {/* Two columns keep the modal short enough to fit a laptop screen. */}
                        <div className="grid sm:grid-cols-2">
                          {plainModules.map((m) => (
                            <label key={m.key} className={form.checkRow}>
                              <input type="checkbox" checked={editor.draft.permissions.has(m.key)} onChange={() => togglePerm(m.key)} />
                              <span>{m.label}</span>
                            </label>
                          ))}
                        </div>
                        {scopedModules.map((m) => (
                          <div key={m.key} className={form.checkRow} style={{ cursor: 'default', gap: 16 }}>
                            <span style={{ minWidth: 72 }}>{m.label}</span>
                            {SITES.map((s) => {
                              const key = permKeyFor(m, s.key);
                              return (
                                <label key={key} className="inline-flex items-center gap-2 cursor-pointer">
                                  <input type="checkbox" checked={editor.draft.permissions.has(key)} onChange={() => togglePerm(key)} style={{ width: 15, height: 15, accentColor: '#191d21' }} />
                                  <span className="text-[#55616b]">{s.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                    {editor.draft.role === 'editor' && editor.draft.permissions.size === 0 && (
                      <p className={`${form.full} ${form.note}`}>Nothing ticked — they could sign in but see no modules.</p>
                    )}
                  </div>
                </ModalBody>
                <ModalFooter className={modal.footer}>
                  <AdminButton variant="bordered" onPress={() => setEditor(null)} isDisabled={saving}>Cancel</AdminButton>
                  <AdminButton color="primary" onPress={save} isLoading={saving}>{editor.user ? 'Save changes' : 'Send invite'}</AdminButton>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
      </div>
    </AdminShell>
  );
}

const initials = (name: string) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
function IconArrow() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
