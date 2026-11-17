import type { Metadata } from 'next';
import ResetPasswordPage from '@/components/pages/ResetPasswordPage';

// One-shot tokenised URL — must never end up in Google's index even if
// a customer pastes it somewhere by accident.
export const metadata: Metadata = {
  title: 'Set a new password · THROTTLEIN',
  robots: { index: false, follow: false },
};

export default function Page(props: any) {
  return <ResetPasswordPage {...props} />;
}
