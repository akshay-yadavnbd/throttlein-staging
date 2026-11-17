import DashboardProductNewPage from '@/components/pages/DashboardProductNewPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'New product' };

export default function Page(props: any) {
  return <DashboardProductNewPage {...props} />;
}
