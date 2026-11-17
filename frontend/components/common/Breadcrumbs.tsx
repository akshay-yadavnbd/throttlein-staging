import Link from 'next/link';

export type Crumb = {
  label: string;
  /** Omit href on the current (last) page — rendered dark, unlinked. */
  href?: string;
};

/**
 * Storefront breadcrumb strip — the canonical style from the products
 * page (Figma 3035:7194): full-width white bar, 1px #eee bottom border,
 * Poppins Medium 14px. "Home" + intermediate crumbs + separators are
 * tertiary #7e746e, the current page label is primary #1a1410.
 *
 * Use this on every storefront page so the trail looks identical
 * site-wide:
 *
 *   <Breadcrumbs items={[{ label: 'Brands', href: '/brands' }, { label: brand.name }]} />
 *
 * "Home" is prepended automatically.
 */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <div className="border-b border-[#eeeeee] bg-white">
      <div className="container py-3">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 font-poppins text-[14px] font-medium leading-none flex-wrap"
        >
          <Link href="/" className="text-[#7e746e] hover:text-[#1a1410] transition">
            Home
          </Link>
          {items.map((c, i) => (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1">
              <span className="text-[#7e746e] mx-1" aria-hidden>/</span>
              {c.href ? (
                <Link href={c.href} className="text-[#7e746e] hover:text-[#1a1410] transition">
                  {c.label}
                </Link>
              ) : (
                <span className="text-[#1a1410]">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>
    </div>
  );
}
