'use client';

import { useSyncExternalStore } from 'react';
import AssistantWidget from '@/components/assistant/AssistantWidget';
import { getStoredToken } from '@/lib/auth';

/**
 * Mounts the Throttlein Assistant (HeroUI chat in components/assistant) for
 * superadmins only. Staff accounts never load it: the assistant is a
 * product-management helper, and the service refuses staff tokens anyway.
 */
// Orders open in the admin order page; the admin has no single-product page, so product rows stay unlinked.
const LINKS = {
  order: (ref: string) => `/orders/${encodeURIComponent(ref)}`,
};

// Unset in a production build means the assistant is not deployed for this
// environment: render nothing rather than reach for localhost.
const ENDPOINT = (process.env.NEXT_PUBLIC_CHATBOT_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5100')).replace(/\/+$/, '');

function subscribeToStorage(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

export default function AdminAssistant({ role }: { role?: string }) {
  const token = useSyncExternalStore(
    subscribeToStorage,
    () => role === 'superadmin' && ENDPOINT ? getStoredToken() : null,
    () => null,
  );
  if (!ENDPOINT || role !== 'superadmin' || !token) return null;
  return <AssistantWidget token={token} endpoint={ENDPOINT} audience="superadmin" links={LINKS} />;
}
