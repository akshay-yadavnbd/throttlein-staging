import type { Metadata } from 'next';
import { buildStaticPageMetadata } from '@/lib/staticMeta';
import { API_URL, dataOf } from '@/lib/api';
import { SITE_URL } from '@/lib/siteUrl';
import FaqsPage from '@/components/pages/FaqsPage';
import JsonLd from '@/components/seo/JsonLd';

type FaqItem = { _id: string; question: string; answer: string };
type FaqSection = { _id: string; title: string; faqs: FaqItem[] };

// Admin can override at /pages -> FAQs via Edit meta.
export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    route: '/faqs',
    defaultTitle: 'FAQs - Throttlein',
    defaultDescription:
      'Find answers to common questions about shopping, selling, orders, returns, and everything Throttlein.',
  });
}

// SSR fetch — crawlers and social previewers see the full FAQ tree
// in the initial HTML, and we can emit a FAQPage JSON-LD blob that
// Google uses for rich results.
async function fetchSections(): Promise<FaqSection[]> {
  try {
    const r = await fetch(`${API_URL}/faqs`, { next: { revalidate: 60 } });
    if (!r.ok) return [];
    const d = dataOf(await r.json());
    return Array.isArray(d?.items) ? d.items : [];
  } catch {
    return [];
  }
}

/** Strip HTML tags from an answer so it lands clean inside JSON-LD,
 *  which expects plain text in the acceptedAnswer.text field. */
function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function Page() {
  const sections = await fetchSections();

  // Build FAQPage schema: every Q&A across every section becomes one
  // mainEntity entry, deduped on question text.
  const seenQs = new Set<string>();
  const mainEntity = sections.flatMap((s) =>
    s.faqs
      .filter((f) => {
        const k = f.question.trim().toLowerCase();
        if (seenQs.has(k)) return false;
        seenQs.add(k);
        return true;
      })
      .map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: stripHtml(f.answer),
        },
      })),
  );
  const faqJsonLd =
    mainEntity.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          url: `${SITE_URL}/faqs`,
          mainEntity,
        }
      : null;

  return (
    <>
      {faqJsonLd && <JsonLd data={faqJsonLd} />}
      <FaqsPage sections={sections} />
    </>
  );
}
