import DashboardMediaPage from '@/components/pages/DashboardMediaPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Media' };

export default function Page(props: any) {
  return <DashboardMediaPage {...props} />;
}
