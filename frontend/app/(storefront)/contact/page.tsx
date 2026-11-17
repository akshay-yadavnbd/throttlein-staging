import type { Metadata } from 'next';
import { buildStaticPageMetadata } from '@/lib/staticMeta';
import ContactPage from '@/components/pages/ContactPage';
import JsonLd from '@/components/seo/JsonLd';
import { contactPageSchema } from '@/lib/jsonLd';

/**
 * SEO metadata — admin can override at /pages → Contact Us via Edit meta.
 * Falls back to the hardcoded defaults below when no override exists.
 */
export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    route: '/contact',
    defaultTitle: 'Contact Throttlein — Support, Sellers & Help',
    defaultDescription:
      'Get in touch with Throttlein for help with orders, returns, payments, seller accounts and more. Our team responds within 24 business hours.',
  });
}

export default function Page() {
  return (
    <>
      <JsonLd data={contactPageSchema()} />
      <ContactPage />
    </>
  );
}
