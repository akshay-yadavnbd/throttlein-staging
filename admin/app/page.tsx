'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredAdmin } from '@/lib/auth';

export default function Index() {
  const router = useRouter();
  useEffect(() => {
    const user = getStoredAdmin();
    if (user?.role === 'superadmin' || user?.role === 'staff') router.replace('/dashboard');
    else router.replace('/login');
  }, [router]);
  return null;
}
