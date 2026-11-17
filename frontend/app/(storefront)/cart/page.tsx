import type { Metadata } from 'next';
import CartPage from '@/components/pages/CartPage';
import { buildStaticPageMetadata } from '@/lib/staticMeta';

// Per-user cart — never indexed. Admin can still override the title
// from /pages → Cart for clarity in browser tabs.
export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    route: '/cart',
    defaultTitle: 'Your cart · THROTTLEIN',
    defaultDescription: 'Your THROTTLEIN cart.',
    noindex: true,
  });
}

export default function Page(props: any) {
  return <CartPage {...props} />;
}
