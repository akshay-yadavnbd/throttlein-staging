import AdminSignIn from '@/components/AdminSignIn';

/** `/login` — super-admins and staff (components/AdminSignIn.tsx). */
export default function LoginPage() {
  return <AdminSignIn audience="admin" />;
}
