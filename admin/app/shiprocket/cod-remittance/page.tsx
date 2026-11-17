'use client';

/**
 * Admin — Shiprocket COD remittance.
 *
 * Read-only wrapper over Shiprocket's `/account/details/cod-remittance`
 * endpoint (see backend/src/services/shiprocket.js:736). Shows every
 * pending / paid COD payout so admin can reconcile the ledger and tell
 * sellers when the cash will hit.
 *
 * Backend: GET /api/admin/shiprocket/cod-remittance
 */
import { useEffect, useState } from 'react';
import {
  Card, CardBody, Chip, Spinner,
  Table, TableHeader, TableColumn, TableBody, TableRow, TableCell,
} from '@heroui/react';
import AdminShell from '@/components/AdminShell';
import list from '@/components/WorkspaceList.module.css';
import OrdersTabs from '@/components/OrdersTabs';
import { api, unwrap } from '@/lib/api';
import { apiMessage } from '@/lib/notify';

// Shape is defined by Shiprocket — see their COD-remittance API docs.
// We're permissive with typing so any surprise field still shows.
type Row = {
  id?: string | number;
  cod_available_amount?: number;
  amount?: number;
  remittance_date?: string;
  status?: string;
  utr?: string;
  payment_ref?: string;
  bank_name?: string;
  awb?: string;
  order_id?: string;
  currency?: string;
  [k: string]: any;
};

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);

export default function AdminCodRemittancePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = unwrap<{ remittance?: any }>(await api.get('/admin/shiprocket/cod-remittance'));
        // Shiprocket returns `{ data: [...] }` inside the wrapper.
        const list = data?.remittance?.data || data?.remittance || [];
        setRows(Array.isArray(list) ? list : []);
      } catch (e: any) {
        // Kept in state and rendered IN the panel, not toasted: Shiprocket's
        // public API currently 404s this endpoint (`GET /account/details/
        // cod-remittance` is not in their documented collection — their
        // docs define 404 as "the resource requested does not exist"), so
        // on every visit two error toasts (dev StrictMode double-runs the
        // effect) popped over an empty state that claimed "Nothing to
        // remit". One inline message, no false all-clear.
        setError(apiMessage(e) || "Couldn't load COD remittance from Shiprocket.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AdminShell>
      {/* Tabs and content share the workspace page column so they start
          at the same left edge on wide screens. */}
      <div className={list.page}>
      {/* Orders section tabs — replaces the former sidebar submenu.
          No page header below them per product decision: title,
          description and the "₹n pending" chip are gone — the shell
          header + active tab already name the screen, and the pending
          total reads from the table itself. */}
      <OrdersTabs />

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-default-500 py-16">
          <Spinner size="sm" /> Loading…
        </div>
      ) : error ? (
        <Card>
          <CardBody className="py-16 text-center">
            <div className="text-default-700 font-semibold">Couldn’t load COD remittance.</div>
            <div className="text-xs text-default-500 mt-2 max-w-xl mx-auto">
              {error} Shiprocket’s API is currently rejecting this endpoint
              (404) — the panel can’t show the ledger until Shiprocket
              exposes it for this account. The figures remain available in
              the Shiprocket dashboard itself.
            </div>
          </CardBody>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardBody className="py-16 text-center">
            <div className="text-default-700 font-semibold">Nothing to remit.</div>
            <div className="text-xs text-default-500 mt-2">
              Shiprocket reports no COD payouts on the account right now.
              This is normal for a fresh integration or during the payout
              window between cycles.
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table
              aria-label="COD remittance rows"
              removeWrapper
              classNames={{
                th: 'bg-default-50 text-xs uppercase tracking-wider text-default-500',
              }}
            >
              <TableHeader>
                <TableColumn>AWB / Order</TableColumn>
                <TableColumn>Amount</TableColumn>
                <TableColumn>Status</TableColumn>
                <TableColumn>UTR / Ref</TableColumn>
                <TableColumn>Bank</TableColumn>
                <TableColumn>Remittance date</TableColumn>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const amount = Number(r.amount || r.cod_available_amount || 0);
                  const status = String(r.status || 'Pending');
                  const settled = /paid|settled|complete/i.test(status);
                  return (
                    <TableRow key={r.id ?? r.awb ?? r.order_id ?? `row-${i}`}>
                      <TableCell className="font-semibold">
                        <div className="text-sm">{r.awb || r.order_id || '—'}</div>
                        {r.awb && r.order_id ? (
                          <div className="text-xs text-default-500">{r.order_id}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">
                        ₹{inr(amount)}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="sm"
                          color={settled ? 'success' : 'warning'}
                          variant="flat"
                          className="capitalize font-semibold"
                        >
                          {status}
                        </Chip>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.utr || r.payment_ref || '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.bank_name || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-default-500">
                        {r.remittance_date
                          ? new Date(r.remittance_date).toLocaleDateString('en-IN', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })
                          : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}
      </div>
    </AdminShell>
  );
}
