'use client';

/**
 * Customer Wishlist page — `/account/wishlist`.
 *
 * A product grid of everything saved for later. Each card shows the price
 * against MRP and whether it can be bought right now:
 *  - in stock → "Move to cart" (adds one, then drops it from the wishlist),
 *  - out of stock → "Notify me" (back-in-stock email),
 *  - no longer sold → said plainly; it can only be removed.
 * Removing is instant on screen and put back if the server says no.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import CustomerShell from '@/components/common/CustomerShell';
import { AccountHeader, primaryButtonClass, secondaryButtonClass } from '@/components/common/AccountUI';
import { customerApi } from '@/lib/customerApi';
import { imageUrl, unwrap } from '@/lib/api';
import { invalidateWishlist } from '@/lib/wishlist';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';

type Product = {
  _id: string;
  slug?: string;
  name: string;
  price: number;
  mrp?: number;
  images?: string[];
  stock?: number;
  status?: string;
  brand?: { name?: string } | null;
};

const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

export default function AccountWishlistPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notified, setNotified] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    customerApi
      .get('/wishlist')
      .then((r) => {
        setProducts((unwrap<{ wishlist?: { products?: Product[] } }>(r).wishlist?.products || []).filter(Boolean));
        setState('ready');
      })
      .catch(() => setState('failed'));
  }, []);

  async function remove(p: Product) {
    const before = products;
    setProducts((list) => list.filter((x) => x._id !== p._id));
    try {
      await customerApi.delete(`/wishlist/${p._id}`);
      invalidateWishlist();
      notifySuccess(M.accountWishlist.removedFromWishlist);
    } catch (e) {
      setProducts(before);
      notifyError(e, M.accountWishlist.thatDidntWork);
    }
  }

  async function moveToCart(p: Product) {
    setBusyId(p._id);
    try {
      await customerApi.post('/cart', { productId: p._id, quantity: 1 });
      window.dispatchEvent(new Event('cart:changed'));
      // In the cart either way; a failed wishlist delete only leaves it listed here too.
      await customerApi.delete(`/wishlist/${p._id}`).catch(() => null);
      invalidateWishlist();
      setProducts((list) => list.filter((x) => x._id !== p._id));
      notifySuccess(M.accountWishlist.movedToCart);
    } catch (e) {
      notifyError(e, M.accountWishlist.thatDidntWork);
    } finally {
      setBusyId(null);
    }
  }

  async function notifyMe(p: Product) {
    setBusyId(p._id);
    try {
      await customerApi.post('/notify-me', { productId: p._id });
      setNotified((s) => new Set(s).add(p._id));
      notifySuccess(M.accountWishlist.wellEmailYouWhenItsBack);
    } catch (e) {
      notifyError(e, M.accountWishlist.thatDidntWork);
    } finally {
      setBusyId(null);
    }
  }

  const count = products.length;

  return (
    <CustomerShell>
      <AccountHeader
        title="Wishlist"
        description={state === 'ready' && count ? `${count} saved for later` : 'Things you saved for later'}
        actions={
          state === 'ready' && count > 0 ? (
            <Link href="/" className={secondaryButtonClass}>
              Keep shopping
            </Link>
          ) : null
        }
      />

      {state === 'loading' ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading wishlist">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-[#e3e7eb] bg-white">
              <div className="aspect-square animate-pulse bg-[#f0f2f4]" />
              <div className="space-y-2 p-3">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-[#f0f2f4]" />
                <div className="h-3.5 w-1/3 animate-pulse rounded bg-[#f0f2f4]" />
              </div>
            </div>
          ))}
        </div>
      ) : state === 'failed' ? (
        <Empty
          title="Couldn't load your wishlist"
          text="Check your connection and try again."
          action={
            <button type="button" className={secondaryButtonClass} onClick={() => window.location.reload()}>
              Try again
            </button>
          }
        />
      ) : count === 0 ? (
        <Empty
          title="Your wishlist is empty"
          text="Tap the heart on any product to save it here."
          action={
            <Link href="/" className={primaryButtonClass}>
              Discover products
            </Link>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <WishlistCard
              key={p._id}
              product={p}
              busy={busyId === p._id}
              notified={notified.has(p._id)}
              onMove={() => moveToCart(p)}
              onNotify={() => notifyMe(p)}
              onRemove={() => remove(p)}
            />
          ))}
        </ul>
      )}
    </CustomerShell>
  );
}

/* ─── One product ──────────────────────────────────────────────────── */

