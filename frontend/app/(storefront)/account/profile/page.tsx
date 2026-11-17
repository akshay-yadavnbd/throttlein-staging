import AccountProfilePage from '@/components/pages/AccountProfilePage';

// Account pages are personalised per logged-in user — there's nothing
// to statically prerender, and the global Navbar uses
// `useSearchParams()` which forces a CSR bail-out in Next 15. Marking
// the route dynamic skips the static prerender step and avoids the
// "useSearchParams() should be wrapped in a suspense boundary" error.
export const dynamic = 'force-dynamic';

export default function Page(props: any) {
  return <AccountProfilePage {...props} />;
}
