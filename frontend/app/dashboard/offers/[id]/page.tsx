import DashboardOfferFormPage from '@/components/pages/DashboardOfferFormPage';

/** Tab title — the layout's template appends " · Seller portal" (UX audit S12). */
export const metadata = { title: 'Edit offer' };

// Next.js 15 made `params` a Promise on server route pages, so a
// synchronous destructure fails the type check. Await it.
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DashboardOfferFormPage mode="edit" id={id} />;
}
