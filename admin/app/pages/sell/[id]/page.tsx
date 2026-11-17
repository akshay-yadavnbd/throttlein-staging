'use client';

/**
 * /pages/sell/<id> — edit an existing Seller Guide. Fetches the guide by
 * ObjectId via the admin-only /seller-guides/id/:id endpoint, then hands
 * the data to SellerGuideForm in 'edit' mode.
 */

import { use, useEffect, useState } from 'react';
import AdminShell from '@/components/AdminShell';
import SellerGuideForm from '@/components/SellerGuideForm';
import { EditorPage, BackLink, EditorSkeleton } from '@/components/EditorShell';
import { api } from '@/lib/api';
import { notifyError } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';

export default function EditSellerGuidePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [guide, setGuide] = useState<any>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get(`/seller-guides/id/${id}`)
      .then(({ data }) => setGuide(data.guide))
      .catch((e) => { notifyError(e, M.pages.couldntLoadGuide); setError(true); });
  }, [id]);

  return (
    <AdminShell>
      <EditorPage moduleKey="pages">
        <BackLink href="/pages/sell">Seller home</BackLink>
        {guide ? (
          <SellerGuideForm mode="edit" initial={guide} id={guide._id} />
        ) : error ? (
          <div className={list.state}><h3>Guide not found</h3><p>It may have been deleted, or the link is wrong.</p></div>
        ) : (
          <EditorSkeleton label="Loading guide" />
        )}
      </EditorPage>
    </AdminShell>
  );
}
