'use client';

/**
 * Admin — seller detail, in the workspace detail layout (same family as the
 * order detail page): a compact identity header on every tab, then
 * Profile / KYC & payouts / Products as underlined section tabs.
 *
 * The default tab follows the work: a pending verification change request
 * or an unverified seller opens on KYC, a verified one on Products. Deep
 * links: `?tab=profile|kyc|products`.
 *
 * Behaviour unchanged: account actions (edit, approve, suspend, delete)
 * unlock only once KYC is approved and all confirm in one modal; KYC review
 * (including change requests via `kycRevision`) is KycReviewCard; products
 * are searched and paged client-side.
 *
 * Backend: GET/PATCH/DELETE /api/admin/sellers/:slug, PATCH …/status.
 */
import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import KycReviewCard, { type KycData } from '@/components/KycReviewCard';
/* Shared v3-based primitives (own files — this file stays a v2 module). */
import { FilterTabs, StatusChip } from '@/components/ui';
import { api, imageUrl, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { formatDate } from '@/lib/dates';
import list from '@/components/WorkspaceList.module.css';
import modal from '@/components/AdminModal.module.css';
import styles from './detail.module.css';
import { notifyError, notifySuccess, notifyWarning, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

type ActionKind = 'approve' | 'suspend' | 'delete';
type Tab = 'profile' | 'kyc' | 'products';

type Seller = {
  _id: string;
  slug?: string;
  name: string;
  email: string;
  storeName?: string;
  phone?: string;
  alternatePhone?: string;
  address?: string;
  status: 'pending' | 'approved' | 'suspended';
  createdAt: string;
  avatar?: string;
  emailVerified?: boolean;
  /** Server-computed stall stage (utils/sellerOnboarding.js); null = not stalled. */
  onboardingStage?: 'unverified' | 'kyc_rejected' | 'no_kyc' | null;
  onboardingReminder?: { lastSentAt?: string; count?: number };
  kyc?: KycData;
  kycRevision?: KycData;
};

type Product = {
  _id: string; name: string; price: number; mrp?: number; stock: number;
  status: 'draft' | 'active' | 'rejected' | 'out_of_stock'; isFeatured: boolean; images?: string[];
  category?: { _id: string; name: string } | string; brand?: { _id: string; name: string } | string | null; createdAt: string;
};

type Stats = { total: number; active: number; outOfStock: number; featured: number; orders: number; revenue: number };

const PAGE_SIZE = 15;
const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
const nameOf = (c: any): string => (!c ? '—' : typeof c === 'string' ? c : c.name);
const initials = (s: Seller) => (s.storeName || s.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

/**
 * One word for where the seller is (same track as the sellers list):
 * verify email → submit KYC → we approve → live. Replaces the separate
 * "Account …" and "KYC …" chips, which read as two problems for one state.
 * `step` = steps completed; `problem` marks the current step red.
 */
const STEP_NAMES = ['Email verified', 'KYC submitted', 'Live'];
type Stage = { label: string; status: string; step: 0 | 1 | 2 | 3; problem?: boolean };
function stageOf(s: Seller): Stage {
  if (s.status === 'suspended') return { label: 'Suspended', status: 'suspended', step: 3 };
  if (s.status === 'approved') return { label: 'Live', status: 'approved', step: 3 };
  const k = s.kyc?.status || 'not_started';
  if (k === 'pending') return { label: 'KYC waiting for you', status: 'pending', step: 2 };
  if (k === 'approved') return { label: 'Verified · not live', status: 'pending', step: 2 };
  if (k === 'rejected') return { label: 'KYC sent back', status: 'rejected', step: 1, problem: true };
  if (s.onboardingStage === 'unverified' || s.emailVerified === false) return { label: 'Email not verified', status: 'not_started', step: 0 };
  return { label: 'KYC not started', status: 'not_started', step: 1 };
}

export default function SellerDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [seller, setSeller] = useState<Seller | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  /* `null` until the admin picks a tab: the default follows the work. */
  const [tabChoice, setTabChoice] = useState<Tab | null>(null);
  const activeTab =
    tabChoice ?? (seller?.kycRevision?.status === 'pending' ? 'kyc' : seller?.kyc?.status === 'approved' ? 'products' : 'kyc');

  // Deep link: ?tab=profile|kyc|products (window.location avoids the Suspense
  // boundary Next requires around useSearchParams at build time).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t === 'profile' || t === 'kyc' || t === 'products') setTabChoice(t);
  }, []);

  const [confirmAction, setConfirmAction] = useState<ActionKind | null>(null);
  const [working, setWorking] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', storeName: '', phone: '', alternatePhone: '', email: '' });
  const [editSaving, setEditSaving] = useState(false);

  const apply = (data: any) => { setSeller(data.seller); setProducts(data.products || []); setStats(data.stats); setError(null); };
  const reload = () => api.get(`/admin/sellers/${slug}`).then((r) => apply(unwrap<any>(r))).catch(() => {});

  useEffect(() => {
    const controller = new AbortController();
    api.get(`/admin/sellers/${slug}`, { signal: controller.signal })
      .then((r) => apply(unwrap<any>(r)))
      .catch((e) => {
        if (controller.signal.aborted) return;
        const status = e?.response?.status;
        setError({ notFound: status === 404 || status === 400, message: apiMessage(e) || 'This seller couldn’t be loaded right now.' });
      });
    return () => controller.abort();
  }, [slug, attempt]);

  function openEdit() {
    if (!seller) return;
    setEditForm({ name: seller.name || '', storeName: seller.storeName || '', phone: seller.phone || '', alternatePhone: seller.alternatePhone || '', email: seller.email || '' });
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editForm.name.trim()) { notifyWarning(M.sellers.nameCantBeBlank); return; }
    if (!editForm.email.trim()) { notifyWarning(M.sellers.emailIsRequired); return; }
    setEditSaving(true);
    try {
      await api.patch(`/admin/sellers/${slug}`, editForm);
      notifySuccess(M.sellers.sellerDetailsUpdated);
      setEditOpen(false);
      await reload();
    } catch (e: any) {
      notifyError(e, M.sellers.couldntUpdate);
    } finally {
      setEditSaving(false);
    }
  }

  /** Runs approve / suspend / delete after the shared confirm modal. */
  async function runConfirmedAction() {
    if (!confirmAction) return;
    setWorking(true);
    try {
      if (confirmAction === 'approve') {
        await api.patch(`/admin/sellers/${slug}/status`, { status: 'approved' });
        notifySuccess(M.sellers.sellerActivatedEmailSent);
      } else if (confirmAction === 'suspend') {
        await api.patch(`/admin/sellers/${slug}/status`, { status: 'suspended' });
        notifySuccess(M.sellers.sellerSuspended);
      } else {
        await api.delete(`/admin/sellers/${slug}`);
        notifySuccess(M.sellers.sellerDeleted2);
        router.replace('/sellers');
        return;
      }
      setConfirmAction(null);
      await reload();
    } catch (e: any) {
      notifyError(e, M.sellers.thatDidntWorkTryAgain);
    } finally {
      setWorking(false);
    }
  }

  /** Onboarding reminder; `force` only after a 429 cooldown and an explicit confirm (as on the list). */
  const [reminding, setReminding] = useState(false);
  async function remind(force = false) {
    if (!seller) return;
    setReminding(true);
    try {
      await api.post(`/admin/sellers/${slug}/remind`, force ? { force: true } : {});
      notifySuccess(M.sellers.reminderSent(seller.email));
      await reload();
    } catch (e: any) {
      if (e?.response?.status === 429 && !force) {
        const message = apiMessage(e) || 'A reminder went out recently.';
        const again = await confirmDialog({ title: 'Send the reminder again?', message, confirmLabel: 'Send anyway' });
        if (again) { setReminding(false); return remind(true); }
      } else {
        notifyError(e, M.sellers.couldntSendTheReminder);
      }
    } finally {
      setReminding(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q) || nameOf(p.category).toLowerCase().includes(q) || nameOf(p.brand).toLowerCase().includes(q));
  }, [products, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (!seller) {
    return (
      <div className={styles.page}>
        <BackToSellers />
        {error ? (
          <section className={`${styles.panel} ${styles.state}`} role="alert">
            <h2>{error.notFound ? 'Seller not found' : 'Couldn’t load this seller'}</h2>
            <p>{error.notFound ? 'The link may be out of date, or the account was deleted.' : error.message}</p>
            {error.notFound
              ? <Link className={styles.darkAction} href="/sellers">Go to sellers</Link>
              : <button type="button" className={styles.darkAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button>}
          </section>
        ) : <DetailSkeleton />}
      </div>
    );
  }

  const kycApproved = seller.kyc?.status === 'approved';
  const kycStatus = seller.kyc?.status || 'not_started';
  const revisionPending = seller.kycRevision?.status === 'pending';
  const stage = stageOf(seller);
  const storeName = seller.storeName || seller.name;
  const firstName = seller.name.trim().split(/\s+/)[0] || 'The seller';
  /* Prefer the server's stall stage (the rule the remind endpoint enforces);
     derive it only for an older API that doesn't send the key. */
  const stalled = 'onboardingStage' in seller ? !!seller.onboardingStage : seller.status === 'pending' && stage.step < 2;
  const lastReminder = seller.onboardingReminder?.lastSentAt;
  const reminderNote = lastReminder
    ? `Last reminder ${formatDate(lastReminder)}${(seller.onboardingReminder?.count || 0) > 1 ? ` · ${seller.onboardingReminder!.count} sent` : ''}`
    : 'No reminder sent yet';
  const remindButton = stalled && (
    <AdminButton variant="bordered" onPress={() => remind()} isLoading={reminding} startContent={<IconSend />}>Send reminder</AdminButton>
  );
  /* The KYC tab's "nothing submitted" panel carries the reminder itself,
     so the header strip doesn't repeat it there. */
  const showKycEmpty = activeTab === 'kyc' && !revisionPending && kycStatus === 'not_started';
  const stripRemind = showKycEmpty ? {} : { note: reminderNote, action: remindButton };

  /* The one line under the header for anyone not yet live (or with a change
     request): who the next move belongs to, and the admin's one lever. */
  let journey: { text: string; note?: string; action?: React.ReactNode } | null = null;
  if (revisionPending) {
    journey = {
      text: `Change request submitted${seller.kycRevision?.submittedAt ? ` ${formatDate(seller.kycRevision.submittedAt)}` : ''}. The verified details stay in place until you decide.`,
      action: activeTab !== 'kyc' && <AdminButton color="primary" onPress={() => setTabChoice('kyc')}>Review changes</AdminButton>,
    };
  } else if (seller.status === 'pending') {
    if (kycStatus === 'pending') {
      journey = {
        text: `KYC submitted${seller.kyc?.submittedAt ? ` ${formatDate(seller.kyc.submittedAt)}` : ''} and waiting for your review. Approving puts the store live.`,
        action: activeTab !== 'kyc' && <AdminButton color="primary" onPress={() => setTabChoice('kyc')}>Review KYC</AdminButton>,
      };
    } else if (kycStatus === 'approved') {
      journey = {
        text: 'KYC is verified but the store isn’t live yet. Activate it from the account actions.',
        action: activeTab !== 'profile' && <AdminButton variant="bordered" onPress={() => setTabChoice('profile')}>Account actions</AdminButton>,
      };
    } else if (kycStatus === 'rejected') {
      journey = {
        text: `KYC sent back${seller.kyc?.reviewedAt ? ` on ${formatDate(seller.kyc.reviewedAt)}` : ''}. Waiting for ${firstName} to fix it and resubmit.`,
        ...stripRemind,
      };
    } else if (stage.step === 0) {
      journey = { text: `Waiting for ${firstName} to verify ${seller.email}. They can’t sign in until they do.`, ...stripRemind };
    } else {
      journey = { text: `Waiting for ${firstName} to submit KYC. There’s nothing to review yet.`, ...stripRemind };
    }
  }

  return (
    <div className={styles.page}>
      <BackToSellers />

      {/* ── Identity, on every tab ── */}
      <section className={`${styles.panel} ${styles.summary}`} aria-labelledby="seller-heading">
        <span className={styles.avatar} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {seller.avatar ? <img src={imageUrl(seller.avatar)} alt="" /> : initials(seller)}
        </span>
        <div className={styles.who}>
          <h1 id="seller-heading">
            {storeName}
            <StatusChip label={stage.label} status={stage.status} />
            {revisionPending && <StatusChip label="Change request" status="pending" />}
          </h1>
          <div className={styles.meta}>
            <span>Owner · {seller.name}</span>
            <span>{seller.email}</span>
            <span>Joined {formatDate(seller.createdAt)}</span>
          </div>
        </div>
        <a className={styles.storeLink} href={`mailto:${seller.email}?subject=${encodeURIComponent('THROTTLEIN seller account')}`}>
          <IconMail /> Email seller
        </a>

        {journey && (
          <div className={styles.journey}>
            {seller.status === 'pending' && (
              <ol className={styles.steps} aria-label="Onboarding progress">
                {STEP_NAMES.map((name, i) => (
                  <li
                    key={name}
                    aria-current={i === stage.step ? 'step' : undefined}
                    className={i < stage.step ? styles.stepDone : i === stage.step ? `${styles.stepCurrent} ${stage.problem ? styles.stepProblem : ''}` : ''}
                  >
                    <span className={styles.stepDot}>{i < stage.step && <IconCheck />}</span>
                    {name}
                  </li>
                ))}
              </ol>
            )}
            <p className={styles.next}>
              {journey.text}
              {journey.note && <small>{journey.note}</small>}
            </p>
            {journey.action}
          </div>
        )}
      </section>

      <FilterTabs
        ariaLabel="Seller sections"
        className={styles.tabs}
        onChange={(id) => setTabChoice(id as Tab)}
        tabs={[
          { id: 'profile', label: 'Profile' },
          // "(review)" only when the next move is ours; a seller who hasn't
          // submitted yet isn't an admin action.
          { id: 'kyc', label: seller.kycRevision?.status === 'pending' ? 'Verification changes (review)' : seller.kyc?.status === 'pending' ? 'KYC & payouts (review)' : 'KYC & payouts' },
          { id: 'products', label: 'Products', count: products.length },
        ]}
        value={activeTab}
      />

      {activeTab === 'profile' ? (
        <>
          <div className={styles.grid}>
            <section className={`${styles.panel} ${styles.card}`} aria-labelledby="contact-heading">
              <h2 id="contact-heading" className={styles.cardTitle}>Contact &amp; account</h2>
              <dl className={styles.fields}>
                <Field label="Owner" value={seller.name} />
                <Field label="Store name" value={seller.storeName || '—'} />
                <Field label="Email" value={seller.email} copy wide />
                <Field label="Phone" value={seller.phone || '—'} copy={!!seller.phone} />
                <Field label="Alternate phone" value={seller.alternatePhone || '—'} copy={!!seller.alternatePhone} />
                <Field label="Joined" value={new Date(seller.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })} />
              </dl>
            </section>

            <section className={`${styles.panel} ${styles.card}`} aria-labelledby="actions-heading">
              <h2 id="actions-heading" className={styles.cardTitle}>Account actions</h2>
              {/* Actions stay hidden (not disabled) until KYC is approved —
                  a row of grey CTAs read as broken UI. Address isn't shown:
                  the structured pickup address on the KYC tab is the source of truth. */}
              {!kycApproved ? (
                <div className={styles.locked}>
                  <IconLock />
                  <span>
                    Edit, approve and delete unlock once the KYC submission is approved.{' '}
                    <button type="button" className="font-semibold text-[#39434c] underline underline-offset-2" onClick={() => setTabChoice('kyc')}>{kycStatus === 'pending' ? 'Review KYC' : 'See KYC status'}</button>
                  </span>
                </div>
              ) : (
                <div className={styles.actionList}>
                  <div className={styles.actionRow}>
                    <div><strong>Edit details</strong><span>Name, store name, phones and login email.</span></div>
                    <AdminButton variant="bordered" onPress={openEdit}>Edit</AdminButton>
                  </div>
                  {seller.status !== 'approved' ? (
                    <div className={styles.actionRow}>
                      <div><strong>Activate store</strong><span>Puts their products live and emails them.</span></div>
                      <AdminButton color="primary" onPress={() => setConfirmAction('approve')}>Approve</AdminButton>
                    </div>
                  ) : (
                    <div className={styles.actionRow}>
                      <div><strong>Suspend store</strong><span>Hides their products; reversible any time.</span></div>
                      <AdminButton variant="bordered" className="!text-[#8a5a12]" onPress={() => setConfirmAction('suspend')}>Suspend</AdminButton>
                    </div>
                  )}
                  <div className={styles.actionRow}>
                    <div><strong>Delete seller</strong><span>Permanent. Order history is kept.</span></div>
                    <AdminButton variant="bordered" className="!border-[#f0c9c6] !text-[#b44848]" onPress={() => setConfirmAction('delete')}>Delete…</AdminButton>
                  </div>
                </div>
              )}
            </section>
          </div>

          <section className={styles.panel} aria-labelledby="business-heading">
            <h2 id="business-heading" className={styles.metricsTitle}>Business overview <span className="font-normal text-[#8a939b]">· all time</span></h2>
            <dl className={styles.metrics}>
              {[
                { label: 'Products', value: inr(stats?.total ?? 0) },
                { label: 'Active', value: inr(stats?.active ?? 0) },
                { label: 'Out of stock', value: inr(stats?.outOfStock ?? 0), warn: (stats?.outOfStock ?? 0) > 0 },
                { label: 'Featured', value: inr(stats?.featured ?? 0) },
                { label: 'Orders', value: inr(stats?.orders ?? 0) },
                { label: 'Revenue', value: `₹${inr(stats?.revenue ?? 0)}` },
              ].map((s) => (
                <div key={s.label} className={styles.metric}>
                  <dt>{s.label}</dt>
                  <dd className={s.warn ? styles.warn : ''}>{s.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      ) : showKycEmpty ? (
        /* Nothing to review: say what the seller still owes and offer the
           one lever we have, instead of an empty review card. */
        <section className={`${styles.panel} ${styles.kycEmpty}`} aria-labelledby="kyc-empty-heading">
          <div className={styles.kycEmptyHead}>
            <span className={styles.kycEmptyIcon}><IconShield /></span>
            <div>
              <h2 id="kyc-empty-heading">No KYC submitted yet</h2>
              <p>
                {stage.step === 0
                  ? `${firstName} hasn’t verified their email, so they can’t sign in to submit KYC yet. Once they do, they’ll need to send:`
                  : `${storeName} needs to send these before you can verify them and put the store live:`}
              </p>
            </div>
          </div>
          <ul className={styles.needs}>
            <li><span><IconDoc /></span><div><strong>Tax identity</strong><small>GSTIN and PAN, with the GST certificate and PAN card</small></div></li>
            <li><span><IconBank /></span><div><strong>Bank account</strong><small>For payouts — account details and a cancelled cheque</small></div></li>
            <li><span><IconPin /></span><div><strong>Pickup address</strong><small>Where couriers collect orders, with a contact phone</small></div></li>
          </ul>
          <div className={styles.kycEmptyFoot}>
            <span>{reminderNote}</span>
            {remindButton}
          </div>
        </section>
      ) : activeTab === 'kyc' ? (
        <KycReviewCard
          sellerId={seller._id}
          sellerName={seller.storeName || seller.name}
          kyc={seller.kycRevision?.status === 'pending' ? { ...seller.kycRevision, isRevision: true } : seller.kyc}
          onChange={reload}
        />
      ) : (
        <section className={list.workspace} aria-labelledby="products-heading">
          <div className={list.listHeader}>
            <div>
              <h2 id="products-heading">Products <span className={list.count}>{products.length}</span></h2>
              <p>Everything this seller has listed, including drafts.</p>
            </div>
          </div>
          <div className={list.toolbar}>
            <div className={list.toolbarLeft}>
              <label className={list.search}>
                <IconSearch />
                <span className="sr-only">Search this seller’s products</span>
                <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, brand or category" />
                {search && <button type="button" className={list.clearSearch} onClick={() => { setSearch(''); setPage(1); }} aria-label="Clear search"><IconClose /></button>}
              </label>
            </div>
            <div className={list.results}>{filtered.length ? `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}` : 'No results'}</div>
          </div>
          {filtered.length === 0 ? (
            <div className={list.state}>
              <span className={list.stateIcon}><IconBox /></span>
              <h3>{search.trim() ? `No products match “${search.trim()}”` : 'No products yet'}</h3>
              <p>{search.trim() ? 'Try a different name, brand or category.' : 'Products appear here as the seller lists them.'}</p>
            </div>
          ) : (
            <>
              <div className={list.tableWrap}>
                <table className={list.table}>
                  <caption className="sr-only">Products listed by {seller.storeName || seller.name}</caption>
                  <thead>
                    <tr><th scope="col">Product</th><th scope="col">Category</th><th scope="col">Brand</th><th scope="col">Status</th><th scope="col" className={list.money}>Stock</th><th scope="col" className={list.money}>Price</th></tr>
                  </thead>
                  <tbody>
                    {paginated.map((p) => (
                      <tr key={p._id} style={{ cursor: 'default' }}>
                        <td>
                          <div className={styles.productCell}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {p.images?.[0] ? <img className={styles.thumb} src={imageUrl(p.images[0])} alt="" /> : <span className={styles.thumb} aria-hidden />}
                            <span className={list.primary}>{p.name}</span>
                          </div>
                        </td>
                        <td>{nameOf(p.category)}</td>
                        <td>{nameOf(p.brand)}</td>
                        <td><span className="inline-flex items-center gap-1.5"><StatusChip status={p.status} />{p.isFeatured && <span className={styles.featured} title="Featured product">★ Featured</span>}</span></td>
                        <td className={`${list.money} ${p.stock === 0 ? styles.outOfStock : ''}`}>{p.stock}</td>
                        <td className={list.money}><strong>₹{inr(p.price)}</strong>{p.mrp && p.mrp > p.price ? <span className={list.sub}><s>₹{inr(p.mrp)}</s></span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={list.cards}>
                {paginated.map((p) => (
                  <div key={p._id} className={list.card}>
                    <div className={styles.productCell}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.images?.[0] ? <img className={styles.thumb} src={imageUrl(p.images[0])} alt="" /> : <span className={styles.thumb} aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <span className={list.primary}>{p.name}</span>
                        <span className={list.sub}>{nameOf(p.category)} · ₹{inr(p.price)} · <span className={p.stock === 0 ? styles.outOfStock : ''}>{p.stock} in stock</span></span>
                        {p.isFeatured && <span className={`${styles.featured} mt-1.5`}>★ Featured</span>}
                      </div>
                      <StatusChip status={p.status} />
                    </div>
                  </div>
                ))}
              </div>
              {totalPages > 1 && (
                <div className={list.footer}>
                  <span>Page {safePage} of {totalPages}</span>
                  <div className={list.pager}>
                    <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}><IconArrow flip /> Previous</button>
                    <button type="button" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next <IconArrow /></button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <SellerActionModal action={confirmAction} sellerName={seller.storeName || seller.name} working={working} onClose={() => !working && setConfirmAction(null)} onConfirm={runConfirmedAction} />

      {/* Edit seller details — name / store / phone / email */}
      <Modal
        isOpen={editOpen}
        onClose={() => !editSaving && setEditOpen(false)}
        placement="center"
        size="lg"
        hideCloseButton
        classNames={{ base: modal.modal, backdrop: modal.backdrop }}
      >
        <ModalContent>
          <ModalHeader className={modal.header}>
            <span className={`${modal.icon} ${modal.info}`}><IconEdit /></span>
            <div className="min-w-0 flex-1">
              <div className={modal.eyebrow}>Edit seller</div>
              <div className={modal.title}>{seller.storeName || seller.name}</div>
              <div className={modal.sub}>Sellers can change name, store name and phone themselves. Email is admin-only — use this when a seller asks support to change their login address.</div>
            </div>
            <button type="button" className={modal.close} onClick={() => setEditOpen(false)} disabled={editSaving} aria-label="Close"><IconClose /></button>
          </ModalHeader>
          <ModalBody className={modal.body}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AdminInput label="Owner name" isRequired variant="bordered" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              <AdminInput label="Store name" variant="bordered" value={editForm.storeName} onChange={(e) => setEditForm({ ...editForm, storeName: e.target.value })} />
              <AdminInput label="Phone" type="tel" variant="bordered" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
              <AdminInput label="Alternate phone" type="tel" placeholder="Optional backup number" variant="bordered" value={editForm.alternatePhone} onChange={(e) => setEditForm({ ...editForm, alternatePhone: e.target.value })} />
              <AdminInput label="Email" type="email" isRequired variant="bordered" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="sm:col-span-2" description="Used for login. The seller signs in with the new address next time." />
            </div>
          </ModalBody>
          <ModalFooter className={modal.footer}>
            <AdminButton variant="bordered" onPress={() => setEditOpen(false)} isDisabled={editSaving}>Cancel</AdminButton>
            <AdminButton color="primary" onPress={saveEdit} isLoading={editSaving}>Save changes</AdminButton>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

/** One confirm modal for approve / suspend / delete — what will happen, then confirm. */
function SellerActionModal({ action, sellerName, working, onClose, onConfirm }: {
  action: ActionKind | null; sellerName: string; working: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const cfg = action ? ACTION_CONFIG[action](sellerName) : null;
  return (
    <Modal isOpen={!!action} onClose={onClose} placement="center" size="lg" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
      <ModalContent>
        {cfg && (
          <>
            <ModalHeader className={modal.header}>
              <span className={`${modal.icon} ${modal[cfg.tone]}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{cfg.iconPath}</svg></span>
              <div className="min-w-0 flex-1">
                <div className={modal.eyebrow}>{cfg.eyebrow}</div>
                <div className={modal.title}>{cfg.title}</div>
                <div className={modal.sub}>{cfg.subtitle}</div>
              </div>
              <button type="button" className={modal.close} onClick={onClose} disabled={working} aria-label="Close"><IconClose /></button>
            </ModalHeader>
            <ModalBody className={modal.body}>
              <div className={modal.effects}>
                <p>{cfg.panelLabel}</p>
                <ul>{cfg.bullets.map((b, i) => <li key={i}><IconCheck />{b}</li>)}</ul>
              </div>
            </ModalBody>
            <ModalFooter className={modal.footer}>
              <AdminButton variant="bordered" onPress={onClose} isDisabled={working}>Cancel</AdminButton>
              <AdminButton color={cfg.tone === 'danger' ? 'danger' : 'primary'} onPress={onConfirm} isLoading={working}>{cfg.confirmLabel}</AdminButton>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

type ActionCfg = {
  tone: 'positive' | 'warn' | 'danger';
  eyebrow: string; title: string; subtitle: string; iconPath: React.ReactNode;
  panelLabel: string; bullets: string[]; confirmLabel: string;
};

const ACTION_CONFIG: Record<ActionKind, (name: string) => ActionCfg> = {
  approve: (name) => ({
    tone: 'positive', eyebrow: 'Activate seller', title: `Activate ${name}?`,
    subtitle: 'KYC is already verified. This is the final approval that turns the store on.',
    iconPath: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
    panelLabel: 'What happens next',
    bullets: ['Account status changes to Approved.', 'Their products become visible on the storefront immediately.', 'A “Your store is live” email confirms the activation.'],
    confirmLabel: 'Activate & notify seller',
  }),
  suspend: (name) => ({
    tone: 'warn', eyebrow: 'Suspend seller', title: `Suspend ${name}?`,
    subtitle: 'Reversible — you can re-activate the seller any time.',
    iconPath: <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>,
    panelLabel: 'What happens next',
    bullets: ['All of their products disappear from the storefront immediately.', 'They can’t list new products or accept new orders.', 'Orders already in progress still ship.', 'Re-activate the account any time to bring them back.'],
    confirmLabel: 'Suspend seller',
  }),
  delete: (name) => ({
    tone: 'danger', eyebrow: 'Delete seller', title: `Delete ${name}?`,
    subtitle: 'Permanent and can’t be undone. Consider Suspend if you might want them back.',
    iconPath: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>,
    panelLabel: 'This is permanent',
    bullets: ['The seller account is erased and they’re signed out.', 'Every product they listed is deleted with them.', 'Order history that references their products stays intact.', 'Re-onboarding requires a fresh sign-up.'],
    confirmLabel: 'Delete permanently',
  }),
};

function Field({ label, value, copy, wide }: { label: string; value: string; copy?: boolean; wide?: boolean }) {
  return (
    <div className={`${styles.field} ${wide ? styles.wide : ''}`}>
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        {copy && (
          <button type="button" className={styles.copy} aria-label={`Copy ${label.toLowerCase()}`} title={`Copy ${label.toLowerCase()}`}
            onClick={() => navigator.clipboard.writeText(value).then(() => notifySuccess(M.sellers.copied(label))).catch(() => notifyWarning(M.sellers.copyFailedSelectTheTextManually))}>
            <IconCopy />
          </button>
        )}
      </dd>
    </div>
  );
}

function BackToSellers() {
  return (
    <Link className={styles.back} href="/sellers">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="19" y1="12" x2="5" y2="12" /><polyline points="11 18 5 12 11 6" /></svg>
      Back to sellers
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-label="Loading seller">
      <span style={{ height: 92, marginBottom: 16 }} />
      <span style={{ height: 36, width: 360, maxWidth: '100%', marginBottom: 16 }} />
      <span style={{ height: 320 }} />
    </div>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow({ flip }: { flip?: boolean }) { return <svg {...svg} style={flip ? { transform: 'scaleX(-1)' } : undefined}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconMail() { return <svg {...svg}><rect x="3" y="5" width="18" height="14" rx="2" /><polyline points="3 7 12 13 21 7" /></svg>; }
function IconLock() { return <svg {...svg}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>; }
function IconEdit() { return <svg {...svg}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>; }
function IconCopy() { return <svg {...svg}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>; }
function IconCheck() { return <svg {...svg}><polyline points="20 6 9 17 4 12" /></svg>; }
function IconSend() { return <svg {...svg} width="14" height="14"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>; }
function IconShield() { return <svg {...svg}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>; }
function IconDoc() { return <svg {...svg}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>; }
function IconBank() { return <svg {...svg}><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>; }
function IconPin() { return <svg {...svg}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>; }
function IconBox() { return <svg {...svg}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" /></svg>; }
