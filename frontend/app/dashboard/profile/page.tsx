import DashboardProfilePage from '@/components/pages/DashboardProfilePage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Profile' };

export default function Page(props: any) {
  return <DashboardProfilePage {...props} />;
}
