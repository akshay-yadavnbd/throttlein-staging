/**
 * Throttlein Assistant — entry point.
 *
 *   node server.js            (PM2 app "throttlein-assistant", default port 5100)
 *
 * Routes:
 *   GET  /health     liveness
 *   GET  /widget.js  the floating chat widget the dashboards embed
 *   GET  /session    who the bearer token is (seller/superadmin) + suggestions
 *   POST /chat       { messages:[{role, content}] } → { reply, awaitingConfirmation, actions, table? }
 *   POST /table      { tool, args, page, pageSize } → one page of a list the chat attached (no model)
 *   GET  /conversations, GET|PATCH|DELETE /conversations/:id   the user's saved chats (stored by the API)
 *
 * The service holds no database connection and no state beyond short caches;
 * the browser sends the recent conversation with each message, and after each
 * reply the exchange is saved to the user's chat history through the API.
 */
'use strict';
const path = require('path');
const express = require('express');
const cors = require('cors');
const { loadConfig } = require('./src/config');
const { createBackend } = require('./src/backend');
const { createAuth } = require('./src/auth');
const { createGroq } = require('./src/groq');
const { runChat } = require('./src/agent');
const { normalizeConversation, shortCircuit, createRateLimiter } = require('./src/guard');
const { toolsFor, ToolError } = require('./src/mcp/tools');
const { runTable } = require('./src/tables');

const log = (event, data) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

