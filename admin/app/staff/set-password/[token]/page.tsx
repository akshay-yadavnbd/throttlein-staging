'use client';

/**
 * Staff invitation landing page — `/staff/set-password/<token>`.
 *
 * An invitee clicks the link in their invitation email and lands here to
 * pick a password. The form (components/SetPasswordForm.tsx) posts to
 * `/auth/reset-password/:token` — the same endpoint as forgot-password —
 * which verifies the token (7-day TTL from `generateInviteToken`), sets
 * the password and signs them in, so they land on /dashboard with the
 * sidebar already filtered by their permissions.
 *
 * Tokens are one-use. If the link is lost or expired, the superadmin can
 * resend it from the Staff list.
 */
import { Suspense, use } from 'react';
import SetPasswordForm from '@/components/SetPasswordForm';

type RouteProps = { params: Promise<{ token: string }> };

function StaffSetPasswordInner({ params }: RouteProps) {
  const { token } = use(params);
  return <SetPasswordForm token={token} mode="invite" />;
}

export default function StaffSetPasswordPage(props: RouteProps) {
  return (
    <Suspense fallback={null}>
      <StaffSetPasswordInner {...props} />
    </Suspense>
  );
}