function WishlistCard({
  product: p,
  busy,
  notified,
  onMove,
  onNotify,
  onRemove,
}: {
  product: Product;
  busy: boolean;
  notified: boolean;
  onMove: () => void;
  onNotify: () => void;
  onRemove: () => void;
}) {
  const href = `/product/${p.slug || p._id}`;
  const sold = !p.status || p.status === 'active';
  const inStock = sold && (p.stock ?? 0) > 0;
  const off = p.mrp && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;

  return (
    <li className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#e3e7eb] bg-white transition hover:border-[#c9d1d8]">
      <Link href={href} className="block focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#59656f]" tabIndex={-1} aria-hidden>
        <ProductImage src={p.images?.[0]} dim={!inStock} />
      </Link>
      {!inStock && (
        <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-[#39434c] shadow-sm">
          {sold ? 'Out of stock' : 'Unavailable'}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${p.name} from wishlist`}
        className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-[#59656f] shadow-sm transition hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        {p.brand?.name && (
          <span className="mb-0.5 truncate text-[10px] font-semibold uppercase tracking-wider text-[#9aa3ab]">{p.brand.name}</span>
        )}
        <Link
          href={href}
          className="line-clamp-2 rounded text-[13px] font-medium leading-snug text-[#252c32] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f]"
        >
          {p.name}
        </Link>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-sm font-semibold tabular-nums text-[#252c32]">₹{inr(p.price)}</span>
          {off > 0 && (
            <>
              <span className="text-xs tabular-nums text-[#9aa3ab] line-through">₹{inr(p.mrp!)}</span>
              <span className="text-xs font-semibold text-[#4b6b16]">{off}% off</span>
            </>
          )}
        </div>

        <div className="mt-auto pt-3">
          {inStock ? (
            <button type="button" className={`${primaryButtonClass} w-full`} onClick={onMove} disabled={busy}>
              {busy ? 'Adding…' : 'Move to cart'}
            </button>
          ) : sold ? (
            <button type="button" className={`${secondaryButtonClass} w-full`} onClick={onNotify} disabled={busy || notified}>
              {notified ? "We'll email you" : busy ? 'Saving…' : 'Notify me'}
            </button>
          ) : (
            <p className="py-2 text-center text-xs text-[#74808a]">No longer sold</p>
          )}
        </div>
      </div>
    </li>
  );
}

function ProductImage({ src, dim }: { src?: string; dim: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="grid aspect-square place-items-center overflow-hidden bg-[#f6f7f9]">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl(src)}
          alt=""
          loading="lazy"
          className={`h-full w-full object-cover transition group-hover:scale-[1.02] ${dim ? 'opacity-60 grayscale' : ''}`}
          onError={() => setBroken(true)}
          // An image that failed before React attached onError (first paint) is caught here.
          ref={(el) => {
            if (el?.complete && el.naturalWidth === 0) setBroken(true);
          }}
        />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-[#c3cad0]" aria-hidden>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      )}
    </div>
  );
}

function Empty({ title, text, action }: { title: string; text: string; action: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#d5dbe0] bg-white px-6 py-12 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[#f3f4f2] text-[#59656f]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5" aria-hidden>
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[#252c32]">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-[13px] text-[#74808a]">{text}</p>
      <div className="mt-4 flex justify-center">{action}</div>
    </div>
  );
}
