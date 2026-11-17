'use client';

import { HeroUIProvider } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { Toaster } from 'react-hot-toast';
import ConfirmProvider from '@/components/common/ConfirmProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  // HeroUI items with an `href` (e.g. the account dropdown) render plain <a>
  // tags. Without `navigate` they rely on the browser following that <a>,
  // which races the menu closing on mouse-up: sometimes the element is gone
  // before the click lands and the user stays on the same page. With it,
  // react-aria calls router.push itself — reliable, and a client-side
  // transition instead of a full reload. External links still open natively.
  const router = useRouter();
  return (
    <HeroUIProvider navigate={router.push}>
      {/* Workspace-panel look; wording comes from lib/messages via lib/notify (never raw API text). */}
      <Toaster
        position="top-right"
        gutter={10}
        containerStyle={{ top: 20, right: 20 }}
        toastOptions={{
          style: {
            maxWidth: 380, padding: '12px 14px', borderRadius: 10, border: '1px solid #e3e7eb',
            background: '#fff', color: '#252c32', fontSize: 13, lineHeight: 1.5,
            boxShadow: '0 10px 30px rgb(25 29 33 / 12%)',
          },
          success: { iconTheme: { primary: '#4f7a1e', secondary: '#fff' } },
          error: { iconTheme: { primary: '#b44848', secondary: '#fff' } },
        }}
      />
      <ConfirmProvider />
      {children}
    </HeroUIProvider>
  );
}
