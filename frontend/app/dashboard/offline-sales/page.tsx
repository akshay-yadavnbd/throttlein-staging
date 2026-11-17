import DashboardOfflineSalesPage from '@/components/pages/DashboardOfflineSalesPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Offline sales' };

export default function Page(props: any) {
  return <DashboardOfflineSalesPage {...props} />;
}
