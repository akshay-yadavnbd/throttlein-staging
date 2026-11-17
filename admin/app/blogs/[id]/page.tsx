'use client';

import { use, useEffect, useState } from 'react';
import AdminShell from '@/components/AdminShell';
import BlogForm from '@/components/BlogForm';
import { EditorPage, BackLink, EditorSkeleton } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { notifyError } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';

export default function EditBlogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [post, setPost] = useState<any>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get(`/admin/blog/${id}`)
      .then((r) => setPost(unwrap<{ post: any }>(r).post))
      .catch((e) => { notifyError(e, M.blogs.couldntLoadPost); setError(true); });
  }, [id]);

  return (
    <AdminShell>
      <EditorPage moduleKey="blogs">
        <BackLink href="/blogs">All posts</BackLink>
        {post ? (
          <BlogForm mode="edit" initial={post} id={post._id} />
        ) : error ? (
          <div className={list.state}><h3>Post not found</h3><p>It may have been deleted, or the link is wrong.</p></div>
        ) : (
          <EditorSkeleton label="Loading post" />
        )}
      </EditorPage>
    </AdminShell>
  );
}
