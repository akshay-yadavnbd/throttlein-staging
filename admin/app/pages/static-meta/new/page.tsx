'use client';

/**
 * Static-meta creator — opened from the admin Pages list when an admin
 * clicks "Set meta" on a static route that doesn't have an override yet.
 *
 * Reads the route + title from query params (?route=/sell&title=Become%20a%20seller),
 * creates a Page record with type='static-meta', then redirects to the
 * regular editor where the admin fills in the meta fields.
 */

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminShell from '@/components/AdminShell';
import { EditorPage, BackLink, EditorSkeleton } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { notifyError, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';

function slugifyRoute(route: string) {
  return route
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'home';
}

/** The actual creator — uses `useSearchParams()` so it MUST live
 *  inside a Suspense boundary. */
function StaticMetaCreatorInner() {
  const router = useRouter();
  const search = useSearchParams();
  // Guard against React Strict Mode double-invocation creating two
  // duplicate Page rows on mount.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const route = search.get('route') || '';
    const title = search.get('title') || route || 'Untitled route';
    if (!route) {
      notifyWarning(M.pages.missingRouteStartFromThePagesList);
      router.replace('/pages');
      return;
    }
    (async () => {
      try {
        // Use a route-derived slug so we don't collide with any other
        // static-meta record. e.g. /sell → 'static-sell'.
        const slug = `static-${slugifyRoute(route)}`;
        const data = unwrap<{ page: { _id: string } }>(await api.post('/pages', {
          title,
          slug,
          type: 'static-meta',
          staticRoute: route,
          isPublished: true,
        }));
        router.replace(`/pages/static-meta/${data.page._id}`);
      } catch (e: any) {
        notifyError(e, M.pages.couldntCreateOverride);
        router.replace('/pages');
      }
    })();
  }, [router, search]);

  return <EditorSkeleton label="Setting up the search-appearance override" />;
}

export default function StaticMetaCreator() {
  // Suspense boundary required because the inner component calls
  // `useSearchParams()`, which forces a CSR bail-out during prerender.
  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages">All pages</BackLink>
        <Suspense fallback={<EditorSkeleton label="Setting up the search-appearance override" />}>
          <StaticMetaCreatorInner />
        </Suspense>
      </EditorPage>
    </AdminShell>
  );
}
