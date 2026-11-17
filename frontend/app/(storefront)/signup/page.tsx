import type { Metadata } from 'next';
import SignupPage from '@/components/pages/SignupPage';
import { buildStaticPageMetadata } from '@/lib/staticMeta';

// Auth landing — never indexed. Admin can override the title via /pages.
export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    route: '/signup',
    defaultTitle: 'Sign up · THROTTLEIN',
    defaultDescription: 'Create a THROTTLEIN account.',
    noindex: true,
  });
}

export default function Page(props: any) {
  return <SignupPage {...props} />;
}
