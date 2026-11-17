import DashboardOffersPage from '@/components/pages/DashboardOffersPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Offers' };

export default function Page(props: any) {
  return <DashboardOffersPage {...props} />;
}
