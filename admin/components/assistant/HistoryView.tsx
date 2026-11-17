/**
 * "Your chats": the signed-in user's saved conversations (stored server-side),
 * newest first. Open one to continue it; delete is two-step (bin → "Delete?").
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Spinner } from '@heroui/react';
import type { AssistantApi } from './api';
import type { ConversationSummary } from './types';
import { BackIcon, NewChatIcon, TrashIcon } from './icons';
import ConfirmDelete from './ConfirmDelete';

interface Props {
  api: AssistantApi;
  currentId: string | null;
  wide: boolean;
  /** Runs before listing (saves a chat open in this tab that was never stored). */
  beforeLoad?: () => Promise<void>;
  onBack: () => void;
  onNew: () => void;
  onOpen: (id: string) => Promise<void>;
  onDeleted: (id: string) => void;
}

function when(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const day = 86400000;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= start) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (d.getTime() >= start - day) return 'Yesterday';
  if (d.getTime() >= start - 6 * day) return d.toLocaleDateString('en-IN', { weekday: 'short' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export default function HistoryView({ api, currentId, wide, beforeLoad, onBack, onNew, onOpen, onDeleted }: Props) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [confirm, setConfirm] = useState<ConversationSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Runs asynchronously from the first tick, so the mount effect never
  // sets state synchronously.
  const load = useCallback(() => Promise.resolve().then(async () => {
    setItems(null); setError(false);
    try {
      if (beforeLoad) await beforeLoad().catch(() => {});
      setItems(await api.conversations());
    } catch { setError(true); }
  }), [api, beforeLoad]);

  // Once on mount — `beforeLoad` is a fresh closure every parent render,
  // so listing it would refetch the history on each keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  // Deleting asks first (ConfirmDelete); the row is removed only after the API confirms.
  const remove = async () => {
    if (!confirm) return;
    const id = confirm.id;
    setBusyId(id);
    try {
      await api.deleteConversation(id);
      setItems((list) => (list || []).filter((c) => c.id !== id));
      onDeleted(id);
      setConfirm(null);
    } catch { /* keep the dialog open; the user can retry */ }
    setBusyId(null);
  };

  const pad = wide ? 'px-[max(16px,calc((80vw-900px)/2))]' : 'px-3.5';

  return (
    // Transparent: the chat window's animated background (violet/blue/pink glows) shows through.
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ConfirmDelete title={confirm ? confirm.title : null} busy={Boolean(busyId)} onCancel={() => setConfirm(null)} onConfirm={() => void remove()} />
      <div className={`sticky top-0 z-10 flex items-center gap-2 border-b border-[#ebe7f6] bg-white/60 py-3 backdrop-blur-md ${pad}`}>
        <Button isIconOnly size="sm" variant="light" radius="sm" aria-label="Back to chat" className="h-7 w-7 min-w-7 text-[#55554f] transition-transform data-[hover=true]:-translate-x-0.5" onPress={onBack}>
          <BackIcon className="h-4 w-4" />
        </Button>
        <span className="flex-1 text-sm font-semibold text-[#1a1a1a]">Your chats{items && items.length ? <span className="ml-1.5 rounded-full bg-[#ede9fe] px-1.5 py-px text-[11px] font-medium text-[#6d28d9]">{items.length}</span> : null}</span>
        <Button size="sm" radius="full" className="group/new relative h-8 gap-1.5 overflow-hidden bg-[#141414] px-3 text-[12.5px] text-white shadow-[0_6px_16px_rgba(20,20,20,0.18)] transition-transform data-[hover=true]:-translate-y-px" onPress={onNew}>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition-all duration-700 group-hover/new:left-full group-hover/new:opacity-100" />
          <NewChatIcon className="relative h-3.5 w-3.5" /><span className="relative">New chat</span>
        </Button>
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto pb-3.5 pt-2 ${pad}`}>
        {error ? (
          <div className="px-4 py-7 text-center text-[13px] text-[#6b6b65]">
            Could not load your chats.
            <Button size="sm" variant="bordered" className="ml-2 h-7 min-w-0" onPress={() => void load()}>Retry</Button>
          </div>
        ) : !items ? (
          <div className="flex items-center justify-center gap-2 py-7 text-[13px] text-[#6b6b65]"><Spinner size="sm" color="default" /> Loading your chats…</div>
        ) : !items.length ? (
          <div className="mx-auto mt-6 flex max-w-[260px] flex-col items-center px-4 text-center text-[13px] text-[#6b6b65] animate-[ta-card-in_.4s_ease-out_both]">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#8b5cf6] to-[#3b82f6] text-white shadow-[0_8px_20px_rgba(99,102,241,0.3)]"><NewChatIcon className="h-5 w-5" /></span>
            No saved chats yet. Every conversation from now on is saved here automatically.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((c, i) => {
              const current = c.id === currentId;
              return (
                <li
                  key={c.id}
                  style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}
                  className={`group/row relative flex items-stretch overflow-hidden rounded-2xl border bg-white/80 backdrop-blur-sm transition-all duration-300 ease-out animate-[ta-card-in_.4s_ease-out_both] hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_10px_26px_rgba(124,58,237,0.12)] motion-reduce:animate-none ${current ? 'border-[#d8cffc] shadow-[0_4px_14px_rgba(124,58,237,0.10)]' : 'border-[#ebe7f3] hover:border-[#d8cffc]'}`}
                >
                  {/* Open chat: violet → blue accent bar. */}
                  {current && <span aria-hidden className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-full bg-gradient-to-b from-[#8b5cf6] to-[#3b82f6]" />}
                  <button
                    type="button"
                    className={`flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left ${busyId === c.id ? 'opacity-50' : ''}`}
                    onClick={async () => { setBusyId(c.id); try { await onOpen(c.id); } finally { setBusyId(null); } }}
                  >
                    <span className="truncate text-[13.5px] font-medium text-[#1a1a1a]">{c.title || 'Untitled chat'}</span>
                    <span className="text-[11.5px] text-[#8a8a86]">
                      {when(c.updatedAt)}{c.messageCount ? ` · ${c.messageCount} messages` : ''}{current ? ' · open now' : ''}
                    </span>
                  </button>
                  <Button
                    radius="none"
                    variant="light"
                    aria-label="Delete chat"
                    title="Delete chat"
                    className="h-auto min-w-11 border-l border-[#f0eef5] px-0 text-[#a3a39d] opacity-70 transition-opacity group-hover/row:opacity-100 hover:text-[#8a1c1c]"
                    onPress={() => setConfirm(c)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
