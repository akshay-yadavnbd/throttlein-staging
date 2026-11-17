'use client';

/**
 * Throttlein Assistant — chat UI built with HeroUI (v2). Talks to the
 * assistant service (chatbot/) with the dashboard's own bearer token:
 *   GET /session · POST /chat · POST /table · /conversations
 *
 * Behaviour
 *   - Floating launcher you can drag anywhere; on desktop the popup opens beside it.
 *   - Expand to full screen (page scroll locked, Esc exits); closing resets to the popup.
 *   - Replies render bold/code/bullets/tables; lists come back as paged tables.
 *   - Every exchange is saved server-side; "History" lists, reopens and deletes chats.
 *
 * Used by both the seller dashboard and the admin panel: keep the frontend/ and
 * admin/ copies of components/assistant identical (copy changes across by hand).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button, Spinner } from '@heroui/react';
import { createAssistantApi } from './api';
import { Markdown } from './format';
import ListTable from './ListTable';
import HistoryView from './HistoryView';
import ExpandedView from './ExpandedView';
import { ChevronDownIcon, CloseIcon, SparkleIcon } from './icons';
import type { AssistantLinks, Audience, ChatMessage, PendingChange, SessionUser, TableRef } from './types';

const KEY = {
  messages: 'throttlein-assistant:conversation',
  open: 'throttlein-assistant:open',
  full: 'throttlein-assistant:fullscreen',
  conv: 'throttlein-assistant:conversation-id',
  pos: 'throttlein-assistant:position',
  panelPos: 'throttlein-assistant:panel-position',
};
const MAX_CONTEXT = 20;   // messages sent to the model
const MAX_DISPLAY = 200;  // messages kept on screen
const FAB = 58, GAP = 12, EDGE = 8, MOBILE = 767;

const read = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(lo, v), Math.max(lo, hi));
const newTid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function useViewport() {
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

interface Props {
  token: string;
  endpoint: string;
  audience: Audience;
  /** Dashboard routes that list rows open in (omit a type to leave it unlinked). */
  links?: AssistantLinks;
}

