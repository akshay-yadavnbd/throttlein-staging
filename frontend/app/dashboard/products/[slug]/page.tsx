import DashboardProductDetailPage from '@/components/pages/DashboardProductDetailPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Edit product' };

export default function Page(props: any) {
  return <DashboardProductDetailPage {...props} />;
}
