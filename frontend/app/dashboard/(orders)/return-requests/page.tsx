import DashboardReturnRequestsPage from '@/components/pages/DashboardReturnRequestsPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Returns & exchanges' };

export default function Page(props: any) {
  return <DashboardReturnRequestsPage {...props} />;
}
