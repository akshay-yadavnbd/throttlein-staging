'use client';

import { reportCheckoutFailure } from '@/lib/checkoutFailures';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { customerApi } from '@/lib/customerApi';
import { getStoredCustomer } from '@/lib/customerAuth';
import { invalidateWishlist } from '@/lib/wishlist';
import { imageUrl, unwrap } from '@/lib/api';
import { notifyError, notifySuccess, notifyWarning, apiMessage, serverText } from '@/lib/notify';
import { M } from '@/lib/messages';
import CustomerShell from '@/components/common/CustomerShell';
import { AccountHeader, panelLinkClass, primaryButtonClass, secondaryButtonClass } from '@/components/common/AccountUI';

type Availability = {
  /** ok = buyable now; the rest can't be ordered and are shown greyed out. */
  state: 'ok' | 'limited' | 'out_of_stock' | 'unavailable';
  stock: number;
  message: string;
};

type CartItem = {
  _id: string;
  quantity: number;
  size?: string;
  color?: string;
  product: any;
  /** Name / image / price as they were when the item went into the bag —
   *  the only thing left to show once a seller deletes the product. */
  snapshot?: { name?: string; image?: string; slug?: string; price?: number };
  /** Verdict from the API (backend services/cartAvailability.js). Older
   *  responses omit it — treat a missing verdict as buyable. */
  availability?: Availability;
};

/** One seller's delivery, as quoted for the chosen address. Sellers who
 *  absorb delivery come back with customerPays:false and no couriers. */
type DeliveryGroup = {
  sellerId: string;
  sellerName: string;
  customerPays: boolean;
  itemTotal: number;
  weightKg: number;
  couriers: { id: number; name: string; rate: number; etd: string; days: number | null; recommended: boolean }[];
  error: string;
};

/** A line the customer can actually pay for right now. */
const isBuyable = (it: CartItem) => (it.availability?.state ?? 'ok') === 'ok';

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

/* ─────────────── EMI ───────────────
 * Mirrors backend/src/services/razorpay.js. Keep the three constants in
 * sync with EMI_MIN_AMOUNT / EMI_INDICATIVE_RATE / EMI_MAX_TENURE there
 * (or their .env overrides) — the server is authoritative and re-checks
 * at /orders/razorpay/init; these only drive what the tile renders
 * before checkout opens. */
const EMI_MIN_AMOUNT = 3000;
const EMI_INDICATIVE_RATE = 14;   // annual %, display estimate only
const EMI_MAX_TENURE = 12;        // months

/** Reducing-balance instalment: P·r·(1+r)^n / ((1+r)^n − 1). */
function emiMonthly(total: number, tenure: number) {
  const r = EMI_INDICATIVE_RATE / 12 / 100;
  const n = Math.max(1, tenure);
  const factor = Math.pow(1 + r, n);
  return Math.ceil((total * r * factor) / (factor - 1));
}

