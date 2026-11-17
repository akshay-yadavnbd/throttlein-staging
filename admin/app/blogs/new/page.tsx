'use client';

import AdminShell from '@/components/AdminShell';
import BlogForm from '@/components/BlogForm';
import { EditorPage, BackLink } from '@/components/EditorShell';

export default function NewBlogPage() {
  return (
    <AdminShell>
      <EditorPage moduleKey="blogs">
        <BackLink href="/blogs">All posts</BackLink>
        <BlogForm mode="create" />
      </EditorPage>
    </AdminShell>
  );
}
