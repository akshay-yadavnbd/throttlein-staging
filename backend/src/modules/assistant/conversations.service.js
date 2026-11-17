/**
 * Throttlein Assistant chat history, saved per user. Only the chatbot
 * service calls these routes (with the dashboard user's own token). Messages
 * are cleaned before they are stored: unknown roles, empty text and
 * user-side tables are dropped, and sizes are bounded.
 */
const mongoose = require('mongoose');
const { AppError } = require('../../errors/AppError');
const conversations = require('./conversations.repository');

const MAX_BATCH = 20;
const notFound = () => AppError.notFound('Conversation not found.');

function cleanTable(t) {
  if (!t || typeof t !== 'object' || typeof t.tool !== 'string' || !/^[a-z_]{1,60}$/.test(t.tool)) return undefined;
  const args = t.args && typeof t.args === 'object' && !Array.isArray(t.args) ? t.args : {};
  if (JSON.stringify(args).length > 2000) return undefined;
  return { tool: t.tool, args, total: Number.isFinite(Number(t.total)) ? Number(t.total) : 0 };
}

/** The newest MAX_BATCH user / assistant messages with text; only assistant messages may carry a table reference. */
function cleanMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-MAX_BATCH)
    .filter(
      (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim(),
    )
    .map((m) => {
      const out = { role: m.role, content: m.content.slice(0, 20000), at: new Date() };
      const table = m.role === 'assistant' ? cleanTable(m.table) : undefined;
      if (table) out.table = table;
      return out;
    });
}

/** The given title, else the first question, on one line, at most 80 characters. */
function titleFrom(title, messages) {
  const t =
    typeof title === 'string' && title.trim()
      ? title
      : (messages.find((m) => m.role === 'user') || {}).content || 'New chat';
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > 80 ? `${one.slice(0, 77)}…` : one;
}

const summary = (c) => ({
  id: String(c._id),
  title: c.title,
  messageCount: c.messageCount || 0,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

/** A malformed id is simply "not found" — never a cast error. */
function assertId(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound();
}

async function list(userId, query) {
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  return { items: (await conversations.listForUser(userId, limit)).map(summary) };
}

async function create(userId, body = {}) {
  const messages = cleanMessages(body.messages);
  const convo = await conversations.create({
    user: userId,
    title: titleFrom(body.title, messages),
    messages,
    messageCount: messages.length,
  });
  await conversations.trimToCap(userId);
  return { conversation: summary(convo) };
}

async function get(userId, id) {
  assertId(id);
  const c = await conversations.findOwn(id, userId);
  if (!c) throw notFound();
  const messages = (c.messages || []).map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.table && { table: m.table }),
    at: m.at,
  }));
  return { conversation: { ...summary(c), messages } };
}

async function append(userId, id, body = {}) {
  assertId(id);
  const messages = cleanMessages(body.messages);
  if (!messages.length) throw AppError.badRequest('No messages to add.');
  const c = await conversations.append(id, userId, messages);
  if (!c) throw notFound();
  return { conversation: summary(c) };
}

async function rename(userId, id, body = {}) {
  assertId(id);
  if (typeof body.title !== 'string' || !body.title.trim()) throw AppError.badRequest('Give the chat a title.');
  const c = await conversations.rename(id, userId, titleFrom(body.title, []));
  if (!c) throw notFound();
  return { conversation: summary(c) };
}

async function remove(userId, id) {
  assertId(id);
  const r = await conversations.deleteOwn(id, userId);
  if (!r.deletedCount) throw notFound();
}

module.exports = { list, create, get, append, rename, remove, cleanMessages };
