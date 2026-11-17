'use client';

import AdminShell from '@/components/AdminShell';
import BlogAuthorForm from '@/components/BlogAuthorForm';
import { EditorPage, BackLink } from '@/components/EditorShell';

export default function NewAuthorPage() {
  return (
    <AdminShell>
      <EditorPage moduleKey="blogs">
        <BackLink href="/blogs/authors">Authors</BackLink>
        <BlogAuthorForm mode="create" />
      </EditorPage>
    </AdminShell>
  );
}
