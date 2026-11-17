import type { Metadata } from 'next';
import SellerRegisterPage from '@/components/pages/SellerRegisterPage';
import { buildStaticPageMetadata } from '@/lib/staticMeta';

/**
 * Seller signup — public URL `seller.throttlein.com/register`.
 *
 * Kept `noindex` (it already was), because the indexable entry point for
 * the funnel is the landing page at `/`; letting the bare form compete
 * with it just splits the ranking. Title and description are still
 * editable, for share previews.
 *
 * Editable from Admin → (switch to Seller) → Pages → "Seller signup".
 * Promoted from a static `metadata` export to `generateMetadata` so the
 * CMS override can be read at request time.
 */
export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    site: 'seller',
    route: '/register',
    defaultTitle: 'Become a seller · THROTTLEIN',
    defaultDescription:
      'Create your THROTTLEIN seller account — zero setup fee and a 24-hour go-live.',
    siteName: 'THROTTLEIN Sellers',
    noindex: true,
  });
}

export default function Page(props: any) {
  return <SellerRegisterPage {...props} />;
}
