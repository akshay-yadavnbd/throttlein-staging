'use client';

import { useSyncExternalStore } from 'react';
import AssistantWidget from '@/components/assistant/AssistantWidget';
import { getSellerToken } from '@/lib/auth';

/**
 * Mounts the Throttlein Assistant (HeroUI chat in components/assistant) on the
 * seller dashboard. It renders nothing until the assistant service confirms
 * the token belongs to a seller or superadmin, so a logged-out or staff
 * visitor never sees the button.
 */
// Where rows of a product/order list in the chat open.
const LINKS = {
  product: (ref: string) => `/dashboard/products/${encodeURIComponent(ref)}`,
  order: (ref: string) => `/dashboard/orders/${encodeURIComponent(ref)}`,
};

// Unset in a production build means the assistant is not deployed for this
// environment: render nothing rather than reach for localhost.
const ENDPOINT = (process.env.NEXT_PUBLIC_CHATBOT_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5100')).replace(/\/+$/, '');

function subscribeToStorage(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

export default function SellerAssistant() {
  const token = useSyncExternalStore(
    subscribeToStorage,
    () => ENDPOINT ? getSellerToken() : null,
    () => null,
  );
  if (!ENDPOINT || !token) return null;
  return <AssistantWidget token={token} endpoint={ENDPOINT} audience="seller" links={LINKS} />;
}
