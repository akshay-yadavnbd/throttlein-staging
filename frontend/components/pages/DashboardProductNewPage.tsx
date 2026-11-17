'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardBody } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import { DetailSkeleton } from '@/components/ui';
import ProductForm from '@/components/common/ProductForm';
import styles from './DashboardProducts.module.css';
import { useKycStatus } from '@/lib/kyc';

export default function DashboardProductNewPage() {
  const router = useRouter();
  const { kyc, accountStatus, fullyApproved, loading } = useKycStatus();

  // Deliberate design choice: NO auto-redirect. Earlier versions of
  // this page bounced the seller to /dashboard/kyc after 2.2s, which
  // felt jarring and hid the "here's what to do while you wait" tips.
  // The gate card below now lets the seller stay, read the progress
  // stepper, and choose when to move on via the primary CTA.
  //
  // `router` is intentionally kept in the destructure above so future
  // programmatic navigation from the CTAs stays trivial to wire.
  void router;

  if (loading) {
    return (
      <>
        <DetailSkeleton cards={1} rows={2} />
      </>
    );
  }

  if (!fullyApproved) {
    // ─── State variants ────────────────────────────────────────────
    // Each variant carries its full copy + the palette that stains the
    // hero icon, chip, and CTA. `stepIndex` is the highlighted node in
    // the progress stepper (Submit → Review → Verify → List).
    type Palette = {
      icon: string;        // bg for the hero circle
      iconRing: string;    // outer soft ring
      iconFg: string;      // stroke color of the SVG
      chipBg: string;
      chipText: string;
      ctaColor: 'warning' | 'primary' | 'danger' | 'success';
    };
    type CopyVariant = {
      title: string;
      subtitle: string;
      body: string;
      cta: string;
      href: string;
      icon: 'lock' | 'clock' | 'alert' | 'check' | 'ban';
      palette: Palette;
      stepIndex: 0 | 1 | 2 | 3;
      chipLabel: string;
    };

    const AMBER: Palette = { icon: 'bg-amber-50', iconRing: 'ring-amber-100/60', iconFg: 'text-amber-600', chipBg: 'bg-amber-100', chipText: 'text-amber-800', ctaColor: 'warning' };
    const BLUE:  Palette = { icon: 'bg-blue-50',  iconRing: 'ring-blue-100/60',  iconFg: 'text-blue-600',  chipBg: 'bg-blue-100',  chipText: 'text-blue-800',  ctaColor: 'primary' };
    const RED:   Palette = { icon: 'bg-red-50',   iconRing: 'ring-red-100/60',   iconFg: 'text-red-600',   chipBg: 'bg-red-100',   chipText: 'text-red-800',   ctaColor: 'danger'  };
    const EMER:  Palette = { icon: 'bg-emerald-50', iconRing: 'ring-emerald-100/60', iconFg: 'text-emerald-600', chipBg: 'bg-emerald-100', chipText: 'text-emerald-800', ctaColor: 'success' };

    const copyMap: Record<string, CopyVariant> = {
      not_started: {
        title: 'Complete your KYC to start listing',
        subtitle: "You're one submission away from selling",
        body: 'We need your GST, PAN and pickup address before you can list products. It takes about 5 minutes to fill in, and our team verifies within 24-48 hours.',
        cta: 'Complete KYC',
        href: '/dashboard/kyc',
        icon: 'lock',
        palette: AMBER,
        stepIndex: 0,
        chipLabel: 'Action needed',
      },
      pending: {
        title: 'Your KYC is under review',
        subtitle: "We're checking your documents",
        body: 'Documents typically take 24-48 hours to verify. We\'ll email you the moment it\'s done — you don\'t need to keep this page open.',
        cta: 'View submission',
        href: '/dashboard/kyc',
        icon: 'clock',
        palette: BLUE,
        stepIndex: 1,
        chipLabel: 'In review',
      },
      rejected: {
        title: 'KYC needs an update',
        subtitle: 'A quick fix and you\'re back on track',
        body: kyc.rejectionReason || 'Your last KYC submission was rejected. Open it to see what our team flagged and resubmit — most fixes take under two minutes.',
        cta: 'Update & resubmit',
        href: '/dashboard/kyc',
        icon: 'alert',
        palette: RED,
        stepIndex: 1,
        chipLabel: 'Needs changes',
      },
      awaiting_activation: {
        title: 'KYC verified — activating your store',
        subtitle: 'Almost there',
        body: 'Your documents are approved. Our team is putting the final touches on your seller account. You\'ll get an email the moment listing unlocks — usually within a few hours.',
        cta: 'Back to dashboard',
        href: '/dashboard',
        icon: 'check',
        palette: EMER,
        stepIndex: 2,
        chipLabel: 'Almost there',
      },
      suspended: {
        title: 'Your account is suspended',
        subtitle: 'Listing is paused',
        body: 'Selling is paused on this account. Reach out to our team and we\'ll walk you through what\'s needed to reactivate.',
        cta: 'Contact support',
        href: 'mailto:support@throttlein.in',
        icon: 'ban',
        palette: RED,
        stepIndex: 3,
        chipLabel: 'Suspended',
      },
    };
    let key: keyof typeof copyMap = 'not_started';
    if (kyc.status !== 'approved') key = kyc.status;
    else if (accountStatus === 'suspended') key = 'suspended';
    else key = 'awaiting_activation';
    const c = copyMap[key];
    const p = c.palette;

    // Hero icon glyph — chosen by variant. Kept inline instead of a
    // separate component so the file stays flat.
    function renderHeroIcon() {
      const common = { width: 40, height: 40, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
      if (c.icon === 'lock') return (
        <svg {...common}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      );
      if (c.icon === 'clock') return (
        <svg {...common}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      );
      if (c.icon === 'alert') return (
        <svg {...common}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
      );
      if (c.icon === 'check') return (
        <svg {...common}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
      );
      // ban
      return (
        <svg {...common}><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
      );
    }

    const STEPS = [
      { label: 'Submit KYC', hint: 'GST, PAN, pickup address' },
      { label: 'Under review', hint: 'Our team verifies your docs' },
      { label: 'Store activation', hint: 'Final approval by admin' },
      { label: 'Start listing', hint: 'Your storefront goes live' },
    ];

    return (
      <>
        <div className="max-w-6xl mx-auto">
          {/* Breadcrumb */}
          <nav className="text-xs text-muted mb-4">
            <Link href="/dashboard" className="hover:text-foreground">Dashboard</Link>
            <span className="mx-1.5">/</span>
            <span className="text-foreground font-medium">Add product</span>
          </nav>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ── Main card (2/3 width) ─────────────────────────────── */}
            <div className="lg:col-span-2">
              <Card className="border border-border shadow-sm overflow-hidden">
                <CardBody className="p-0">
                  {/* Header strip — soft colored band with icon + chip */}
                  <div className={`px-8 py-8 ${p.icon.replace('bg-', 'bg-').replace('50', '50/50')} border-b border-border`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className={`w-20 h-20 rounded-2xl ${p.icon} ${p.iconFg} grid place-items-center ring-8 ${p.iconRing} shrink-0`}>
                        {renderHeroIcon()}
                      </div>
                      <span className={`inline-flex items-center h-6 px-3 rounded-full text-xs font-semibold ${p.chipBg} ${p.chipText}`}>
                        {c.chipLabel}
                      </span>
                    </div>
                    <div className="text-xs uppercase tracking-[0.22em] font-semibold text-muted mt-6">
                      {c.subtitle}
                    </div>
                    <h1 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                      {c.title}
                    </h1>
                    <p className="mt-3 text-muted leading-relaxed max-w-2xl">{c.body}</p>
                  </div>

                  {/* Progress stepper */}
                  <div className="px-8 py-6">
                    <div className="text-xs uppercase tracking-[0.22em] font-semibold text-muted mb-4">
                      Your journey to going live
                    </div>
                    <ol className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {STEPS.map((s, i) => {
                        const isCurrent = i === c.stepIndex;
                        const isComplete = i < c.stepIndex;
                        const isFuture = i > c.stepIndex;
                        return (
                          <li key={s.label} className="flex flex-col items-start gap-2">
                            <div className="flex items-center gap-2 w-full">
                              <div className={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold ${
                                isComplete
                                  ? 'bg-emerald-600 text-white'
                                  : isCurrent
                                  ? `${p.chipBg.replace('100', '600')} text-white ring-4 ${p.chipBg.replace('100', '100/60')}`
                                  : 'bg-surface-tertiary text-muted'
                              }`}>
                                {isComplete ? (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                ) : (
                                  i + 1
                                )}
                              </div>
                              {i < STEPS.length - 1 && (
                                <div className={`flex-1 h-[2px] ${isComplete ? 'bg-emerald-600' : 'bg-surface-tertiary'}`} aria-hidden />
                              )}
                            </div>
                            <div className={`text-xs font-semibold ${isFuture ? 'text-muted' : 'text-foreground'}`}>
                              {s.label}
                            </div>
                            <div className="text-xs text-muted leading-tight">{s.hint}</div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>

                  {/* Actions */}
                  <div className="px-8 pb-8 pt-2 flex flex-wrap items-center gap-3">
                    <Link href={c.href}>
                      <Button color={p.ctaColor} size="lg" className="font-semibold">
                        {c.cta} →
                      </Button>
                    </Link>
                    <Link href="/dashboard">
                      <Button variant="bordered" size="lg" className="font-semibold border-2">
                        Back to dashboard
                      </Button>
                    </Link>
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* ── Sidebar (1/3 width) ───────────────────────────────── */}
            <div className="flex flex-col gap-4">
              {/* "While you wait" prep tasks */}
              <Card className="border border-border shadow-sm">
                <CardBody className="p-6">
                  <div className="text-xs uppercase tracking-[0.22em] font-semibold text-muted mb-1">
                    While you wait
                  </div>
                  <div className="text-base font-semibold text-foreground mb-3">Get ready to go live</div>
                  <ul className="flex flex-col gap-3 text-sm">
                    <li className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-surface-tertiary text-muted grid place-items-center text-xs font-bold shrink-0">1</span>
                      <div>
                        <Link href="/dashboard/media" className="font-semibold text-foreground hover:underline">
                          Upload product photos
                        </Link>
                        <div className="text-xs text-muted mt-0.5">
                          Drop product images into your Media library so they're ready to attach the moment you can list.
                        </div>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-surface-tertiary text-muted grid place-items-center text-xs font-bold shrink-0">2</span>
                      <div>
                        <Link href="/dashboard/brands-categories" className="font-semibold text-foreground hover:underline">
                          Review categories & brands
                        </Link>
                        <div className="text-xs text-muted mt-0.5">
                          Confirm the categories that match your catalog so listings land in the right filters.
                        </div>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-surface-tertiary text-muted grid place-items-center text-xs font-bold shrink-0">3</span>
                      <div>
                        <Link href="/dashboard/profile" className="font-semibold text-foreground hover:underline">
                          Complete your store profile
                        </Link>
                        <div className="text-xs text-muted mt-0.5">
                          Set your return / exchange defaults and pickup contact so orders can ship the moment they land.
                        </div>
                      </div>
                    </li>
                  </ul>
                </CardBody>
              </Card>

              {/* Help card */}
              <Card className="border border-border shadow-sm bg-accent text-accent-foreground">
                <CardBody className="p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <div className="text-sm font-semibold">Need help?</div>
                  </div>
                  <p className="text-xs text-white/70 leading-relaxed mb-3">
                    Stuck on a document, or think this is taking longer than it should? Our team responds within a few business hours.
                  </p>
                  <a
                    href="mailto:support@throttlein.in"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-white hover:underline"
                  >
                    Email support@throttlein.in →
                  </a>
                </CardBody>
              </Card>

              {/* Small tip card */}
              <Card className="border border-border shadow-sm bg-surface-tertiary/60">
                <CardBody className="p-5">
                  <div className="text-xs uppercase tracking-[0.22em] font-semibold text-muted mb-1">
                    Tip
                  </div>
                  <div className="text-xs text-foreground leading-relaxed">
                    You don't need to keep this page open — we'll email <span className="font-semibold text-foreground">the moment</span> your account activates and you can start listing.
                  </div>
                </CardBody>
              </Card>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.editor}>
        {/* Back pill, matching every other detail screen in both panels. */}
        <Link
          className={styles.back}
          href="/dashboard/products"
        >
          <svg aria-hidden className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
            <line x1="19" x2="5" y1="12" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to products
        </Link>

        {/* Heading only. This was a ~190px dark striped hero with an icon
            tile, a "CATALOG · NEW LISTING" eyebrow and a three-line blurb —
            above a page whose shell header and highlighted sidebar entry
            both already read "Add Product". */}
        <h1 className="sr-only">Add a product</h1>

        <ProductForm mode="create" />
      </div>
    </>
  );
}
