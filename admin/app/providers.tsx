'use client';

import { HeroUIProvider } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { Toaster } from 'react-hot-toast';
import ConfirmProvider from '@/components/ConfirmProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  // HeroUI items with an `href` render plain <a> tags; without `navigate`
  // they rely on the browser following that <a>, which races a menu closing
  // on mouse-up (the storefront account menu sometimes went nowhere). With
  // it, react-aria calls router.push itself. External links stay native.
  const router = useRouter();
  return (
    <HeroUIProvider navigate={router.push}>
      {/* Workspace-panel look; wording comes from lib/notify (never raw API text). */}
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
