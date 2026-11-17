/**
 * Shared types for the Throttlein Assistant chat (HeroUI version).
 * The same folder is used by the seller dashboard (frontend/) and the admin
 * panel (admin/) — keep the two copies identical (copy changes across by hand).
 */

export type Audience = 'seller' | 'superadmin';

/** A list the chat attached to a reply; the rows are paged from POST /table. */
export interface TableRef {
  tool: string;
  args: Record<string, unknown>;
  total: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  table?: TableRef;
  /** Stable id for an attached table (keeps its page across re-renders). */
  tid?: string;
}

export interface SessionUser {
  name?: string;
  role: Audience;
  storeName?: string;
}

export interface PendingChange {
  tool: string;
  args: Record<string, unknown>;
  confirmation: string;
  expiresAt?: string;
}

export interface ChatReply {
  ok: boolean;
  message?: string;
  reply?: string;
  awaitingConfirmation?: boolean;
  pending?: PendingChange | null;
  actions?: string[];
  table?: TableRef;
  conversationId?: string | null;
}

export type ColumnKind = 'name' | 'code' | 'num' | 'money' | 'status' | 'text';

export interface TableColumn {
  key: string;
  label: string;
  kind: ColumnKind;
}

/** Where rows of a list open in the dashboard; each row carries `ref` (slug/id or order number). */
export type RowLinkType = 'product' | 'order';
export interface AssistantLinks {
  product?: (ref: string) => string;
  order?: (ref: string) => string;
}

export interface TablePage {
  ok: boolean;
  message?: string;
  link?: RowLinkType | null;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount?: number;
  updatedAt?: string;
}
