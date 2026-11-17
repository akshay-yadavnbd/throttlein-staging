import DashboardProductsPage from '@/components/pages/DashboardProductsPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Products' };

export default function Page(props: any) {
  return <DashboardProductsPage {...props} />;
}
