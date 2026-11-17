import { redirect } from 'next/navigation';

// Legacy route — redirect to the new seller funnel.
// Inlined here (rather than going through a RegisterPage component) so
// the page's return type is `never`, which TypeScript accepts without
// flagging the missing JSX return.
export default function Page() {
  redirect('/seller/register');
}
