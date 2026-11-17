/**
 * The Throttlein Assistant's chat layout. Expanded (desktop): an app-style view
 * with a chat-history sidebar, a welcome screen with suggestion cards when the
 * chat is empty, the conversation in a centred column and a floating input bar.
 * `compact` (the normal popup, and phones): the same look without the sidebar,
 * with a light header (logo + history / new chat / expand / close) instead.
 */
import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import Image from 'next/image';
// The app's own favicon (app/favicon.png exists in both the seller and admin apps).
import favicon from '@/app/favicon.png';
import { Button, Spinner, Textarea, Tooltip } from '@heroui/react';
import type { AssistantApi } from './api';
import type { ConversationSummary } from './types';
import ConfirmDelete from './ConfirmDelete';
import { BoxIcon, ChartIcon, CloseIcon, CollapseIcon, ExpandIcon, HistoryIcon, NewChatIcon, PanelIcon, RupeeIcon, SendIcon, SparkleIcon, TrashIcon, AlertIcon } from './icons';

interface Props {
  api: AssistantApi;
  firstName: string;
  sub: string;
  suggestions: string[];
  convId: string | null;
  /** Changes whenever the conversation list may have changed (new chat saved, message added). */
  version: string;
  hasMessages: boolean;
  messages: ReactNode;
  msgsRef: RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (v: string) => void;
  send: (text: string) => void;
  busy: boolean;
  awaiting: boolean;
  onNew: () => void;
  onOpen: (id: string) => Promise<void>;
  onDeleted: (id: string) => void;
  beforeLoad: () => Promise<void>;
  onCollapse: () => void;
  onClose: () => void;
  portal?: Element;
  /** Popup / phone layout: no sidebar, light header with the chat controls. */
  compact?: boolean;
  /** Expanded right now (drives the expand/collapse button in the compact header). */
  isFull?: boolean;
  /** Compact header: drag handlers and cursor classes from the widget. */
  headerProps?: { onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void; onDoubleClick?: (e: ReactMouseEvent<HTMLDivElement>) => void; className?: string };
  historyOpen?: boolean;
  onToggleHistory?: () => void;
  /** Compact: the history screen, shown in place of the chat when open. */
  historyNode?: ReactNode;
  onToggleExpand?: () => void;
}

function when(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Today / Yesterday / Previous 7 days / Older */
function groupOf(iso?: string): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return 'Older';
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return 'Today';
  if (t >= start - 86400000) return 'Yesterday';
  if (t >= start - 7 * 86400000) return 'Previous 7 days';
  return 'Older';
}
const GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

function iconFor(s: string) {
  if (/attention|today|need/i.test(s)) return AlertIcon;
  if (/order/i.test(s)) return BoxIcon;
  if (/payout|paid|money|due/i.test(s)) return RupeeIcon;
  if (/stock|sell|product/i.test(s)) return ChartIcon;
  return SparkleIcon;
}