export default function AssistantWidget({ token, endpoint, links }: Props) {
  const api = useMemo(() => createAssistantApi(endpoint, token), [endpoint, token]);
  const vp = useViewport();
  const mobile = vp.w <= MOBILE;

  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [awaiting, setAwaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [movingPanel, setMovingPanel] = useState(false);
  // "Questions about your store?" bubble: shown while the launcher (or the bubble itself) is hovered.
  const [hoverTeaser, setHoverTeaser] = useState(false);
  const teaserTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const msgsRef = useRef<HTMLDivElement | null>(null);
  const movedRef = useRef(false);
  const loaded = useRef(false);

  /* ---------- session + restore this tab's state ---------- */
  useEffect(() => {
    setMounted(true);
    try {
      const m = JSON.parse(read(KEY.messages) || '[]');
      if (Array.isArray(m)) setMessages(m.slice(-MAX_DISPLAY));
    } catch { /* ignore */ }
    setOpen(read(KEY.open) === '1');
    setFull(read(KEY.full) === '1');
    setConvId(read(KEY.conv));
    try { const p = JSON.parse(read(KEY.pos) || 'null'); if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) setPos(p); } catch { /* ignore */ }
    try { const q = JSON.parse(read(KEY.panelPos) || 'null'); if (q && Number.isFinite(q.x) && Number.isFinite(q.y)) setPanelPos(q); } catch { /* ignore */ }
    loaded.current = true;
    let alive = true;
    void api.session().then((s) => { if (alive && s) { setUser(s.user); setSuggestions(s.suggestions); } });
    return () => { alive = false; };
  }, [api]);

  /* ---------- persist ---------- */
  useEffect(() => {
    if (!loaded.current) return;
    write(KEY.messages, JSON.stringify(messages.slice(-60)));
    write(KEY.open, open ? '1' : '0');
    write(KEY.full, full ? '1' : '0');
    write(KEY.conv, convId);
    write(KEY.pos, pos ? JSON.stringify(pos) : null);
    write(KEY.panelPos, panelPos ? JSON.stringify(panelPos) : null);
  }, [messages, open, full, convId, pos, panelPos]);

  const firstName = user?.name ? user.name.split(' ')[0] : '';
  const hello = firstName ? `Hi ${firstName}! ` : 'Hi! ';
  const welcome = user?.role === 'superadmin'
    ? 'I can search and update products across sellers and look up any order. What would you like to do?'
    : 'I can run your seller panel with you — products, orders and shipping, returns, payouts, offers, offline sales, media and store settings. Every change is shown to you first. What would you like to do?';
  const sub = user ? (user.role === 'superadmin' ? 'Superadmin · all products' : (user.storeName || user.name || 'Your products')) : 'Product catalogue help';

  /* ---------- full screen: lock page scroll, Esc exits ---------- */
  const isFull = open && full;
  useEffect(() => {
    if (!isFull) return undefined;
    const html = document.documentElement, body = document.body;
    const prev = { h: html.style.overflow, b: body.style.overflow };
    // Expanded: the page behind is blurred (desktop) or covered (phones), so it must not scroll or show its scrollbar.
    html.style.overflow = 'hidden'; body.style.overflow = 'hidden';
    // Esc collapses, unless a confirmation dialog is open (Esc then just closes that).
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="alertdialog"]')) setFull(false); };
    // Capture phase: HeroUI tooltips/buttons stop Escape from bubbling.
    document.addEventListener('keydown', onKey, true);
    return () => { html.style.overflow = prev.h; body.style.overflow = prev.b; document.removeEventListener('keydown', onKey, true); };
  }, [isFull, mobile]);

  /* ---------- scrolling ---------- */
  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => { const el = msgsRef.current; if (el) el.scrollTop = el.scrollHeight; });
  }, []);
  useEffect(() => { if (open && view === 'chat') scrollDown(); }, [messages, busy, error, open, view, full, scrollDown]);

  /* ---------- chat ---------- */
  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput(''); setError(null);
    const next: ChatMessage[] = [...messages, { role: 'user' as const, content: text }].slice(-MAX_DISPLAY);
    setMessages(next);
    setBusy(true);
    try {
      const res = await api.chat({
        messages: next.slice(-MAX_CONTEXT).map((m) => ({ role: m.role, content: m.content })),
        pending,
        conversationId: convId,
      });
      setAwaiting(Boolean(res.awaitingConfirmation));
      setPending(res.pending || null);
      if (res.conversationId) setConvId(res.conversationId);
      const bot: ChatMessage = { role: 'assistant', content: res.reply || '…' };
      if (res.table?.tool) { bot.table = res.table; bot.tid = newTid(); }
      setMessages((list) => [...list, bot].slice(-MAX_DISPLAY));
      if (res.actions?.length) window.dispatchEvent(new CustomEvent('throttlein-assistant:changed', { detail: { actions: res.actions } }));
    } catch (e) {
      setError((e as Error).message || 'Could not reach the assistant. Check your connection.');
      setAwaiting(false); setPending(null);
    } finally {
      setBusy(false);
    }
  }, [api, busy, convId, messages, pending]);

  const newChat = useCallback(() => {
    if (busy) return;
    setMessages([]); setConvId(null); setPending(null); setAwaiting(false); setError(null);
    setGreeting(`${hello}New conversation. What would you like to do with your products? You can also paste a product page URL to add it.`);
    setView('chat');
  }, [busy, hello]);

  const openConversation = useCallback(async (id: string) => {
    if (busy) return;
    try {
      const c = await api.conversation(id);
      setMessages((c.messages || []).slice(-MAX_DISPLAY).map((m, i) => ({
        role: m.role, content: m.content, ...(m.table?.tool && { table: m.table as TableRef, tid: `h${id.slice(-6)}${i}` }),
      })));
      setConvId(c.id || id); setPending(null); setAwaiting(false); setError(null); setGreeting(null);
      setView('chat');
    } catch {
      setError('Could not open that chat.'); setView('chat');
    }
  }, [api, busy]);

  // A chat open in this tab that was never stored (e.g. from before history existed) is saved first.
  const saveUnsaved = useCallback(async () => {
    if (convId || !messages.some((m) => m.role === 'user')) return;
    const id = await api.saveConversation(messages.slice(-MAX_CONTEXT).map((m) => ({ role: m.role, content: m.content })));
    if (id) setConvId(id);
  }, [api, convId, messages]);

  const onDeleted = useCallback((id: string) => {
    if (id === convId) { setConvId(null); setMessages([]); setPending(null); setAwaiting(false); }
  }, [convId]);

  /* ---------- open / close ---------- */
  // After opening a product/order from a table: close the chat so the page is visible (the conversation is kept).
  const afterNavigate = () => { setFull(false); setOpen(false); };
  const openPanel = () => { setOpen(true); if (!messages.length && !greeting) setGreeting(`${hello}${welcome}`); };
  const closePanel = () => { setOpen(false); setFull(false); };
  useEffect(() => { if (open && !messages.length && !greeting && user) setGreeting(`${hello}${welcome}`); }, [open, messages.length, greeting, user, hello, welcome]);

  /* ---------- draggable launcher ---------- */
  const fabStyle = pos ? { left: clamp(pos.x, EDGE, vp.w - FAB - EDGE), top: clamp(pos.y, EDGE, vp.h - FAB - EDGE), right: 'auto', bottom: 'auto' } : undefined;

  const onFabPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top, sx = e.clientX, sy = e.clientY;
    movedRef.current = false;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const move = (ev: PointerEvent) => {
      if (!movedRef.current && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
      movedRef.current = true; setDragging(true); setPanelPos(null);
      setPos({ x: clamp(ev.clientX - dx, EDGE, window.innerWidth - FAB - EDGE), y: clamp(ev.clientY - dy, EDGE, window.innerHeight - FAB - EDGE) });
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      setDragging(false);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const onFabClick = () => {
    if (movedRef.current) { movedRef.current = false; return; }
    if (open) closePanel(); else openPanel();
  };

  // Popup placement beside the launcher (desktop, popup mode, once it has been moved).
  // Popup 400×620; expanded 80% of the screen. Both open from the launcher's corner.
  const panelW = isFull ? Math.min(vp.w * 0.8, vp.w - 32) : Math.min(400, vp.w - 32);
  const panelH = isFull ? Math.min(vp.h * 0.8, vp.h - 120) : Math.min(620, vp.h - 120);
  let panelStyle: CSSProperties | undefined;
  if (panelPos && !isFull && !mobile) {
    // Moved by its header: stay there (kept on screen).
    panelStyle = { left: clamp(panelPos.x, EDGE, vp.w - panelW - EDGE), top: clamp(panelPos.y, EDGE, vp.h - panelH - EDGE), right: 'auto', bottom: 'auto' };
  } else if (pos && !mobile) {
    const fx = clamp(pos.x, EDGE, vp.w - FAB - EDGE), fy = clamp(pos.y, EDGE, vp.h - FAB - EDGE);
    // Always the same arrangement wherever it is dragged: the window above the launcher, right edges
    // aligned, so the launcher sits at the window's bottom-right corner (kept on screen).
    panelStyle = {
      left: clamp(fx + FAB - panelW, EDGE, vp.w - panelW - EDGE),
      top: clamp(fy - GAP - panelH, EDGE, vp.h - panelH - EDGE),
      right: 'auto', bottom: 'auto',
      transformOrigin: 'bottom right',
    };
  }

  const teaserIn = () => { if (teaserTimer.current) clearTimeout(teaserTimer.current); setHoverTeaser(true); };
  // Short grace period so the pointer can travel from the button into the bubble.
  const teaserOut = () => { if (teaserTimer.current) clearTimeout(teaserTimer.current); teaserTimer.current = setTimeout(() => setHoverTeaser(false), 150); };
  const dismissTeaser = () => { if (teaserTimer.current) clearTimeout(teaserTimer.current); setHoverTeaser(false); };
  const showTeaser = !open && hoverTeaser && !dragging;
  // Keep the bubble beside the launcher wherever it has been dragged.
  let teaserStyle: CSSProperties | undefined;
  if (pos) {
    const fx = clamp(pos.x, EDGE, vp.w - FAB - EDGE), fy = clamp(pos.y, EDGE, vp.h - FAB - EDGE);
    const tw = Math.min(300, vp.w - 28);
    const right = fx + FAB / 2 > vp.w / 2, below = fy + FAB / 2 < vp.h / 2;
    teaserStyle = {
      left: clamp(right ? fx + FAB - tw : fx, EDGE, vp.w - tw - EDGE), right: 'auto',
      ...(below ? { top: fy + FAB + GAP, bottom: 'auto' } : { bottom: vp.h - fy + GAP, top: 'auto' }),
    };
  }

  if (!mounted || !user) return null;

  /* ---------- render ---------- */
  const wide = isFull && !mobile;

  // Drag the popup by its header (desktop popup only; buttons still click; double-click resets).
  const canMovePanel = !isFull && !mobile;
  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canMovePanel || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const panel = panelRef.current; if (!panel) return;
    const el = e.currentTarget;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top, sx = e.clientX, sy = e.clientY;
    let moved = false;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
      moved = true; setMovingPanel(true);
      const nx = clamp(ev.clientX - dx, EDGE, window.innerWidth - r.width - EDGE);
      const ny = clamp(ev.clientY - dy, EDGE, window.innerHeight - r.height - EDGE);
      setPanelPos({ x: nx, y: ny });
      // The launcher rides on the window's bottom-right corner (kept on screen).
      setPos({ x: clamp(nx + r.width - FAB, EDGE, window.innerWidth - FAB - EDGE), y: clamp(ny + r.height + GAP, EDGE, window.innerHeight - FAB - EDGE) });
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      setMovingPanel(false);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    e.preventDefault();
  };

  // One layout for every size: expanded on desktop adds the history sidebar; the popup (and phones) use the compact form.
  const wideMessages = (
    <>
      {messages.map((m, i) => (m.role === 'user' ? (
        <div key={i} className="max-w-[80%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-[#e4dcfd] bg-gradient-to-br from-[#f3efff] to-[#e8f0ff] px-4 py-2.5 text-[14.5px] leading-relaxed text-[#141414]">{m.content}</div>
      ) : (
        <div key={m.tid || i} className="w-full self-start text-[14.5px] leading-relaxed text-[#141414]">
          <Markdown text={m.content} skipTables={Boolean(m.table)} />
          {m.table && <ListTable api={api} refData={m.table} wide={wide} tall={isFull} links={links} onNavigate={afterNavigate} onFirstLoad={i === messages.length - 1 ? scrollDown : undefined} />}
        </div>
      )))}
      {error && <div className="self-center rounded-[14px] bg-[#fde8e8] px-3.5 py-2 text-[13px] text-[#8a1c1c]">{error}</div>}
      {busy && <div className="self-start py-1"><Spinner size="sm" variant="dots" color="default" classNames={{ wrapper: "!translate-y-0 h-4 w-8 items-center", dots: "!bg-[#7c3aed] !size-1.5" }} aria-label="Assistant is typing" /></div>}
    </>
  );
  const expandedView = (
    <ExpandedView
      api={api}
      firstName={firstName}
      sub={sub}
      suggestions={suggestions}
      convId={convId}
      version={`${convId || ''}:${busy ? 'busy' : messages.length}`}
      hasMessages={messages.length > 0}
      messages={wideMessages}
      msgsRef={msgsRef}
      input={input}
      setInput={setInput}
      send={(t) => void send(t)}
      busy={busy}
      awaiting={awaiting}
      onNew={newChat}
      onOpen={openConversation}
      onDeleted={onDeleted}
      beforeLoad={saveUnsaved}
      onCollapse={() => setFull(false)}
      onClose={closePanel}
      portal={panelRef.current || undefined}
      compact={!wide}
      isFull={isFull}
      onToggleExpand={() => setFull((f) => !f)}
      historyOpen={view === 'history'}
      onToggleHistory={() => setView((v) => (v === 'history' ? 'chat' : 'history'))}
      historyNode={(
        <HistoryView
          api={api}
          currentId={convId}
          wide={false}
          beforeLoad={saveUnsaved}
          onBack={() => setView('chat')}
          onNew={newChat}
          onOpen={openConversation}
          onDeleted={onDeleted}
        />
      )}
      headerProps={{
        onPointerDown: onHeaderPointerDown,
        onDoubleClick: (e) => { if (canMovePanel && !(e.target as HTMLElement).closest('button')) { setPanelPos(null); setPos(null); } },
        className: canMovePanel ? `touch-none select-none [&_button]:cursor-pointer ${movingPanel ? 'cursor-grabbing' : 'cursor-grab'}` : '',
      }}
    />
  );

  const panelClass = isFull
    // Expanded: 80% of the screen, growing from the launcher's corner like the popup (desktop); full screen on phones.
    ? 'fixed z-[1000] flex flex-col overflow-hidden bg-white rounded-[18px] shadow-[0_30px_90px_rgba(0,0,0,0.35)] animate-[ta-pop_.18s_ease] '
      + 'right-[22px] bottom-[92px] w-[min(80vw,calc(100vw-32px))] h-[min(80vh,calc(100vh-120px))] origin-bottom-right '
      + 'max-md:inset-0 max-md:w-full max-md:h-full max-md:rounded-none max-md:shadow-none max-md:animate-none'
    : 'fixed z-[1000] flex flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_24px_64px_rgba(0,0,0,0.28)] animate-[ta-pop_.18s_ease] '
      + 'right-[22px] bottom-[92px] w-[min(400px,calc(100vw-32px))] h-[min(620px,calc(100vh-120px))] origin-bottom-right '
      + 'max-md:left-2 max-md:right-2 max-md:bottom-[84px] max-md:w-auto max-md:h-[calc(100dvh-100px)]';

  return createPortal(
    <>
      <style>{'@keyframes ta-pop{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}@keyframes ta-ripple{0%{transform:scale(1);opacity:.9}70%{transform:scale(1.42);opacity:.3}100%{transform:scale(1.55);opacity:0}}@keyframes ta-bob{0%,100%{transform:translateY(-3px)}50%{transform:translateY(3px)}}@keyframes ta-drift1{0%{transform:translate(0,0) scale(1)}100%{transform:translate(18%,22%) scale(1.15)}}@keyframes ta-drift2{0%{transform:translate(0,0) scale(1.05)}100%{transform:translate(-20%,18%) scale(.9)}}@keyframes ta-drift3{0%{transform:translate(0,0) scale(.95)}100%{transform:translate(15%,-18%) scale(1.1)}}@keyframes ta-sheen{0%{background-position:120% 0}50%,100%{background-position:-120% 0}}@keyframes ta-card-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes ta-teaser{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}'}</style>

      {/* Expanded on desktop: blur everything behind the chat window (the launcher stays sharp above it). Click the blur to collapse. */}
      {isFull && !mobile && (
        <div aria-hidden className="fixed inset-0 z-[999] bg-black/10 backdrop-blur-[6px]" onClick={() => setFull(false)} />
      )}

      {/* The launcher stays visible when expanded on desktop (on phones the expanded chat covers the screen). */}
      {(!isFull || !mobile) && (
        <button
          ref={fabRef}
          type="button"
          aria-label={open ? 'Close Throttlein Assistant' : 'Open Throttlein Assistant'}
          onPointerDown={(e) => { dismissTeaser(); onFabPointerDown(e); }}
          onClick={onFabClick}
          onMouseEnter={teaserIn}
          onMouseLeave={teaserOut}
          style={fabStyle}
          className={`group fixed bottom-[22px] right-[22px] z-[1001] flex h-[58px] w-[58px] touch-none select-none items-center justify-center rounded-full border-0 bg-transparent text-[#BDFF00] transition-transform max-md:bottom-[14px] max-md:right-[14px] ${dragging ? 'scale-105 cursor-grabbing transition-none' : 'cursor-pointer hover:scale-[1.05]'}`}
        >
          {/* Ripple: a soft brand-tinted ring starts at the button's edge, spreads out and fades, then repeats. */}
          {!open && !dragging && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-[#BDFF00]/75 animate-[ta-ripple_1.8s_ease-out_infinite] motion-reduce:hidden" />}
          {/* The button face, painted above the halo. */}
          <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,#3a3a3a,#141414_70%)] shadow-[0_12px_32px_rgba(20,20,20,0.35)]" />
          {/* Closed: the sparkle (floats up and down, settles in the centre on hover or drag).
              Open: a down chevron. The two cross-fade with a quarter turn as the chat opens/closes. */}
          <span className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ease-out ${open ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'}`}>
            <SparkleIcon className={`relative h-7 w-7 ${dragging || open ? '' : 'animate-[ta-bob_1.8s_ease-in-out_infinite] group-hover:animate-none motion-reduce:animate-none'}`} />
          </span>
          <span className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ease-out ${open ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'}`}>
            <ChevronDownIcon className="relative h-6 w-6" />
          </span>
        </button>
      )}

      {showTeaser && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Open Throttlein Assistant"
          onClick={(e) => { if ((e.target as HTMLElement).closest('[data-teaser-close]')) return; dismissTeaser(); openPanel(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dismissTeaser(); openPanel(); } }}
          style={teaserStyle}
          onMouseEnter={teaserIn}
          onMouseLeave={teaserOut}
          className="fixed bottom-[92px] right-[22px] z-[1001] w-[300px] max-w-[calc(100vw-28px)] cursor-pointer rounded-2xl bg-white py-3.5 pl-4 pr-11 text-left shadow-[0_12px_40px_rgba(20,20,20,0.16)] ring-1 ring-black/5 animate-[ta-teaser_.25s_ease] max-md:bottom-[84px] max-md:right-[14px]"
        >
          <div className="text-[15px] font-semibold leading-snug text-[#141414]">Questions about your store?</div>
          <div className="mt-1 text-[13.5px] leading-snug text-[#6b6b65]">Ask me about products, orders, payouts or stock.</div>
          <Button
            isIconOnly
            size="sm"
            radius="full"
            variant="flat"
            aria-label="Dismiss"
            data-teaser-close
            className="absolute right-2.5 top-2.5 h-7 w-7 min-w-7 bg-[#f0f0ec] text-[#55554f]"
            onPress={dismissTeaser}
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {open && (
        <div ref={panelRef} role="dialog" aria-label="Throttlein Assistant" className={panelClass} style={panelStyle}>
          {expandedView}
        </div>
      )}
    </>,
    document.body,
  );
}
