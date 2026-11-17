import DashboardOfferFormPage from '@/components/pages/DashboardOfferFormPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'New offer' };

export default function Page() {
  return <DashboardOfferFormPage mode="create" />;
}
