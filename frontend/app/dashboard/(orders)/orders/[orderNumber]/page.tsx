import DashboardOrderDetailPage from '@/components/pages/DashboardOrderDetailPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Order' };

export default function Page(props: any) {
  return <DashboardOrderDetailPage {...props} />;
}
