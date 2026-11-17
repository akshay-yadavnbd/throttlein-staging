/**
 * Client for the Throttlein Assistant service (chatbot/). Every call carries
 * the dashboard's own bearer token; the service and the API scope everything
 * to that user.
 */
import type { ChatMessage, ChatReply, ConversationSummary, PendingChange, SessionUser, TablePage, TableRef } from './types';

export interface AssistantApi {
  session(): Promise<{ user: SessionUser; suggestions: string[] } | null>;
  chat(body: { messages: { role: string; content: string }[]; pending?: PendingChange | null; conversationId?: string | null }): Promise<ChatReply>;
  table(ref: TableRef, page: number, pageSize: number): Promise<TablePage>;
  conversations(): Promise<ConversationSummary[]>;
  conversation(id: string): Promise<{ id: string; title: string; messages: ChatMessage[] }>;
  saveConversation(messages: { role: string; content: string }[]): Promise<string | null>;
  deleteConversation(id: string): Promise<void>;
}

export function createAssistantApi(endpoint: string, token: string): AssistantApi {
  const base = endpoint.replace(/\/+$/, '');

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || data.ok === false) throw new Error((data && data.message) || 'The assistant is unavailable right now.');
    return data as T;
  }

  return {
    async session() {
      try {
        const s = await call<{ ok: boolean; user: SessionUser; suggestions?: string[] }>('GET', '/session');
        return s.ok ? { user: s.user, suggestions: s.suggestions || [] } : null;
      } catch {
        return null; // not a seller/superadmin, or the service is down: show nothing
      }
    },
    chat: (body) => call<ChatReply>('POST', '/chat', { ...body, pending: body.pending || undefined, conversationId: body.conversationId || undefined }),
    table: (ref, page, pageSize) => call<TablePage>('POST', '/table', { tool: ref.tool, args: ref.args, page, pageSize }),
    async conversations() {
      return (await call<{ items?: ConversationSummary[] }>('GET', '/conversations')).items || [];
    },
    async conversation(id) {
      const b = await call<{ conversation: { id: string; title: string; messages: ChatMessage[] } }>('GET', `/conversations/${encodeURIComponent(id)}`);
      return b.conversation;
    },
    async saveConversation(messages) {
      const b = await call<{ conversation?: { id?: string } }>('POST', '/conversations', { messages });
      return b.conversation?.id || null;
    },
    async deleteConversation(id) {
      await call('DELETE', `/conversations/${encodeURIComponent(id)}`);
    },
  };
}
