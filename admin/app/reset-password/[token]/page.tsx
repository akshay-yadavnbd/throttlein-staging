'use client';

/**
 * Admin / staff password reset — `/reset-password/<token>`.
 *
 * Lands here from the email link the backend mails when an admin user
 * requests a reset via /forgot-password. The form is shared with the
 * staff invite page (components/SetPasswordForm.tsx): the backend's
 * `/auth/reset-password/:token` handles both — it verifies the link, sets
 * the password and returns a fresh JWT so we sign the person in.
 */
import { Suspense, use } from 'react';
import SetPasswordForm from '@/components/SetPasswordForm';

type RouteProps = { params: Promise<{ token: string }> };

function ResetPasswordInner({ params }: RouteProps) {
  const { token } = use(params);
  return <SetPasswordForm token={token} mode="reset" />;
}

export default function ResetPasswordPage(props: RouteProps) {
  // `use(params)` can suspend on first render, and Next.js's static
  // prerender flow expects the boundary.
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner {...props} />
    </Suspense>
  );
}
