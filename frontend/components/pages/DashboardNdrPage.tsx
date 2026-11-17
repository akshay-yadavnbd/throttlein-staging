'use client';

/**
 * NDR (Non-Delivery Report) page.
 *
 * Lists every shipment of this seller's that's currently flagged NDR by the
 * courier. Seller can:
 *   - Ask for a re-attempt (optionally with a corrected address)
 *   - Initiate a return (RTO)
 *   - Dispute the attempt as fake (Shiprocket investigates)
 *
 * Data source: GET /api/seller/orders/ndr — the backend filters Shiprocket's
 * account-wide NDR list down to this seller's AWBs.
 */
import { useMemo, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, RadioGroup, Radio, Textarea, Input } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import Link from 'next/link';
import Arrow from '@/components/common/Arrow';
import SellerSelect from '@/components/common/SellerSelect';
import { EmptyState, ErrorState, TableSkeleton, TablePagination } from '@/components/ui';
import SellerOrdersTabs from '@/components/common/SellerOrdersTabs';
import { useSellerQueue } from '@/lib/useSellerQueue';
import { refreshSellerAttention } from '@/lib/useSellerAttention';
import { formatDateTime } from '@/lib/dates';
import base from './DashboardOrders.module.css';
import styles from './SellerOrderQueues.module.css';
import { api } from '@/lib/api';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';

type NdrRow = {
  awb: string;
  orderNumber: string;
  courier: string;
  reason: string;
  attempts: number;
  lastAttemptAt: string | null;
  customer: string;
};

