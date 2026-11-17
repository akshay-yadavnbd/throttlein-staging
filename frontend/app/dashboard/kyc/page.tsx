import DashboardKycPage from '@/components/pages/DashboardKycPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Verification' };

export default function Page(props: any) {
  return <DashboardKycPage {...props} />;
}
