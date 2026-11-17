/**
 * The customer account's links, in one place: the account sidebar and
 * phone tab strip (CustomerShell) and the header's account dropdown
 * (Navbar) all render this list, so their labels, order and icons can't
 * drift apart. Icons share one 24px grid and stroke so rows line up.
 */
type IconProps = { className?: string };

function Svg({ className = 'w-[18px] h-[18px]', children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function OverviewIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="15" width="7" height="6" rx="1.5" />
    </Svg>
  );
}
export function OrdersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.3 7 12 12l8.7-5M12 22V12" />
    </Svg>
  );
}
export function WishlistIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
    </Svg>
  );
}
export function AddressIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 22s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  );
}
export function ProfileIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </Svg>
  );
}
export function CartLineIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 7h13l-1.5 9H7.5L6 7z" />
      <path d="M6 7 4.5 3H2" />
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="17" cy="20" r="1.5" />
    </Svg>
  );
}
export function SignOutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </Svg>
  );
}

export type AccountLink = { href: string; label: string; Icon: (p: IconProps) => React.ReactElement; exact?: boolean };

/** The account's own pages, in sidebar order. The cart sits apart (it isn't under /account). */
export const ACCOUNT_LINKS: AccountLink[] = [
  { href: '/account', label: 'Overview', Icon: OverviewIcon, exact: true },
  { href: '/account/orders', label: 'Orders', Icon: OrdersIcon },
  { href: '/account/wishlist', label: 'Wishlist', Icon: WishlistIcon },
  { href: '/account/addresses', label: 'Addresses', Icon: AddressIcon },
  { href: '/account/profile', label: 'Profile', Icon: ProfileIcon },
];
export const CART_LINK: AccountLink = { href: '/cart', label: 'Cart', Icon: CartLineIcon };

export const isAccountLinkActive = (link: AccountLink, pathname: string) =>
  link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
