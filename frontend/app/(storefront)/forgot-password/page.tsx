import type { Metadata } from 'next';
import ForgotPasswordPage from '@/components/pages/ForgotPasswordPage';

export const metadata: Metadata = {
  title: 'Reset your password · THROTTLEIN',
  robots: { index: false, follow: false },
};

export default function Page(props: any) {
  return <ForgotPasswordPage {...props} />;
}