export default function DashboardNdrPage() {
  const { rows, loading, error, refreshError, retry, refresh } = useSellerQueue<NdrRow>('/seller/orders/ndr', 'ndr', 'seller-ndr');
  const [query, setQuery] = useState('');
  const [attemptFilter, setAttemptFilter] = useState('all');
  const [page, setPage] = useState(1);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(row => (attemptFilter === 'all' || row.attempts >= 2) &&
      [row.orderNumber, row.customer, row.awb, row.courier, row.reason].some(value => (value || '').toLowerCase().includes(needle)))
      .sort((a, b) => b.attempts - a.attempts);
  }, [rows, query, attemptFilter]);
  const pages = Math.max(1, Math.ceil(visible.length / 15));
  const activePage = Math.min(page, pages);
  const paginated = visible.slice((activePage - 1) * 15, activePage * 15);
  const filtered = query.trim() !== '' || attemptFilter !== 'all';
  function clearFilters() { setQuery(''); setAttemptFilter('all'); setPage(1); }

  const modal = useDisclosure();
  const [activeRow, setActiveRow] = useState<NdrRow | null>(null);
  const [action, setAction] = useState<'re-attempt' | 'return' | 'fake-attempt'>('re-attempt');
  const [comments, setComments] = useState('');
  const [overrideOn, setOverrideOn] = useState(false);
  const [ovr, setOvr] = useState({
    name: '', phone: '', address: '', address_2: '', city: '', state: '', pincode: '',
  });
  const [submitting, setSubmitting] = useState(false);

  function openAction(r: NdrRow) {
    setActiveRow(r);
    setAction('re-attempt');
    setComments('');
    setOverrideOn(false);
    setOvr({ name: '', phone: '', address: '', address_2: '', city: '', state: '', pincode: '' });
    modal.onOpen();
  }

  async function submit() {
    if (!activeRow) return;
    setSubmitting(true);
    try {
      await api.post(`/seller/orders/${activeRow.orderNumber}/ndr-action`, {
        action,
        comments,
        addressOverride: action === 're-attempt' && overrideOn ? ovr : undefined,
      });
      notifySuccess(M.ndr.sentToTheCourier);
      modal.onClose();
      await Promise.all([refresh(), refreshSellerAttention()]);
    } catch (e: any) {
      notifyError(e, M.ndr.actionFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className={base.page}>
        <h1 className="sr-only">Delivery issues</h1>
        <SellerOrdersTabs active="delivery" />
        {refreshError && <div className={styles.refreshNotice} role="status">Couldn’t refresh delivery issues. Showing the last saved list.<button type="button" onClick={retry}>Try again</button></div>}
        <section className={base.workspace} aria-label="Delivery issue list">
          <div className={base.listHeader}><div><h2>Shipments to resolve <span>{loading || error ? '—' : rows.length}</span></h2><p>Repeated delivery attempts appear first.</p></div>
            <div className={base.period}><span>Attempts</span><SellerSelect ariaLabel="Delivery attempts" value={attemptFilter} onChange={value => { setAttemptFilter(value); setPage(1); }} options={[{ value: 'all', label: 'All attempts' }, { value: 'repeated', label: '2 or more attempts' }]} /></div>
          </div>
          <div className={`${base.toolbar} ${styles.toolbarBorder}`}>
            <label className={base.search}><SearchIcon /><span className="sr-only">Search delivery issues</span><input type="search" placeholder="Search order, customer, tracking or courier…" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
            <div className={base.results} aria-live="polite">{loading ? 'Loading shipments…' : error ? 'Shipments unavailable' : `${visible.length} ${visible.length === 1 ? 'shipment' : 'shipments'}`}{filtered && <button className={base.clearFilters} type="button" onClick={clearFilters}>Clear filters <span aria-hidden>×</span></button>}</div>
          </div>
          {error ? <ErrorState title="We couldn’t load delivery issues" message={error} onRetry={retry} /> : loading ? <div role="status" aria-label="Loading delivery issues"><TableSkeleton columns={6} rows={4} /></div> : visible.length === 0 ? <EmptyState title={filtered ? 'No shipments match your filters' : 'No delivery issues right now'} description={filtered ? 'Try another search or include all delivery attempts.' : 'Failed delivery attempts will appear here so you can arrange another attempt, request a return or dispute the courier’s report.'} filtered={filtered} action={filtered ? <button className={base.darkLink} type="button" onClick={clearFilters}>Clear filters</button> : <Link className={styles.textLink} href="/dashboard/orders">Back to orders <Arrow /></Link>} /> : <>
            <div className={base.desktopTable}><table className={`${styles.queueTable} ${styles.ndrTable}`}>
              <caption className="sr-only">Seller shipments with delivery issues</caption>
              <thead><tr>{['Order', 'Customer', 'Tracking / courier', 'Delivery issue', 'Attempts', 'Next step'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{paginated.map(row => <tr key={row.awb}>
                <th scope="row"><Link className={styles.orderLink} href={`/dashboard/orders/${row.orderNumber}`}>{row.orderNumber}</Link></th>
                <td>{row.customer || '—'}</td>
                <td><span className={styles.tracking}>{row.awb}</span><small>{row.courier || 'Courier not available'}</small></td>
                <td><p className={styles.reason}>{row.reason || 'The courier did not provide a reason.'}</p></td>
                <td><span className={styles.attempts}>{row.attempts} {row.attempts === 1 ? 'attempt' : 'attempts'}</span><small>{row.lastAttemptAt ? formatDateTime(row.lastAttemptAt) : 'Date not provided'}</small></td>
                <td><button className={base.darkLink} type="button" aria-label={`Resolve delivery issue for ${row.orderNumber}`} onClick={() => openAction(row)}>Resolve issue</button></td>
              </tr>)}</tbody>
            </table></div>
            <div className={base.mobileOrders}>{paginated.map(row => <article className={base.mobileOrder} key={row.awb} aria-label={`Delivery issue for ${row.orderNumber}`}>
              <div className={base.mobileTop}><div><Link className={styles.orderLink} href={`/dashboard/orders/${row.orderNumber}`}>{row.orderNumber}</Link><p className={styles.secondary}>{row.customer || 'Customer not provided'}</p></div><span className={styles.attempts}>{row.attempts} {row.attempts === 1 ? 'attempt' : 'attempts'}</span></div>
              <p className={styles.mobileReason}>{row.reason || 'The courier did not provide a reason.'}</p>
              <dl><div><dt>Tracking / courier</dt><dd className={styles.tracking}>{row.awb}<small>{row.courier}</small></dd></div><div><dt>Last attempt</dt><dd>{row.lastAttemptAt ? formatDateTime(row.lastAttemptAt) : 'Date not provided'}</dd></div></dl>
              <div className={base.mobileActions}><button className={base.darkLink} type="button" aria-label={`Resolve delivery issue for ${row.orderNumber}`} onClick={() => openAction(row)}>Resolve issue</button></div>
            </article>)}</div>
            <footer className={base.listFooter}>{pages > 1 ? <TablePagination noun="shipments" onChange={setPage} page={activePage} pages={pages} pageSize={15} total={visible.length} /> : <p>Showing {visible.length} {visible.length === 1 ? 'shipment' : 'shipments'}</p>}</footer>
          </>}
        </section>
      </div>

      <Modal
        isOpen={modal.isOpen}
        onOpenChange={modal.onOpenChange}
        isDismissable={!submitting}
        isKeyboardDismissDisabled={submitting}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <div className="font-bold">Delivery issue — {activeRow?.orderNumber}</div>
                <div className="text-xs text-muted font-normal">
                  Tracking no. {activeRow?.awb} · {activeRow?.courier} · {activeRow?.attempts} attempt(s) so far
                </div>
              </ModalHeader>
              <ModalBody className="flex flex-col gap-4">
                <RadioGroup label="Next step" isDisabled={submitting} value={action} onValueChange={(v: any) => setAction(v)}>
                  <Radio value="re-attempt" description="Ask the courier to try delivering again (use override below if the address was wrong).">
                    Re-attempt delivery
                  </Radio>
                  <Radio value="return" description="The courier brings the parcel back to your pickup address (RTO).">
                    Send it back to me
                  </Radio>
                  <Radio value="fake-attempt" description="Customer says the courier never actually came. Shiprocket investigates.">
                    Dispute as fake attempt
                  </Radio>
                </RadioGroup>

                <Textarea
                  label="Comments (optional)"
                  placeholder="Any extra context for the courier or Shiprocket support…"
                  value={comments}
                  onValueChange={setComments}
                  minRows={2}
                  maxRows={4}
                />

                {action === 're-attempt' && (
                  <div className="rounded-lg border border-default-200 p-3">
                    <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={overrideOn}
                        onChange={(e) => setOverrideOn(e.target.checked)}
                      />
                      Customer corrected the address — use these instead
                    </label>
                    {overrideOn && (
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        <Input labelPlacement="outside" size="sm" label="Name" value={ovr.name} onValueChange={(v) => setOvr({ ...ovr, name: v })} />
                        <Input labelPlacement="outside" size="sm" label="Phone" value={ovr.phone} onValueChange={(v) => setOvr({ ...ovr, phone: v })} />
                        <Input labelPlacement="outside" size="sm" label="Address line 1" className="col-span-2" value={ovr.address} onValueChange={(v) => setOvr({ ...ovr, address: v })} />
                        <Input labelPlacement="outside" size="sm" label="Address line 2" className="col-span-2" value={ovr.address_2} onValueChange={(v) => setOvr({ ...ovr, address_2: v })} />
                        <Input labelPlacement="outside" size="sm" label="City" value={ovr.city} onValueChange={(v) => setOvr({ ...ovr, city: v })} />
                        <Input labelPlacement="outside" size="sm" label="State" value={ovr.state} onValueChange={(v) => setOvr({ ...ovr, state: v })} />
                        <Input labelPlacement="outside" size="sm" label="Pincode" value={ovr.pincode} onValueChange={(v) => setOvr({ ...ovr, pincode: v })} />
                      </div>
                    )}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="bordered" isDisabled={submitting} onPress={close}>Cancel</Button>
                <Button className={base.darkLink} isLoading={submitting} onPress={submit}>
                  {action === 're-attempt' ? 'Request another attempt' : action === 'return' ? 'Request return to sender' : 'Submit dispute'}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}

function SearchIcon() {
  return <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" /></svg>;
}
