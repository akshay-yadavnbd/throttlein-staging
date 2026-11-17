import DashboardReturnRequestDetailPage from '@/components/pages/DashboardReturnRequestDetailPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Return request' };

export default function Page(props: any) {
  return <DashboardReturnRequestDetailPage {...props} />;
}