function createApp({ config, fetchImpl } = {}) {
  config = config || loadConfig();
  const backend = createBackend({ baseUrl: config.backendApiUrl, timeoutMs: config.limits.backendTimeoutMs, maxBytes: config.limits.backendMaxBytes, fetchImpl });
  const auth = createAuth({ backend });
  const groq = createGroq({ ...config.groq, fetchImpl });
  const limiter = createRateLimiter({ max: config.limits.messagesPerMinute, windowMs: 60000 });
  const tableLimiter = createRateLimiter({ max: 120, windowMs: 60000 });

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || config.allowedOrigins.includes(origin)), credentials: false, allowedHeaders: ['Content-Type', 'Authorization'], methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
  app.use(express.json({ limit: '64kb' }));

  const bearer = (req) => { const h = String(req.headers.authorization || ''); return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; };
  const CONV_ID = /^[a-f0-9]{24}$/;
  /** Save one exchange to the user's history. Never fails the chat: history is best-effort. */
  async function saveExchange(token, conversationId, messages, reply, table) {
    const userMsg = messages[messages.length - 1];
    const bot = { role: 'assistant', content: reply, ...(table && { table }) };
    try {
      if (CONV_ID.test(String(conversationId || ''))) {
        try {
          await backend.call(token, { method: 'POST', path: `/assistant/conversations/${conversationId}/messages`, body: { messages: [userMsg, bot] } });
          return conversationId;
        } catch (error) { if (error.status !== 404) throw error; }
      }
      const created = await backend.call(token, { method: 'POST', path: '/assistant/conversations', body: { messages: [...messages, bot] } });
      return created?.conversation?.id || null;
    } catch (error) {
      log('history.error', { status: error.status || 500, message: error.message });
      return CONV_ID.test(String(conversationId || '')) ? conversationId : null;
    }
  }

  const fail = (res, error) => res.status(error.status && error.status < 600 ? error.status : 500).json({ ok: false, message: error.status ? error.message : 'Something went wrong.' });

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'throttlein-assistant', model: config.groq.model, time: new Date().toISOString() }));
  app.get('/widget.js', (_req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.sendFile(path.join(__dirname, 'widget', 'widget.js')); });

  app.get('/session', async (req, res) => {
    try {
      const user = await auth.resolve(bearer(req));
      const suggestions = user.role === 'superadmin'
        ? ['Search products that are out of stock', 'Show today\'s orders', 'Feature a product on the storefront']
        : ['What needs my attention today?', 'Show my new orders', 'How much payout is due?', 'Show my low-stock products'];
      res.json({ ok: true, user: { name: user.name, role: user.role, storeName: user.storeName }, tools: toolsFor(user.role).map((t) => t.name), suggestions });
    } catch (error) { fail(res, error); }
  });

  app.post('/chat', async (req, res) => {
    const started = Date.now();
    let user;
    try {
      user = await auth.resolve(bearer(req));
      const rate = limiter(user.id);
      if (!rate.allowed) { res.set('Retry-After', String(rate.retryAfterSeconds)); return res.status(429).json({ ok: false, message: 'You are sending messages very quickly. Give it a moment.' }); }
      const { messages } = normalizeConversation(req.body, config.limits);
      const last = messages[messages.length - 1].content;
      const canned = shortCircuit(last);
      if (canned) {
        log('chat', { user: user.email, role: user.role, shortCircuit: true, ms: Date.now() - started });
        const conversationId = await saveExchange(bearer(req), req.body?.conversationId, messages, canned);
        return res.json({ ok: true, reply: canned, awaitingConfirmation: false, actions: [], conversationId });
      }
      const result = await runChat({ user, token: bearer(req), messages, pending: req.body?.pending, config, groq, backend, log });
      result.conversationId = await saveExchange(bearer(req), req.body?.conversationId, messages, result.reply, result.table);
      log('chat', { user: user.email, role: user.role, turns: messages.length, actions: result.actions, awaitingConfirmation: result.awaitingConfirmation, ms: Date.now() - started });
      res.json({ ok: true, ...result });
    } catch (error) {
      log('chat.error', { user: user?.email, status: error.status || 500, message: error.message, ms: Date.now() - started });
      fail(res, error);
    }
  });

  app.post('/table', async (req, res) => {
    let user;
    try {
      user = await auth.resolve(bearer(req));
      const rate = tableLimiter(user.id);
      if (!rate.allowed) { res.set('Retry-After', String(rate.retryAfterSeconds)); return res.status(429).json({ ok: false, message: 'Slow down a little.' }); }
      const b = req.body || {};
      if (typeof b.tool !== 'string' || (b.args && (typeof b.args !== 'object' || JSON.stringify(b.args).length > 2000))) return res.status(400).json({ ok: false, message: 'Bad table request.' });
      const ctx = { user, token: bearer(req), backend, secret: config.secret, confirmationTtlMs: config.limits.confirmationTtlMs };
      res.json({ ok: true, ...(await runTable({ tool: b.tool, args: b.args || {}, page: b.page, pageSize: b.pageSize }, ctx)) });
    } catch (error) {
      if (error instanceof ToolError || Array.isArray(error?.issues)) return res.status(400).json({ ok: false, message: error instanceof ToolError ? error.message : 'Bad table request.' });
      log('table.error', { user: user?.email, status: error.status || 500, message: error.message });
      fail(res, error);
    }
  });

  // Chat history: thin pass-through to the API with the user's own token (the API scopes to them).
  const history = (handler) => async (req, res) => {
    try {
      await auth.resolve(bearer(req));
      if (req.params.id !== undefined && !CONV_ID.test(req.params.id)) return res.status(404).json({ ok: false, message: 'Conversation not found.' });
      res.json({ ok: true, ...(await handler(req)) });
    } catch (error) { fail(res, error); }
  };
  app.get('/conversations', history(async (req) => ({ items: (await backend.call(bearer(req), { method: 'GET', path: '/assistant/conversations', query: { limit: 50 } }))?.items || [] })));
  // Save a chat the browser already has (one started before history existed, or whose save failed).
  app.post('/conversations', history(async (req) => {
    const { messages } = normalizeConversation({ messages: [...(Array.isArray(req.body?.messages) ? req.body.messages : []), { role: 'user', content: '.' }] }, config.limits);
    messages.pop();
    if (!messages.length) throw Object.assign(new Error('Nothing to save.'), { status: 400 });
    const created = await backend.call(bearer(req), { method: 'POST', path: '/assistant/conversations', body: { messages } });
    return { conversation: created?.conversation };
  }));
  app.get('/conversations/:id', history(async (req) => ({ conversation: (await backend.call(bearer(req), { method: 'GET', path: `/assistant/conversations/${req.params.id}` }))?.conversation })));
  app.patch('/conversations/:id', history(async (req) => ({ conversation: (await backend.call(bearer(req), { method: 'PATCH', path: `/assistant/conversations/${req.params.id}`, body: { title: String(req.body?.title || '').slice(0, 120) } }))?.conversation })));
  app.delete('/conversations/:id', history(async (req) => { await backend.call(bearer(req), { method: 'DELETE', path: `/assistant/conversations/${req.params.id}` }); return {}; }));

  app.use((_req, res) => res.status(404).json({ ok: false, message: 'Not found.' }));
  return app;
}

if (require.main === module) {
  const config = loadConfig();
  const app = createApp({ config });
  app.listen(config.port, '127.0.0.1', () => console.log(`[assistant] listening on 127.0.0.1:${config.port} → API ${config.backendApiUrl}, model ${config.groq.model}`));
}

module.exports = { createApp };
