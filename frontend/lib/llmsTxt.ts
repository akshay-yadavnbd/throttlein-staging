import { dataOf } from './api';
/**
 * Shared builder for `llms.txt`.
 *
 * llms.txt is a convention (llmstxt.org) for handing an LLM a compact,
 * curated map of a site instead of making it crawl and guess. The format
 * is plain Markdown with a fixed shape:
 *
 *   # Title
 *   > one-paragraph summary
 *   ## Section
 *   - [Name](absolute-url): short description
 *
 * Both properties emit one, from their own origin, listing only their own
 * content — same separation the sitemaps keep, and for the same reason:
 * a model that learns seller URLs from the storefront file (or the
 * reverse) will cite the wrong host.
 *
 * Everything is generated from live API data rather than hand-written.
 * The previous static `public/llms.txt` had drifted far enough that six
 * of its eight category links pointed at slugs that now 308-redirect —
 * exactly the kind of rot a hand-maintained file accumulates silently.
 */

export type LlmsLink = {
  name: string;
  /** Absolute URL. Callers prepend the origin for their own property. */
  url: string;
  description?: string;
};

export type LlmsSection = {
  heading: string;
  links: LlmsLink[];
  /** Optional prose under the heading, before the bullets. */
  note?: string;
};

/** Shared fetch: never throws, never blocks a response on a dead API. */
export async function safeFetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return dataOf(await res.json());
  } catch {
    return null;
  }
}

/**
 * Flatten a description to a single tidy line.
 *
 * Descriptions come from CMS fields that may contain newlines, doubled
 * spaces or (in `seoDescription`) a sentence already trimmed for SERPs.
 * A newline mid-bullet would break the list, so they're collapsed and
 * capped rather than passed through.
 */
function oneLine(text: string | undefined, max = 160): string {
  const flat = String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';
  if (flat.length <= max) return flat;
  // Cut at a word boundary so the line doesn't end mid-word.
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:\s]+$/, '')}…`;
}

/** `[` and `]` in link text would terminate the Markdown link early. */
function escapeLinkText(text: string): string {
  return String(text || '').replace(/[[\]]/g, '');
}

function renderLink(link: LlmsLink): string {
  const desc = oneLine(link.description);
  const base = `- [${escapeLinkText(link.name)}](${link.url})`;
  return desc ? `${base}: ${desc}` : base;
}

/**
 * Assemble the document. Sections with no links are dropped rather than
 * emitted empty — a heading with nothing under it tells a model the area
 * exists but is barren, which is worse than staying quiet about it.
 */
export function buildLlmsTxt(opts: {
  title: string;
  summary: string;
  sections: LlmsSection[];
}): string {
  const parts: string[] = [`# ${opts.title}`, ''];

  // Summary as a blockquote, one `>` per line, per the convention.
  parts.push(
    ...opts.summary
      .trim()
      .split('\n')
      .map((l) => `> ${l.trim()}`),
    '',
  );

  for (const section of opts.sections) {
    if (!section.links.length && !section.note) continue;
    parts.push(`## ${section.heading}`, '');
    if (section.note) parts.push(section.note.trim(), '');
    if (section.links.length) {
      parts.push(...section.links.map(renderLink), '');
    }
  }

  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Standard response headers — matches the sitemap/robots handlers. */
export const LLMS_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'public, max-age=0, s-maxage=3600',
};
