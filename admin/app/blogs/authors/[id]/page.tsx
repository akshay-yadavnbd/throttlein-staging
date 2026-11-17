'use client';

import { use, useEffect, useState } from 'react';
import AdminShell from '@/components/AdminShell';
import BlogAuthorForm from '@/components/BlogAuthorForm';
import { EditorPage, BackLink, EditorSkeleton } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { notifyError } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';

export default function EditAuthorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [author, setAuthor] = useState<any>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get(`/admin/blog/authors/${id}`)
      .then((r) => setAuthor(unwrap<{ author: any }>(r).author))
      .catch((e) => { notifyError(e, M.blogs.couldntLoadAuthor); setError(true); });
  }, [id]);

  return (
    <AdminShell>
      <EditorPage moduleKey="blogs">
        <BackLink href="/blogs/authors">Authors</BackLink>
        {author ? (
          <BlogAuthorForm mode="edit" id={author._id} initial={author} />
        ) : error ? (
          <div className={list.state}><h3>Author not found</h3><p>It may have been deleted, or the link is wrong.</p></div>
        ) : (
          <EditorSkeleton label="Loading author" />
        )}
      </EditorPage>
    </AdminShell>
  );
}
