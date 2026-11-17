import type { Metadata } from 'next';
import SellerLoginPage from '@/components/pages/SellerLoginPage';
import { buildStaticPageMetadata } from '@/lib/staticMeta';

/**
 * Seller login — public URL `seller.throttlein.com/login`.
 *
 * `noindex` stays on: there's nothing here for a search engine. The
 * title is still worth making editable, because it shows in browser
 * tabs, bookmarks and link previews when someone shares the sign-in URL
 * with a prospective seller.
 *
 * Editable from Admin → (switch to Seller) → Pages → "Seller login".
 * Promoted from a static `metadata` export to `generateMetadata` so the
 * CMS override can be read at request time.
 */
export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    site: 'seller',
    route: '/login',
    defaultTitle: 'Seller login · THROTTLEIN',
    defaultDescription: 'Sign in to your THROTTLEIN seller account.',
    siteName: 'THROTTLEIN Sellers',
    noindex: true,
  });
}

export default function Page(props: any) {
  return <SellerLoginPage {...props} />;
}
