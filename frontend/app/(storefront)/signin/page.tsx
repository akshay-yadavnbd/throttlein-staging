import type { Metadata } from 'next';
import SigninPage from '@/components/pages/SigninPage';
import { buildStaticPageMetadata } from '@/lib/staticMeta';

// Auth landing — never indexed. Admin can override the title via /pages.
export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    route: '/signin',
    defaultTitle: 'Sign in · THROTTLEIN',
    defaultDescription: 'Sign in to your THROTTLEIN account.',
    noindex: true,
  });
}

export default function Page(props: any) {
  return <SigninPage {...props} />;
}
