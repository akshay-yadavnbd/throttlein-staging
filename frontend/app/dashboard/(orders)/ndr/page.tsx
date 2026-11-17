import DashboardNdrPage from '@/components/pages/DashboardNdrPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Delivery issues' };

export default function Page(props: any) {
  return <DashboardNdrPage {...props} />;
}
