import type { Metadata } from 'next';
import SellerVerifyPage from '@/components/pages/SellerVerifyPage';

// Tokenised verification URL — must never be indexed.
export const metadata: Metadata = {
  title: 'Verify your seller account · THROTTLEIN',
  robots: { index: false, follow: false },
};

export default function Page(props: any) {
  return <SellerVerifyPage {...props} />;
}
