import AdminSignIn from '@/components/AdminSignIn';

/**
 * Staff login — `/staff/login`.
 *
 * A dedicated address for internal teammates (easy to bookmark and to
 * send over email/Slack). Same POST /auth/login as /login, but only `staff`
 * accounts continue; a super-admin is pointed to /login. Sellers and
 * customers have their own sign-in pages on the storefront.
 */
export default function StaffLoginPage() {
  return <AdminSignIn audience="staff" />;
}