export default function CartPage() {
  const router = useRouter();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [addressId, setAddressId] = useState<string>('');
  const [placing, setPlacing] = useState(false);
  /* Delivery is quoted per seller for the chosen address: sellers who pass
   * the courier's bill on let the customer pick one and pay its exact rate,
   * the rest are free. Re-quoted whenever the address or the bag changes,
   * because both move the price. */
  const [delivery, setDelivery] = useState<DeliveryGroup[] | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryPicks, setDeliveryPicks] = useState<Record<string, number>>({});
  /**
   * Payment method.
   *
   * 'emi' is a UI-level choice, not a third backend method — it takes
   * the same Razorpay path as 'online' and only changes which
   * instruments the checkout opens on. The DB keeps storing
   * paymentMethod 'online'; what the customer actually paid with is
   * read back from Razorpay after capture (order.paymentInstrument).
   */
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'online' | 'emi'>('online');
  // If the cart's COD eligibility flips to false (seller toggled off, or
  // item swap brought in an opted-out seller), bounce paymentMethod back
  // to 'online' so the customer can't submit an invalid COD order.

  useEffect(() => {
    const u = getStoredCustomer();
    if (!u) {
      router.replace('/signin?returnTo=/cart');
      return;
    }
    Promise.all([customerApi.get('/cart'), customerApi.get('/addresses')])
      .then(([cRes, aRes]) => {
        // Both answer the { data } envelope; keep the local `c.data` / `a.data` reads below.
        const c = { data: unwrap<any>(cRes) };
        const a = { data: unwrap<any>(aRes) };
        setItems(c.data.cart?.items || []);
        // The API drops lines whose product no longer exists — say so,
        // otherwise the bag quietly shrinks between visits.
        const dropped = c.data.removed || [];
        if (dropped.length) {
          toast(dropped.length === 1
            ? `${dropped[0].name} removed · no longer available`
            : `${dropped.length} items removed · no longer available`);
          window.dispatchEvent(new Event('cart:changed'));
        }
        setAddresses(a.data.addresses || []);
        const def = (a.data.addresses || []).find((x: any) => x.isDefault) || (a.data.addresses || [])[0];
        if (def) setAddressId(def._id);
      })
      .finally(() => setLoading(false));
  }, [router]);

  /* Sold-out / de-listed lines stay in the bag but are never charged for:
   * every money figure below, COD eligibility and the order itself are
   * computed from the buyable lines alone — the same split the backend
   * applies at checkout. */
  const liveItems = useMemo(() => items.filter(isBuyable), [items]);
  const blockedItems = useMemo(() => items.filter((i) => !isBuyable(i)), [items]);

  const itemsTotal = useMemo(
    () => liveItems.reduce((s, i) => s + (i.product?.price || 0) * i.quantity, 0),
    [liveItems]
  );
  /* What the customer pays for delivery: the picked courier's rate for
   * every seller who passes it on, ₹0 for the rest. Until the quote lands
   * it is 0 and the summary says "calculating", rather than showing a
   * total that is about to change. */
  const payableGroups = useMemo(() => (delivery || []).filter((g) => g.customerPays), [delivery]);
  const pickedCourier = (g: DeliveryGroup) =>
    g.couriers.find((c) => c.id === deliveryPicks[g.sellerId]) || g.couriers[0] || null;
  const shippingFee = useMemo(
    () => payableGroups.reduce((s, g) => s + (pickedCourier(g)?.rate || 0), 0),
    [payableGroups, deliveryPicks],
  );
  const deliveryError = (delivery || []).find((g) => g.customerPays && g.error)?.error || '';
  const total = itemsTotal + shippingFee;

  // ─── COD eligibility ─────────────────────────────────────────────────────
  // Every seller in the cart must have codEnabled !== false. The surcharge
  // displayed when COD is selected is the highest individual seller's
  // codCharge (charged once, not stacked).
  // Every seller must allow COD AND every product must allow it — a single
  // product marked codAvailable === false forces online payment.
  const codEligible = liveItems.length > 0 && liveItems.every((i) =>
    (i.product?.seller as any)?.codEnabled !== false &&
    (i.product as any)?.codAvailable !== false
  );
  const codCharge = codEligible
    ? liveItems.reduce((m, i) => Math.max(m, Number((i.product?.seller as any)?.codCharge || 0)), 0)
    : 0;
  const displayedTotal = total + (paymentMethod === 'cod' ? codCharge : 0);

  // ─── EMI eligibility ─────────────────────────────────────────────────────
  // Card EMI is gated by the CUSTOMER'S BANK, and essentially every
  // issuer refuses it below ₹3,000 — offering it under that threshold
  // just sends people into a bank error they can't fix. The floor and
  // the indicative monthly figure are mirrored from the backend
  // (services/razorpay.js) so the tile can render before checkout opens;
  // the server re-computes both from the authoritative cart total at
  // /orders/razorpay/init, so this copy is presentational only.
  const emiEligible = total >= EMI_MIN_AMOUNT;
  const emiMonthlyFrom = emiEligible ? emiMonthly(total, EMI_MAX_TENURE) : 0;

  /* Quote delivery for this address. COD changes which couriers qualify,
   * so the payment method is part of the question. */
  useEffect(() => {
    if (!addressId || liveItems.length === 0) { setDelivery(null); return; }
    let cancelled = false;
    setDeliveryLoading(true);
    customerApi
      .get('/cart/delivery-options', { params: { addressId, cod: paymentMethod === 'cod' ? 1 : 0 } })
      .then((r) => {
        if (cancelled) return;
        const groups: DeliveryGroup[] = unwrap<{ groups?: DeliveryGroup[] }>(r).groups || [];
        setDelivery(groups);
        // Start each seller on the cheapest courier, keeping any choice
        // the customer already made that is still on offer.
        setDeliveryPicks((prev) => {
          const next: Record<string, number> = {};
          for (const g of groups) {
            if (!g.customerPays || !g.couriers.length) continue;
            const kept = g.couriers.find((c) => c.id === prev[g.sellerId]);
            next[g.sellerId] = (kept || g.couriers[0]).id;
          }
          return next;
        });
      })
      .catch(() => { if (!cancelled) setDelivery(null); })
      .finally(() => { if (!cancelled) setDeliveryLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressId, paymentMethod, liveItems.length, itemsTotal]);

  // Bounce back to online payment if COD eligibility flips off while
  // 'cod' is selected (e.g. a cart change pulled in a COD-restricted item),
  // or if a quantity change drops the cart under the EMI floor.
  useEffect(() => {
    if (!codEligible && paymentMethod === 'cod') setPaymentMethod('online');
    if (!emiEligible && paymentMethod === 'emi') setPaymentMethod('online');
  }, [codEligible, emiEligible, paymentMethod]);

  async function changeQty(itemId: string, qty: number) {
    if (qty < 1) return;
    try {
      const data = unwrap<any>(await customerApi.put(`/cart/${itemId}`, { quantity: qty }));
      setItems(data.cart.items);
      window.dispatchEvent(new Event('cart:changed'));
    } catch (e: any) {
      notifyError(e, M.cart.thatDidntWork);
    }
  }
  async function remove(itemId: string) {
    try {
      const data = unwrap<any>(await customerApi.delete(`/cart/${itemId}`));
      setItems(data.cart.items);
      window.dispatchEvent(new Event('cart:changed'));
    } catch (e: any) {
      notifyError(e, M.cart.thatDidntWork);
    }
  }
  /** Save the item's product to the wishlist, then drop it from the
   *  cart. "Already in wishlist" from the backend counts as success —
   *  the goal is just that it ends up saved and out of the bag. */
  async function moveToWishlist(itemId: string, productId: string) {
    try {
      try {
        await customerApi.post('/wishlist', { productId });
      } catch (e: any) {
        const msg = String(apiMessage(e) || '');
        if (!/already/i.test(msg)) throw e;
      }
      invalidateWishlist();
      const data = unwrap<any>(await customerApi.delete(`/cart/${itemId}`));
      setItems(data.cart.items);
      window.dispatchEvent(new Event('cart:changed'));
      notifySuccess(M.cart.movedToWishlist);
    } catch (e: any) {
      notifyError(e, M.cart.couldntMoveToWishlist);
    }
  }
  /**
   * Load the Razorpay checkout SDK once (idempotent). Returns true if loaded
   * successfully, false otherwise so the caller can show a useful error.
   */
  function loadRazorpayScript(): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') return resolve(false);
      if ((window as any).Razorpay) return resolve(true);
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }

  async function placeOrder() {
    if (!addressId) {
      reportCheckoutFailure('address', 'Add or pick a shipping address first', { paymentMethod });
      notifyWarning(M.cart.addOrPickAShippingAddressFirst);
      return;
    }
    if (deliveryError) {
      reportCheckoutFailure('delivery', deliveryError, { paymentMethod });
      notifyWarning(deliveryError);
      return;
    }
    if (paymentMethod === 'cod') {
      await placeCodOrder();
    } else {
      // 'online' and 'emi' are the same server flow — the flag only
      // decides which instruments Razorpay opens on.
      await placeOnlineOrder({ emiFirst: paymentMethod === 'emi' });
    }
  }

  async function placeCodOrder() {
    setPlacing(true);
    try {
      /* Idempotency key for this checkout attempt. If the response is
       * lost to a flaky connection and the customer taps "Place order"
       * again, the server returns the SAME order instead of creating a
       * second one (and double-deducting stock). Generated per attempt,
       * not per render, so a genuine second order still works. */
      const attemptIdentity = JSON.stringify({ customer: getStoredCustomer()?._id, addressId, items: items.map((i) => ({ id: i._id, quantity: i.quantity, price: i.product?.price })) });
      const storedAttempt = sessionStorage.getItem('cod_checkout_attempt');
      let previous: { identity: string; key: string } | null = null;
      try { previous = storedAttempt ? JSON.parse(storedAttempt) : null; } catch { /* ignore damaged local state */ }
      const idempotencyKey = previous?.identity === attemptIdentity ? previous.key :
        (globalThis.crypto?.randomUUID?.() ??
          `cod-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      sessionStorage.setItem('cod_checkout_attempt', JSON.stringify({ identity: attemptIdentity, key: idempotencyKey }));
      const data = unwrap<any>(await customerApi.post(
        '/orders',
        { addressId, paymentMethod: 'cod', deliveryPicks },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ));
      sessionStorage.removeItem('cod_checkout_attempt');
      notifySuccess(M.cart.orderPlaced(data.order.orderNumber));
      router.replace(`/account/orders/${data.order.orderNumber || data.order._id}`);
    } catch (e: any) {
      if (!e?.response) reportCheckoutFailure('cod_order', 'Order request failed before a response was received', { paymentMethod: 'cod' });
      notifyError(e, M.cart.couldntPlaceOrder);
    } finally {
      setPlacing(false);
    }
  }

  /**
   * Online payment flow:
   *   1. Ask backend to create a Razorpay order → returns { razorpayOrderId,
   *      amount, currency, keyId, customer }.
   *   2. Load Razorpay checkout SDK and open it with that order_id.
   *   3. On customer success, Razorpay returns signature fields — POST them
   *      to /razorpay/verify which validates the signature and persists our
   *      DB order with paymentStatus='paid'.
   *   4. Navigate to the order detail page.
   *
   * If the customer dismisses the modal or the payment fails, nothing is
   * persisted server-side and they can retry.
   */
  async function placeOnlineOrder({ emiFirst = false }: { emiFirst?: boolean } = {}) {
    setPlacing(true);
    const attemptId = globalThis.crypto?.randomUUID?.() || `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const context = { attemptId, paymentMethod: emiFirst ? 'emi' : 'online', razorpayOrderId: '' };
    let step = 'payment_init';
    let outcomeReported = false;
    try {
      // 1. Init — creates Razorpay order, NO DB order yet.
      const init = unwrap<any>(await customerApi.post('/orders/razorpay/init', { addressId, deliveryPicks, attemptId, paymentMethod: context.paymentMethod }));
      context.razorpayOrderId = init.razorpayOrderId;

      // The server is the authority on EMI eligibility. If the cart
      // changed in another tab between render and checkout, fall back
      // to the normal method list rather than opening a checkout whose
      // only offered instrument the bank will reject.
      const useEmi = emiFirst && init.emi?.eligible !== false;
      if (emiFirst && !useEmi) {
        toast(
          `EMI needs ₹${inr(init.emi?.minAmount || EMI_MIN_AMOUNT)}+ · showing all payment options`,
          { icon: 'ℹ️' }
        );
      }

      // 2. Load checkout SDK
      step = 'sdk_load';
      const ok = await loadRazorpayScript();
      if (!ok) {
        reportCheckoutFailure('sdk_load', 'Could not load Razorpay checkout script', context);
        notifyWarning(M.cart.couldntLoadRazorpayCheckYourInternetAnd);
        setPlacing(false);
        return;
      }

      // 3. Open Razorpay checkout
      step = 'payment_window';
      const rz = new (window as any).Razorpay({
        key: init.keyId,
        amount: init.amount,
        currency: init.currency,
        order_id: init.razorpayOrderId,
        name: 'THROTTLEIN',
        description: emiFirst ? 'Order payment · EMI' : 'Order payment',
        prefill: {
          name: init.customer?.name || '',
          email: init.customer?.email || '',
          contact: init.customer?.contact || '',
          // Razorpay pre-selects the method block when the customer
          // arrives having already chosen EMI on our side.
          ...(useEmi ? { method: 'emi' } : {}),
        },
        /**
         * EMI-first checkout.
         *
         * `display.blocks` reorders Razorpay's method list; putting the
         * EMI block first with `sequence` means the customer lands on
         * bank/tenure selection instead of hunting for EMI behind
         * "More payment options". The other methods stay reachable —
         * `hide: []` keeps them one tap away, because a customer whose
         * card turns out to be EMI-ineligible must be able to fall back
         * without abandoning the order.
         */
        ...(useEmi
          ? {
              config: {
                display: {
                  blocks: {
                    emi: { name: 'EMI · pay in instalments', instruments: [{ method: 'emi' }] },
                  },
                  sequence: ['block.emi'],
                  preferences: { show_default_blocks: true },
                },
              },
            }
          : {}),
        theme: { color: '#141414' },
        // 4. On success, verify with backend
        handler: async (response: any) => {
          outcomeReported = true;
          try {
            const data = unwrap<any>(await customerApi.post('/orders/razorpay/verify', {
              addressId, attemptId, paymentMethod: context.paymentMethod,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }));
            notifySuccess(M.cart.paymentSuccessfulOrder(data.order.orderNumber));
            router.replace(`/account/orders/${data.order.orderNumber || data.order._id}`);
          } catch (e: any) {
            if (!e?.response) reportCheckoutFailure('payment_verify', 'Payment verification request received no response; reconciliation may still complete', context);
            notifyError(e, M.cart.paymentVerificationFailed);
          } finally {
            setPlacing(false);
          }
        },
        modal: {
          ondismiss: () => {
            if (!outcomeReported) reportCheckoutFailure('payment_cancelled', 'Customer closed the payment window', context);
            outcomeReported = true;
            toast('Payment cancelled · your cart is still here', { icon: 'ℹ️' });
            setPlacing(false);
          },
        },
      });
      // Razorpay sometimes fires "payment.failed" before / instead of the
      // dismiss handler — catch it explicitly.
      rz.on('payment.failed', (resp: any) => {
        outcomeReported = true;
        reportCheckoutFailure('payment_failed', resp?.error?.description || 'Payment failed', { ...context, code: resp?.error?.code });
        // Razorpay's description (e.g. "declined by the bank") is shown only when it reads as a sentence.
        notifyWarning(serverText(resp?.error?.description) || M.cart.paymentFailed);
        setPlacing(false);
      });
      rz.open();
    } catch (e: any) {
      if (!e?.response) reportCheckoutFailure(step, e?.message || 'Could not start payment', context);
      notifyError(e, M.cart.couldntStartPayment);
      setPlacing(false);
    }
  }

  if (loading) {
    // Mirrors the loaded layout (bag on the left, checkout on the right)
    // so nothing jumps when the cart lands.
    return (
      <CustomerShell>
        <div aria-busy="true" aria-label="Loading your cart">
          <div className="h-3 w-28 rounded bg-[#f0f2f4] animate-pulse" />
          <div className="mt-3 h-7 w-40 rounded bg-[#f0f2f4] animate-pulse" />
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="flex gap-4 rounded-2xl border border-[#e3e7eb] p-5">
                  <div className="h-24 w-24 shrink-0 rounded-xl bg-[#f0f2f4] animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/5 rounded bg-[#f0f2f4] animate-pulse" />
                    <div className="h-3 w-24 rounded bg-[#f0f2f4] animate-pulse" />
                    <div className="h-8 w-24 rounded-lg bg-[#f0f2f4] animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-3 rounded-2xl border border-[#e3e7eb] p-5">
                  <div className="h-3.5 w-24 rounded bg-[#f0f2f4] animate-pulse" />
                  <div className="h-12 w-full rounded-lg bg-[#f0f2f4] animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </CustomerShell>
    );
  }

  if (items.length === 0) {
    return (
      <CustomerShell>
        <div className="grid min-h-[50vh] place-items-center rounded-2xl border border-[#e3e7eb] bg-white px-6 py-14">
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-[#f3f4f2] text-[#59656f]">
              <BagIcon className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[#252c32]">Your cart is empty</h1>
            <p className="mt-2 text-[13px] text-[#74808a]">Helmets, jackets, lights: anything you ride with.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link href="/" className={primaryButtonClass}>
                Start shopping
              </Link>
              <Link href="/account/wishlist" className={secondaryButtonClass}>
                View wishlist
              </Link>
            </div>
          </div>
        </div>
      </CustomerShell>
    );
  }

  // Aggregate "you saved" across all items (when MRP > price).
  const savings = liveItems.reduce((s, it) => {
    const p = it.product;
    if (!p?.mrp || p.mrp <= p.price) return s;
    return s + (p.mrp - p.price) * it.quantity;
  }, 0);
  const selectedAddress = addresses.find((a) => a._id === addressId);
  const units = liveItems.reduce((s, i) => s + i.quantity, 0);
  const canPay = addresses.length > 0 && liveItems.length > 0 && !deliveryError && !(deliveryLoading && !delivery);

  /** One bag line. Unbuyable lines render greyed with the reason and a
   *  disabled stepper — they stay visible (and removable) instead of
   *  silently vanishing from the bag. */
  function renderItem(it: CartItem) {
    // A deleted product resolves to null, so fall back to the snapshot
    // taken when the item was added — the line stays, with an
    // "Unavailable" label and a way to remove it.
    const p = it.product || {};
    const snap = it.snapshot || {};
    const gone = !it.product;
    const verdict = it.availability;
    const blocked = !isBuyable(it);
    const name = p.name || snap.name || 'This product';
    const image = p.images?.[0] || snap.image || '';
    const unitPrice = gone ? (snap.price || 0) : (p.price || 0);
    const href = p._id ? `/product/${p.slug || p._id}` : (snap.slug ? `/product/${snap.slug}` : '');
    const lineTotal = unitPrice * it.quantity;
    const hasMrp = p.mrp && p.mrp > p.price;
    const lineMrp = hasMrp ? p.mrp * it.quantity : null;
    const lineSavings = hasMrp ? (p.mrp - p.price) * it.quantity : 0;
    const meta = [p.brand?.name, it.color, it.size && `Size ${it.size}`].filter(Boolean).join(' · ');
    const blockedLabel =
      verdict?.state === 'out_of_stock' ? 'Out of stock' : verdict?.state === 'limited' ? `Only ${verdict.stock} left` : 'Unavailable';

    return (
      <li key={it._id} className={`rounded-2xl border border-[#e3e7eb] ${blocked ? 'bg-[#fafbfc]' : 'bg-white'}`}>
        <div className="flex gap-4 p-4 md:p-5">
          {href ? (
            <Link href={href} tabIndex={-1} aria-hidden className="shrink-0">
              <ItemImage src={image} dim={blocked} />
            </Link>
          ) : (
            <ItemImage src={image} dim={blocked} />
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {href ? (
                  <Link
                    href={href}
                    className={`line-clamp-2 rounded text-sm font-semibold leading-snug hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f] ${blocked ? 'text-[#74808a]' : 'text-[#252c32]'}`}
                  >
                    {name}
                  </Link>
                ) : (
                  <span className="line-clamp-2 text-sm font-semibold leading-snug text-[#74808a]">{name}</span>
                )}
                {meta && <p className="mt-1 truncate text-xs text-[#74808a]">{meta}</p>}
                {blocked && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-[#a3392b]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#d0533f]" aria-hidden />
                    {blockedLabel}
                  </p>
                )}
              </div>
              <div className={`shrink-0 text-right ${blocked ? 'opacity-50' : ''}`}>
                <div className="text-sm font-semibold tabular-nums text-[#252c32]">₹{inr(lineTotal)}</div>
                {hasMrp && <div className="mt-0.5 text-xs tabular-nums text-[#9aa3ab] line-through">₹{inr(lineMrp!)}</div>}
                {lineSavings > 0 && !blocked && (
                  <div className="mt-0.5 text-[11px] font-semibold text-[#4b6b16]">Save ₹{inr(lineSavings)}</div>
                )}
              </div>
            </div>

            {/* Too few left: say it where the eye already is, with the one-tap fix. */}
            {blocked && verdict?.state === 'limited' && (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[#f0d6d2] bg-[#fff6f4] px-3 py-2 text-xs text-[#8c3a2e]">
                <span>Only {verdict?.stock} left · you have {it.quantity} in your cart.</span>
                {(verdict?.stock ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => changeQty(it._id, verdict!.stock)}
                    className="ml-auto rounded font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f]"
                  >
                    Set to {verdict?.stock}
                  </button>
                )}
              </div>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-3">
              <div
                className={`inline-flex h-8 items-center overflow-hidden rounded-lg border border-[#e2e7eb] ${blocked ? 'opacity-50' : ''}`}
                role="group"
                aria-label={`Quantity of ${name}`}
              >
                <button
                  type="button"
                  onClick={() => changeQty(it._id, it.quantity - 1)}
                  disabled={blocked || it.quantity <= 1}
                  className="grid h-8 w-8 place-items-center text-[#39434c] hover:bg-[#f3f4f2] disabled:opacity-40 disabled:hover:bg-transparent"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="w-7 select-none text-center text-[13px] font-semibold tabular-nums" aria-live="polite">
                  {it.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => changeQty(it._id, it.quantity + 1)}
                  disabled={blocked || (verdict?.stock ? it.quantity >= verdict.stock : false)}
                  className="grid h-8 w-8 place-items-center text-[#39434c] hover:bg-[#f3f4f2] disabled:opacity-40 disabled:hover:bg-transparent"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                disabled={gone}
                onClick={() => moveToWishlist(it._id, p._id)}
                className="rounded text-xs font-semibold text-[#39434c] hover:underline disabled:opacity-40 disabled:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f]"
              >
                Save for later
              </button>
              <button
                type="button"
                onClick={() => remove(it._id)}
                className="rounded text-xs font-semibold text-[#74808a] hover:text-rose-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f]"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      </li>
    );
  }

  return (
    <CustomerShell>
      <div>
        <AccountHeader
          title="Cart"
          description={
            <>
              {items.length} {items.length === 1 ? 'item' : 'items'}
              {blockedItems.length > 0 && <> · {blockedItems.length} unavailable</>}
            </>
          }
          actions={
            <Link href="/" className={secondaryButtonClass}>
              Continue shopping
            </Link>
          }
        />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:gap-8">
          {/* BAG */}
          <div className="flex min-w-0 flex-col gap-3">
            <ul className="flex flex-col gap-3">{items.map((it) => renderItem(it))}</ul>

            <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#5d6871]">
              <TrustPoint icon={<path d="M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z" />}>Secure payments</TrustPoint>
              <TrustPoint icon={<path d="M3 12l3-3 3 3M6 9v6a3 3 0 0 0 3 3h9" />}>Easy returns &amp; exchange</TrustPoint>
              {/* A marketplace can't promise "direct from brands" — what it
                  can stand behind is that every seller passed KYC. */}
              <TrustPoint icon={<path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6zM9 12l2 2 4-4" />}>Verified sellers</TrustPoint>
            </ul>
          </div>

          {/* CHECKOUT — in the order it's decided: where, how it ships, how
              to pay, then the total right above the button that pays it. */}
          <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-[calc(var(--site-header-h,72px)+64px)]">
            <Step
              title="Deliver to"
              action={
                <Link href="/account/addresses" className={panelLinkClass}>
                  {addresses.length ? 'Manage' : 'Add address'}
                </Link>
              }
            >
              {addresses.length === 0 ? (
                <p className="text-[13px] text-[#5d6871]">
                  No saved address yet.{' '}
                  <Link href="/account/addresses" className="font-semibold text-[#252c32] underline underline-offset-2">
                    Add one
                  </Link>{' '}
                  to check out.
                </p>
              ) : (
                <div role="radiogroup" aria-label="Delivery address" className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                  {addresses.map((a: any) => {
                    const picked = String(a._id) === String(addressId);
                    return (
                      <button
                        key={a._id}
                        type="button"
                        role="radio"
                        aria-checked={picked}
                        onClick={() => setAddressId(String(a._id))}
                        className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#59656f] ${
                          picked ? 'border-[#191d21] bg-[#f6f7f5]' : 'border-[#e2e7eb] hover:border-[#c9d1d8]'
                        }`}
                      >
                        <Radio on={picked} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-[#252c32]">{a.fullName}</span>
                            <span className="rounded bg-[#eef0f2] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-[#59656f]">
                              {a.label || 'Home'}
                            </span>
                            {a.isDefault && <span className="text-[11px] text-[#74808a]">Default</span>}
                          </span>
                          <span className={`mt-0.5 block text-xs leading-snug text-[#74808a] ${picked ? '' : 'truncate'}`}>
                            {[a.line1, a.line2].filter(Boolean).join(', ')}, {a.city}, {a.state} {a.pincode}
                          </span>
                          {picked && a.phone && <span className="mt-0.5 block text-xs tabular-nums text-[#74808a]">{a.phone}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Step>

            {/* Delivery — one block per seller who passes the courier's bill
                on. Each parcel ships from its own pickup pincode, so each gets
                its own rates; sellers who absorb delivery aren't listed (their
                items simply ship free). */}
            {addressId && payableGroups.length > 0 && (
              <Step title="Delivery" action={deliveryLoading ? <span className="text-xs text-[#9aa3ab]">Updating…</span> : null}>
                <div className="flex flex-col gap-4">
                  {payableGroups.map((g) => (
                    <div key={g.sellerId}>
                      {payableGroups.length > 1 && (
                        <p className="mb-1.5 text-xs font-semibold text-[#39434c]">
                          {g.sellerName}
                          <span className="ml-1.5 font-normal text-[#9aa3ab]">· {g.weightKg} kg parcel</span>
                        </p>
                      )}
                      {g.error ? (
                        <p role="alert" className="rounded-lg border border-[#f0d6d2] bg-[#fff6f4] px-3 py-2 text-xs text-[#8c3a2e]">
                          {g.error}
                        </p>
                      ) : (
                        <div role="radiogroup" aria-label={`Courier for ${g.sellerName}`} className="flex flex-col gap-1.5">
                          {g.couriers.slice(0, 5).map((c) => {
                            const picked = (deliveryPicks[g.sellerId] ?? g.couriers[0]?.id) === c.id;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                role="radio"
                                aria-checked={picked}
                                onClick={() => setDeliveryPicks((p) => ({ ...p, [g.sellerId]: c.id }))}
                                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#59656f] ${
                                  picked ? 'border-[#191d21] bg-[#f6f7f5]' : 'border-[#e2e7eb] hover:border-[#c9d1d8]'
                                }`}
                              >
                                <Radio on={picked} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-semibold text-[#252c32]">{c.name}</span>
                                  {c.etd && <span className="block text-xs text-[#74808a]">Arrives in {c.etd}</span>}
                                </span>
                                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[#252c32]">₹{inr(c.rate)}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-[#9aa3ab]">The courier’s own rate for your pincode and parcel weight.</p>
              </Step>
            )}

            <Step title="Payment">
              <div role="radiogroup" aria-label="Payment method" className="flex flex-col gap-2">
                <PayOption
                  selected={paymentMethod === 'online'}
                  onClick={() => setPaymentMethod('online')}
                  title="Pay online"
                  subtitle="UPI, card or netbanking"
                  badge="Recommended"
                  icon={<path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 10h20" />}
                />
                {/* EMI — disabled (not hidden) below the floor: "add ₹X more"
                    is a nudge; a missing tile confuses someone who used it before. */}
                <PayOption
                  selected={paymentMethod === 'emi'}
                  onClick={() => emiEligible && setPaymentMethod('emi')}
                  disabled={!emiEligible}
                  title="EMI"
                  subtitle={
                    emiEligible
                      ? `From ₹${inr(emiMonthlyFrom)}/month · up to ${EMI_MAX_TENURE} months`
                      : `On orders above ₹${inr(EMI_MIN_AMOUNT)} · add ₹${inr(EMI_MIN_AMOUNT - total)} more`
                  }
                  icon={<path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 9h18M8 14h.01M12 14h.01M16 14h.01" />}
                />
                {paymentMethod === 'emi' && (
                  <p className="rounded-lg bg-[#f6f7f9] px-3 py-2 text-[11px] leading-relaxed text-[#5d6871]">
                    Pick your bank and tenure next. Your bank sets the exact instalment; ₹{inr(emiMonthlyFrom)}/month is an
                    estimate at {EMI_INDICATIVE_RATE}% p.a. over {EMI_MAX_TENURE} months.
                  </p>
                )}
                {/* COD is the seller's offer: shown only when every seller in
                    the cart allows it for these products. */}
                {codEligible && (
                  <PayOption
                    selected={paymentMethod === 'cod'}
                    onClick={() => setPaymentMethod('cod')}
                    title="Cash on delivery"
                    subtitle={codCharge > 0 ? `Pay at your door · +₹${inr(codCharge)} fee` : 'Pay at your door'}
                    icon={<path d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 12h.01M18 12h.01" />}
                  />
                )}
              </div>
            </Step>

            {/* Total, then the button that pays it. Prices include tax. */}
            <section className="rounded-2xl border border-[#e3e7eb] bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-[#252c32]">Order summary</h2>
              <dl className="flex flex-col gap-2 text-[13px]">
                <SumRow label={`Items (${units})`} value={`₹${inr(itemsTotal)}`} />
                {blockedItems.length > 0 && (
                  <p className="-mt-1 text-[11px] text-[#9aa3ab]">
                    {blockedItems.length} unavailable {blockedItems.length === 1 ? 'item isn’t' : 'items aren’t'} included.
                  </p>
                )}
                {savings > 0 && <SumRow label="You save" value={<span className="font-semibold text-[#4b6b16]">−₹{inr(savings)}</span>} />}
                {addressId && (
                  <SumRow
                    label="Delivery"
                    value={
                      deliveryLoading && !delivery ? (
                        <span className="text-[#9aa3ab]">Calculating…</span>
                      ) : shippingFee > 0 ? (
                        `₹${inr(shippingFee)}`
                      ) : (
                        <span className="font-semibold text-[#4b6b16]">Free</span>
                      )
                    }
                  />
                )}
                {paymentMethod === 'cod' && codCharge > 0 && <SumRow label="Cash on delivery fee" value={`₹${inr(codCharge)}`} />}
                <div className="mt-1 flex items-baseline justify-between border-t border-[#edf0f2] pt-3">
                  <dt className="text-sm font-semibold text-[#252c32]">Total</dt>
                  <dd className="text-2xl font-semibold tabular-nums tracking-[-0.02em] text-[#252c32]">₹{inr(displayedTotal)}</dd>
                </div>
                <p className="-mt-1 text-right text-[11px] text-[#9aa3ab]">Inclusive of taxes</p>
              </dl>

              {selectedAddress && (
                <p className="mt-3 truncate text-xs text-[#74808a]">
                  To {selectedAddress.fullName}, {selectedAddress.city} {selectedAddress.pincode}
                </p>
              )}
              <button
                type="button"
                onClick={placeOrder}
                disabled={!canPay || placing}
                className={`${primaryButtonClass} mt-3 h-12 w-full text-sm`}
              >
                {placing
                  ? 'Placing order…'
                  : liveItems.length === 0
                    ? 'Nothing available to order'
                    : addresses.length === 0
                      ? 'Add an address to continue'
                      : deliveryLoading && !delivery
                        ? 'Checking delivery…'
                        : paymentMethod === 'cod'
                          ? `Place order · ₹${inr(displayedTotal)}`
                          : paymentMethod === 'emi'
                            ? `Continue to EMI · ₹${inr(displayedTotal)}`
                            : `Pay ₹${inr(displayedTotal)}`}
              </button>
              <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] text-[#9aa3ab]">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {paymentMethod === 'cod' ? 'Pay in cash when it arrives' : 'Secured by Razorpay'}
              </p>
            </section>
          </div>
        </div>
      </div>
    </CustomerShell>
  );
}

/* ─── Pieces ───────────────────────────────────────────────────────── */

/** A checkout step card: title, optional header action, body. */
function Step({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e3e7eb] bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#252c32]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SumRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[#5d6871]">{label}</dt>
      <dd className="tabular-nums text-[#252c32]">{value}</dd>
    </div>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] ${on ? 'border-[#191d21]' : 'border-[#c3cad0]'}`}
    >
      {on && <span className="h-2 w-2 rounded-full bg-[#191d21]" />}
    </span>
  );
}

function TrustPoint({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-[#59656f]" aria-hidden>
        {icon}
      </svg>
      {children}
    </li>
  );
}

function ItemImage({ src, dim }: { src?: string; dim: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#edf0f2] bg-[#f6f7f9] sm:h-24 sm:w-24 md:h-28 md:w-28">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl(src)}
          alt=""
          className={`h-full w-full object-cover ${dim ? 'opacity-45 grayscale' : ''}`}
          onError={() => setBroken(true)}
          // An image that failed before React attached onError (first paint) is caught here.
          ref={(el) => {
            if (el?.complete && el.naturalWidth === 0) setBroken(true);
          }}
        />
      ) : (
        <BagIcon className="h-7 w-7 text-[#c3cad0]" />
      )}
    </div>
  );
}

function BagIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M6 7h12l1 14H5zM9 7a3 3 0 0 1 6 0" />
    </svg>
  );
}

function PayOption({
  selected,
  onClick,
  title,
  subtitle,
  badge,
  icon,
  disabled = false,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  badge?: string;
  icon: React.ReactNode;
  /** Greyed and unclickable but still readable — EMI below the minimum,
   *  where the subtitle says how much more is needed. */
  disabled?: boolean;
}) {
  const on = selected && !disabled;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#59656f] ${
        disabled
          ? 'cursor-not-allowed border-[#edf0f2] bg-[#fafbfc] opacity-70'
          : on
            ? 'border-[#191d21] bg-[#f6f7f5]'
            : 'border-[#e2e7eb] hover:border-[#c9d1d8]'
      }`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${on ? 'bg-[#191d21] text-white' : 'bg-[#f3f4f2] text-[#39434c]'}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          {icon}
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-semibold text-[#252c32]">{title}</span>
          {badge && (
            <span className="rounded-full bg-[#eef3e3] px-1.5 py-px text-[10px] font-semibold text-[#4b6b16]">{badge}</span>
          )}
        </span>
        {subtitle && <span className="mt-0.5 block text-xs text-[#74808a]">{subtitle}</span>}
      </span>
      <Radio on={on} />
    </button>
  );
}
