'use client';

/**
 * Blog author editor (/blogs/authors/new and /blogs/authors/[id]):
 * identity header with the avatar, one panel of sections (identity,
 * credentials, visibility) and a sticky rail holding the live byline
 * preview — it updates as the admin types, mirroring the author card on
 * the storefront article page — plus Save / Cancel.
 *
 * Data unchanged: POST /admin/blog/authors, PUT /admin/blog/authors/:id,
 * avatar upload via ImageSlot → /admin/blog/upload-image.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import ImageSlot from '@/components/media/ImageSlot';
import { StatusChip } from '@/components/ui';
import { EditorHeader, Field, Counter, IconClose, IconUser } from '@/components/EditorShell';
import { api, imageUrl } from '@/lib/api';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';
import shared from '@/app/sellers/[slug]/detail.module.css';

type Initial = {
  _id?: string;
  name?: string;
  slug?: string;
  role?: string;
  bio?: string;
  avatarUrl?: string;
  credentials?: string[];
  isActive?: boolean;
  order?: number;
};

const BIO_MAX = 1200;
const CREDENTIAL_MAX = 8;

export default function BlogAuthorForm({
  mode,
  id,
  initial = {},
}: {
  mode: 'create' | 'edit';
  id?: string;
  initial?: Initial;
}) {
  const router = useRouter();

  const [name, setName] = useState(initial.name || '');
  const [slug, setSlug] = useState(initial.slug || '');
  const [role, setRole] = useState(initial.role || '');
  const [bio, setBio] = useState(initial.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl || '');
  const [credentials, setCredentials] = useState<string[]>(initial.credentials || []);
  const [credInput, setCredInput] = useState('');
  const [isActive, setIsActive] = useState(initial.isActive !== false);
  const [order, setOrder] = useState(String(initial.order ?? 0));
  const [saving, setSaving] = useState(false);

  // Auto-slug suggestion — only the placeholder, so the admin can override.
  const slugPlaceholder = useMemo(() => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return base || 'made-from-the-name';
  }, [name]);

  function addCredential() {
    const trimmed = credInput.trim();
    if (!trimmed) return;
    if (credentials.length >= CREDENTIAL_MAX) {
      notifyWarning(M.blogAuthorForm.credentialsCap(CREDENTIAL_MAX));
      return;
    }
    if (credentials.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setCredInput('');
      return;
    }
    setCredentials([...credentials, trimmed]);
    setCredInput('');
  }

  function removeCredential(i: number) {
    setCredentials(credentials.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      notifyWarning(M.blogAuthorForm.nameIsRequired);
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        name: name.trim(),
        role: role.trim(),
        bio: bio.trim(),
        avatarUrl,
        credentials,
        isActive,
        order: Number(order) || 0,
      };
      if (slug.trim()) payload.slug = slug.trim();
      if (mode === 'create') {
        await api.post('/admin/blog/authors', payload);
        notifySuccess(M.blogAuthorForm.authorCreated);
      } else {
        await api.put(`/admin/blog/authors/${id}`, payload);
        notifySuccess(M.blogAuthorForm.authorUpdated);
      }
      router.replace('/blogs/authors');
    } catch (err: any) {
      notifyError(err, M.blogAuthorForm.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  const initial1 = name.trim() ? name.trim()[0].toUpperCase() : null;

  return (
    <form onSubmit={submit}>
      <EditorHeader
        image={avatarUrl ? imageUrl(avatarUrl) : undefined}
        icon={initial1 || <IconUser />}
        title={<>{name || (mode === 'create' ? 'New author' : 'Unnamed author')}<StatusChip label={isActive ? 'Active' : 'Hidden'} status={isActive ? 'active' : 'inactive'} /></>}
        meta={[role || null, <>/blog/author/{slug || (name ? slugPlaceholder : '…')}</>]}
      />

      <div className={form.layout}>
        <section className={form.panel}>
          <div className={form.grid}>
            <div className={form.section}><h3>Identity</h3><p>The byline on every article this author writes.</p></div>
            <AdminInput label="Name" isRequired value={name} onChange={(e) => setName(e.target.value)} autoFocus={mode === 'create'} />
            <AdminInput label="Slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={slugPlaceholder} description="Lowercase letters, numbers and hyphens. Blank makes one from the name." />
            <div className={form.full}><AdminInput label="Role or title" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Gear editor" description="Shown under the name." /></div>
            <div className={form.full}>
              <AdminTextarea label="Bio" value={bio} onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))} minRows={3} maxRows={6} />
              <Counter value={bio} max={BIO_MAX} hint="A few sentences on who they are and why readers should trust them." />
            </div>
            <div className={`${form.full} ${form.upload}`}>
              <Field label="Avatar" hint="Square works best. Leave empty to show initials.">
                <ImageSlot label="" aspect="aspect-square" className="w-[140px]" hint="No photo" value={avatarUrl} onChange={setAvatarUrl} uploadEndpoint="/admin/blog/upload-image" proxyUrl />
              </Field>
            </div>

            <div className={`${form.section} ${form.sectionRow}`}>
              <div><h3>Credentials</h3><p>Short badges on the author card — qualifications, years of riding, certifications. Press Enter to add one.</p></div>
              <span className={form.pill}>{credentials.length} / {CREDENTIAL_MAX}</span>
            </div>
            <div className={form.full}>
              <div className={form.chips}>
                {credentials.length === 0 && <span className={form.railHint}>No credentials yet.</span>}
                {credentials.map((c, i) => (
                  <span key={`${c}-${i}`} className={form.chip}>
                    {c}
                    <button type="button" className={form.chipRemove} onClick={() => removeCredential(i)} aria-label={`Remove ${c}`}><IconClose /></button>
                  </span>
                ))}
              </div>
            </div>
            <div className={`${form.full} ${form.chipInput}`}>
              <AdminInput
                aria-label="New credential"
                value={credInput}
                onChange={(e) => setCredInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCredential(); } }}
                placeholder="e.g. 12 years touring on two wheels"
                isDisabled={credentials.length >= CREDENTIAL_MAX}
              />
              <AdminButton variant="bordered" onPress={addCredential} isDisabled={credentials.length >= CREDENTIAL_MAX || !credInput.trim()}>Add</AdminButton>
            </div>
            {credentials.length >= CREDENTIAL_MAX && <p className={`${form.full} ${form.note}`}>That’s the most the card can show — remove one to add another.</p>}
          </div>
        </section>

        <aside className={form.rail} aria-label="Preview and actions">
          <div className={form.railGroup}>
            <div className={form.railTitle}>Byline preview</div>
            <div className={form.preview}>
              <div className="flex items-start gap-3">
                <span className={shared.avatar} style={{ width: 44, height: 44, fontSize: 14 }} aria-hidden>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {avatarUrl ? <img src={imageUrl(avatarUrl)} alt="" /> : initial1 || '?'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold leading-tight text-[#252c32]">{name || 'Author name'}</div>
                  <div className="mt-0.5 text-[11px] text-[#74808a]">{role || 'Role or title'}</div>
                  {bio && <p className="mt-2 line-clamp-4 text-[12px] leading-relaxed text-[#39434c]">{bio}</p>}
                  {credentials.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {credentials.slice(0, 4).map((c, i) => <span key={i} className={form.pill}>{c}</span>)}
                      {credentials.length > 4 && <span className={form.railHint}>+{credentials.length - 4}</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className={form.railGroup}>
            <div className={form.railTitle}>Visibility</div>
            <div className={form.toggleRow}><div><strong>Active</strong><span>Hidden authors keep their byline on existing posts but can’t be picked for new ones.</span></div><AdminSwitch isSelected={isActive} onValueChange={setIsActive} aria-label="Active" /></div>
            <AdminInput label="Display order" type="number" value={order} onChange={(e) => setOrder(e.target.value)} description="Lower shows first on the authors list." />
          </div>

          <div className={form.railActions}>
            <AdminButton color="primary" type="submit" isLoading={saving}>{mode === 'create' ? 'Create author' : 'Save changes'}</AdminButton>
            <AdminButton variant="bordered" as={Link} href="/blogs/authors" isDisabled={saving}>Cancel</AdminButton>
            {mode === 'edit' && initial.slug && slug && slug !== initial.slug && <p className={form.railNote}>Slug changed — the old author URL stops working once you save.</p>}
          </div>
        </aside>
      </div>
    </form>
  );
}
