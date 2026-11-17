import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { AdminFrame } from '@/components/AdminShell';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'THROTTLEIN Admin — Seller Management',
  description: 'Super-admin panel for THROTTLEIN: manage sellers and bike-accessory products.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* `data-theme="nude"` activates the HeroUI v3 token set in
       app/themes/nude.css. Applied at <html> because every page in this app
       is an admin surface — unlike the storefront app, where the theme is
       scoped to the dashboard subtree.

       `bg-brand-cream text-brand-black` stays on <body> for now: v2 pages
       still rely on it, and it's also set in globals.css. Both get replaced
       by `bg-background text-foreground` once the last v2 page is migrated;
       flipping it now would restyle 53 un-migrated pages at once. */
    <html lang="en" className={inter.variable} data-theme="nude">
      <body className={`${inter.className} bg-brand-cream text-brand-black`}>
        {/* One persistent workspace frame (sidebar, header, polling) for every
            admin section; sign-in screens bypass it. See AdminShell.tsx. */}
        <Providers><AdminFrame>{children}</AdminFrame></Providers>
      </body>
    </html>
  );
}
