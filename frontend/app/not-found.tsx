/**
 * GLOBAL 404 boundary — reached only by URLs that match no route at all
 * (e.g. an unknown multi-segment path like /a/b/c on the main host).
 * Single-segment misses never land here: they're caught by the
 * storefront group's [slug] catch-all, whose notFound() renders
 * app/(storefront)/not-found.tsx INSIDE the storefront layout (with
 * Navbar + Footer). Seller-host misses go through the seller catch-all
 * to app/seller/not-found.tsx.
 *
 * Because this file sits ABOVE the (storefront) route group, the group
 * layout doesn't wrap it — so the chrome is composed explicitly here to
 * keep the rare global 404 looking like the storefront one.
 */

import Navbar from '@/components/common/Navbar';
import Footer from '@/components/common/Footer';
import NotFoundContent, { metadata } from './(storefront)/not-found';

export { metadata };

export default function GlobalNotFound() {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        <NotFoundContent />
      </main>
      <Footer />
    </>
  );
}
