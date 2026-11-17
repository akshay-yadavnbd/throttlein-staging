'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Spinner } from '@heroui/react';
import ProductForm from '@/components/common/ProductForm';
import { api, envelopeOrLegacy } from '@/lib/api';

export default function DashboardProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [initial, setInitial] = useState<any>(null);

  useEffect(() => {
    // Seller-scoped: the public lookup hides products until KYC is approved.
    api.get(`/products/mine/${slug}`).then(envelopeOrLegacy).then(({ data }) => setInitial(data.product));
  }, [slug]);

  return (
    <>
      <div className="max-w-[1500px]">
        {/* Back pill, matching every other detail screen in both panels. */}
        <Link
          className="mb-4 inline-flex items-center gap-1.5 self-start rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground shadow-surface transition-colors hover:bg-surface-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          href="/dashboard/products"
        >
          <svg aria-hidden className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
            <line x1="19" x2="5" y1="12" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Products
        </Link>

        {/* Same weight as the Add page's heading — they were 2xl/3xl bold
            here and xl semibold there, so the two halves of one flow
            didn't match. "Update your listing." described the form. */}
        <h1 className="mb-4 text-xl font-semibold tracking-tight text-foreground">
          {initial?.name || 'Edit product'}
        </h1>

        {!initial ? (
          <div className="flex items-center gap-2 text-muted">
            <Spinner size="sm" /> Loading…
          </div>
        ) : (
          <ProductForm mode="edit" id={slug} initial={initial} />
        )}
      </div>
    </>
  );
}