export default function ExpandedView(p: Props) {
  // Pulled out so the ref is only ever forwarded as a `ref` prop.
  const { msgsRef, hasMessages, messages } = p;
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      await p.beforeLoad().catch(() => {});
      setItems(await p.api.conversations());
    } catch { setFailed(true); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.api]);
  // Refresh the list when the conversation changes (debounced so typing replies do not spam the API).
  useEffect(() => { const t = setTimeout(() => { void load(); }, 250); return () => clearTimeout(t); }, [load, p.version]);

  // Deleting asks first (ConfirmDelete); the chat is removed only after the API confirms.
  const remove = async () => {
    if (!confirm) return;
    const id = confirm.id;
    setDeleting(true);
    try { await p.api.deleteConversation(id); setItems((l) => (l || []).filter((c) => c.id !== id)); p.onDeleted(id); setConfirm(null); } catch { /* keep the dialog; retry */ }
    setDeleting(false);
  };

  const tip = { portalContainer: p.portal, placement: 'bottom' as const, delay: 400, closeDelay: 0, size: 'sm' as const };
  const recent = (items || []).slice(0, 3);
  // Black buttons with white icons (sidebar toggle, collapse, close).
  const darkBtn = 'h-9 w-9 min-w-9 rounded-[10px] bg-[#141414] text-white data-[hover=true]:bg-[#27272a]';
  const c = Boolean(p.compact);

  /* ---------- sidebar ---------- */
  const sidebar = (
    <aside className={`relative flex shrink-0 flex-col overflow-hidden border-r border-[#e9e6f5] bg-[linear-gradient(180deg,#fbfaff_0%,#f6f7fc_55%,#f8f6fb_100%)] transition-[width] duration-200 ${collapsed ? 'w-[60px]' : 'w-[264px]'}`}>
      {/* Faint AI glow at the top of the sidebar. */}
      <span aria-hidden className="pointer-events-none absolute -left-16 -top-20 h-48 w-48 rounded-full bg-[#a78bfa]/20 blur-3xl" />
      <div className={`flex items-center gap-2.5 px-3 pb-3 pt-4 ${collapsed ? 'flex-col' : ''}`}>
        {collapsed ? (
          // Too narrow for the wordmark: the Throttlein favicon instead.
          <Image src={favicon} alt="THROTTLEIN" width={36} height={36} className="h-9 w-9 shrink-0 scale-[1.26]" priority />
        ) : (
          <div className="min-w-0 flex-1">
            {/* THROTTLEIN wordmark (same asset as the dashboard sidebar, /public/images/throttlein-logo.png). */}
            <Image src="/images/throttlein-logo.png" alt="THROTTLEIN" width={115} height={28} priority className="h-7 w-auto" />
            <div className="mt-1 truncate text-xs text-[#8a8a86]">Assistant · {p.sub}</div>
          </div>
        )}
        <Tooltip {...tip} placement="right" content={collapsed ? 'Show sidebar' : 'Hide sidebar'}>
          <Button isIconOnly size="sm" aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'} className={darkBtn} onPress={() => setCollapsed((c) => !c)}>
            <PanelIcon className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>

      <div className="px-2 flex items-center">
        <Button
          size="sm"
          radius="lg"
          aria-label="New chat"
          isIconOnly={collapsed}
          className={`group/new relative overflow-hidden bg-[#141414] text-[13px] font-medium text-white shadow-[0_6px_16px_rgba(20,20,20,0.18)] transition-transform data-[hover=true]:-translate-y-px ${collapsed ? 'mx-auto h-9 w-9 min-w-9 justify-center rounded-[10px] px-0' : 'h-10 w-full justify-start gap-2.5 px-3'}`}
          onPress={p.onNew}
        >
          {/* Shimmer across the button on hover. */}
          <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition-all duration-700 group-hover/new:left-full group-hover/new:opacity-100" />
          <NewChatIcon className="relative h-4 w-4 shrink-0" />{!collapsed && <span className="relative">New chat</span>}
        </Button>
      </div>

      {!collapsed && (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {failed ? (
            <div className="px-2 py-4 text-xs text-[#8a8a86]">Could not load your chats. <button type="button" className="underline" onClick={() => void load()}>Retry</button></div>
          ) : !items ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-[#8a8a86]"><Spinner size="sm" color="default" /> Loading chats…</div>
          ) : !items.length ? (
            <div className="px-2 py-4 text-xs leading-relaxed text-[#8a8a86]">No saved chats yet. Your conversations will appear here.</div>
          ) : GROUPS.map((g) => {
            const list = items.filter((c) => groupOf(c.updatedAt) === g);
            if (!list.length) return null;
            return (
              <div key={g} className="mb-3">
                <div className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#a19fb0]">{g}</div>
                <ul className="flex flex-col gap-0.5">
                  {list.map((c) => (
                    <li key={c.id} className={`group/item relative flex items-center rounded-xl transition-all duration-200 ${c.id === p.convId ? 'bg-white shadow-[0_2px_10px_rgba(80,60,160,0.08)] ring-1 ring-[#ebe7fb]' : 'hover:translate-x-0.5 hover:bg-white/70'}`}>
                      {/* Active chat: violet → blue accent bar. */}
                      {c.id === p.convId && <span aria-hidden className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-gradient-to-b from-[#8b5cf6] to-[#3b82f6]" />}
                      <button type="button" className={`min-w-0 flex-1 truncate px-2.5 py-2 text-left text-[13px] ${c.id === p.convId ? 'font-medium text-[#141414]' : 'text-[#3a3a37]'}`} title={c.title} onClick={() => void p.onOpen(c.id)}>
                        {c.title || 'Untitled chat'}
                      </button>
                      <button
                        type="button"
                        aria-label="Delete chat"
                        title="Delete chat"
                        onClick={() => setConfirm(c)}
                        className="mr-1 shrink-0 rounded-md p-1 text-[#a3a39d] opacity-0 hover:text-[#8a1c1c] group-hover/item:opacity-100 focus-visible:opacity-100"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {collapsed && <div className="flex-1" />}

      {!collapsed && (
        <div className="relative m-2.5 overflow-hidden rounded-2xl border border-[#e9e6f5] bg-white/80 p-3 text-[11.5px] leading-snug text-[#6b6b65] backdrop-blur">
          <span aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-gradient-to-br from-[#a78bfa]/30 to-[#60a5fa]/30 blur-xl" />
          <div className="relative mb-0.5 flex items-center gap-1.5 font-medium text-[#141414]"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-[#8b5cf6] to-[#3b82f6] text-white"><SparkleIcon className="h-3 w-3" /></span> Your seller panel only</div>
          <span className="relative">Every change is previewed and needs your confirmation.</span>
        </div>
      )}
    </aside>
  );

  /* ---------- welcome screen ---------- */
  const welcome = (
    <div className={`mx-auto w-full max-w-[760px] ${c ? 'px-4 pb-6 pt-6' : 'px-6 pb-8 pt-[min(6vh,48px)]'}`}>
      <h2 className={`${c ? 'text-[24px]' : 'text-[clamp(26px,3.2vw,38px)]'} font-semibold leading-tight tracking-tight`}>
        <span className="text-[#141414]">Welcome{p.firstName ? `, ${p.firstName}` : ''}! 👋</span>
      </h2>
      <p className={`mt-1 ${c ? 'text-[20px]' : 'text-[clamp(22px,2.8vw,32px)]'} font-medium leading-tight tracking-tight text-[#55554f]`}>How can I help you today?</p>

      <div className={c ? 'mt-5 grid grid-cols-1 gap-2' : 'mt-8 grid grid-cols-2 gap-3'}>
        {p.suggestions.map((s, i) => {
          const Icon = iconFor(s);
          return (
            <button
              key={s}
              type="button"
              disabled={p.busy}
              onClick={() => p.send(s)}
              className={`group/card relative overflow-hidden rounded-2xl border border-[#ececea] bg-white/80 ${c ? 'px-3.5 py-3' : 'p-4'} text-left backdrop-blur-sm transition-all duration-300 ease-out animate-[ta-card-in_.5s_ease-out_both] hover:-translate-y-1 hover:border-[#c4b5fd] hover:bg-white hover:shadow-[0_12px_32px_rgba(124,58,237,0.14)] motion-reduce:animate-none`}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              {/* An AI-style shimmer (violet → blue) sweeps across each card in turn; it brightens on hover. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_30%,rgba(167,139,250,0.20)_45%,rgba(96,165,250,0.20)_55%,transparent_70%)] bg-[length:250%_100%] opacity-70 transition-opacity duration-300 animate-[ta-sheen_6s_ease-in-out_infinite] group-hover/card:opacity-100 motion-reduce:animate-none"
                style={{ animationDelay: `${i * 0.8}s` }}
              />
              <div className="relative flex items-center gap-1.5 text-[12px] text-[#141414]"><Icon className="h-[18px] w-[18px] text-[#141414] transition-transform duration-300 group-hover/card:scale-110" /> Suggested</div>
              <div className={`relative mt-1.5 ${c ? 'text-[14px]' : 'text-[15px]'} font-medium text-[#141414]`}>{s}</div>
            </button>
          );
        })}
      </div>

      {recent.length > 0 && (
        <div className={`mt-3 rounded-2xl border border-[#ececea] bg-white ${c ? 'p-3' : 'p-4'}`}>
          <div className="mb-2 flex items-center gap-1.5 text-[12px] text-[#8a8a86]"><NewChatIcon className="h-3.5 w-3.5" /> Recent chats</div>
          <ul className="flex flex-col">
            {recent.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => void p.onOpen(c.id)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[#f6f6f3]">
                  <span className="truncate text-[13.5px] text-[#2a2a27]">{c.title || 'Untitled chat'}</span>
                  <span className="shrink-0 text-[11.5px] text-[#9a9a94]">{when(c.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  /* ---------- floating input ---------- */
  const inputBar = (
    // z-30: above anything raised inside the scrolling chat (e.g. the pagination's active-page marker).
    <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t to-transparent ${c ? 'from-white from-30% via-white/90 px-3 pb-2.5 pt-6' : 'from-white/90 via-white/60 px-6 pb-4 pt-8'}`}>
      <div className="pointer-events-auto mx-auto w-full max-w-[760px]">
        <div className={`flex items-end gap-2 border border-[#e6e6e2] bg-white py-2 pr-2 shadow-[0_10px_36px_rgba(20,20,20,0.10)] ${c ? 'flex-wrap rounded-[22px] pl-3' : 'rounded-[26px] pl-4'}`}>
          <SparkleIcon className="mb-2.5 h-5 w-5 shrink-0 text-[#141414]" />
          {p.awaiting && !p.busy && (
            <div className="mb-1 flex shrink-0 items-center gap-1.5 border-r border-[#ececea] pr-2">
              <Button size="sm" radius="full" className="h-8 bg-gradient-to-br from-[#8b5cf6] to-[#3b82f6] text-[12.5px] font-medium text-white" onPress={() => p.send('Yes, apply it')}>Looks good? Apply it ✓</Button>
              <Button size="sm" radius="full" variant="light" className="h-8 min-w-0 px-2 text-[12.5px] text-[#55554f]" onPress={() => p.send('No, cancel that')}>Cancel</Button>
            </div>
          )}
          <Textarea
            aria-label="Message"
            placeholder={c ? 'Ask about your products…' : 'Ask anything about your products, orders, payouts…'}
            minRows={1}
            maxRows={6}
            maxLength={2000}
            variant="flat"
            value={p.input}
            onValueChange={p.setInput}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); p.send(p.input); } }}
            classNames={{ inputWrapper: '!bg-transparent shadow-none px-1 data-[hover=true]:!bg-transparent group-data-[focus=true]:!bg-transparent !ring-0 !ring-offset-0 group-data-[focus-visible=true]:!ring-0 group-data-[focus-visible=true]:!ring-offset-0', input: 'text-[14px] !outline-none' }}
            className="flex-1"
          />
          <Button isIconOnly radius="full" aria-label="Send" className="mb-0.5 h-10 w-10 min-w-10 bg-gradient-to-br from-[#8b5cf6] to-[#3b82f6] text-white shadow-[0_6px_16px_rgba(99,102,241,0.35)]" isDisabled={p.busy || !p.input.trim()} onPress={() => p.send(p.input)}>
            <SendIcon className="h-[18px] w-[18px]" />
          </Button>
        </div>
        {c && <div className="mt-1.5 text-center text-[10.5px] text-[#8a8a86]">Your seller panel only · every change is previewed and needs your confirmation</div>}
      </div>
    </div>
  );

  /* ---------- compact header (popup) ---------- */
  const hBtn = 'h-6 w-6 min-w-6 max-md:h-5 max-md:w-5 max-md:min-w-5 rounded-md bg-transparent text-[#bbb] data-[hover=true]:bg-white/10 data-[hover=true]:text-white';
  const hIcon = 'h-4 w-4 max-md:h-3.5 max-md:w-3.5';
  const compactHeader = (
    <div
      onPointerDown={p.headerProps?.onPointerDown}
      onDoubleClick={p.headerProps?.onDoubleClick}
      className={`relative z-20 flex shrink-0 items-center gap-3 bg-gradient-to-br from-[#111] to-[#262626] px-4 py-3 text-white ${p.headerProps?.className || ''}`}
    >
      <div className="min-w-0 flex-1">
        <Image src="/images/throttlein-logo.png" alt="THROTTLEIN" width={98} height={24} priority className="h-6 w-auto" draggable={false} />
        <div className="mt-0.5 truncate text-[11.5px] text-[#c9c9c9]">Assistant · {p.sub}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Tooltip {...tip} content={p.historyOpen ? 'Back to chat' : 'Chat history'}>
          <Button isIconOnly size="sm" aria-label="Chat history" className={`${hBtn} ${p.historyOpen ? 'bg-white/10 text-white' : ''}`} onPress={p.onToggleHistory}><HistoryIcon className={hIcon} /></Button>
        </Tooltip>
        <Tooltip {...tip} content="Start a new conversation">
          <Button isIconOnly size="sm" aria-label="New chat" className={hBtn} onPress={p.onNew}><NewChatIcon className={hIcon} /></Button>
        </Tooltip>
        <Tooltip {...tip} content={p.isFull ? 'Collapse' : 'Expand'}>
          <Button isIconOnly size="sm" aria-label={p.isFull ? 'Collapse' : 'Expand'} className={hBtn} onPress={p.onToggleExpand}>{p.isFull ? <CollapseIcon className={hIcon} /> : <ExpandIcon className={hIcon} />}</Button>
        </Tooltip>
        <Tooltip {...tip} content="Close">
          <Button isIconOnly size="sm" aria-label="Close" className={hBtn} onPress={p.onClose}><CloseIcon className={hIcon} /></Button>
        </Tooltip>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* Covers the whole chat window (positioned against the panel). */}
      <ConfirmDelete title={confirm ? confirm.title : null} busy={deleting} onCancel={() => setConfirm(null)} onConfirm={() => void remove()} />
      {!c && sidebar}
      <main className="relative isolate flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {/* Animated background: an "AI aurora" — soft violet, blue and pink glows slowly drifting behind the content. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <span className="absolute -left-[10%] -top-[20%] h-[60%] w-[55%] rounded-full bg-[#a78bfa]/30 blur-[90px] animate-[ta-drift1_18s_ease-in-out_infinite_alternate] motion-reduce:animate-none" />
          <span className="absolute -right-[12%] top-[15%] h-[55%] w-[50%] rounded-full bg-[#60a5fa]/25 blur-[100px] animate-[ta-drift2_22s_ease-in-out_infinite_alternate] motion-reduce:animate-none" />
          <span className="absolute -bottom-[25%] left-[20%] h-[55%] w-[55%] rounded-full bg-[#f472b6]/20 blur-[90px] animate-[ta-drift3_26s_ease-in-out_infinite_alternate] motion-reduce:animate-none" />
        </div>
        {c ? compactHeader : (
        <div className="flex h-12 shrink-0 items-center justify-end gap-1 px-3">
          <Tooltip {...tip} content="Collapse">
            <Button isIconOnly size="sm" aria-label="Collapse" className={darkBtn} onPress={p.onCollapse}><CollapseIcon className="h-4 w-4" /></Button>
          </Tooltip>
          <Tooltip {...tip} content="Close">
            <Button isIconOnly size="sm" aria-label="Close" className={darkBtn} onPress={p.onClose}><CloseIcon className="h-4 w-4" /></Button>
          </Tooltip>
        </div>
        )}
        {c && p.historyOpen ? <div className="relative flex min-h-0 flex-1 flex-col">{p.historyNode}</div> : (
          <>
            <div ref={msgsRef} className={`min-h-0 flex-1 overflow-y-auto ${c ? 'pb-32' : 'pb-32'}`}>
              {hasMessages ? <div className={`mx-auto flex w-full max-w-[760px] flex-col ${c ? 'gap-3 px-4 pt-3' : 'gap-4 px-6 pt-2'}`}>{messages}</div> : welcome}
            </div>
            {inputBar}
          </>
        )}
      </main>
    </div>
  );
}
