import DashboardOrdersPage from '@/components/pages/DashboardOrdersPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Orders' };

export default function Page(props: any) {
  return <DashboardOrdersPage {...props} />;
}
