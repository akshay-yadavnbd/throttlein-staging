import DashboardBrandsCategoriesPage from '@/components/pages/DashboardBrandsCategoriesPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Brands & categories' };

export default function Page(props: any) {
  return <DashboardBrandsCategoriesPage {...props} />;
}
