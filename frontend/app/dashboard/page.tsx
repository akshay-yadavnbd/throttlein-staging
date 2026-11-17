import DashboardHomePage from '@/components/pages/DashboardHomePage';

/** Tab title. Full string here: a layout's title template applies to CHILD
    segments only, not to the page in its own segment (UX audit S12). */
export const metadata = { title: 'Overview · Seller portal' };

export default function Page(props: any) {
  return <DashboardHomePage {...props} />;
}
