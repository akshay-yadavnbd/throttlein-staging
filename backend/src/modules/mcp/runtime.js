/**
 * Builds one McpServer per request for one connection, registering only the
 * tools its scopes and the superadmin's settings allow, and wraps every call:
 * rate → quota → concurrency → run (timeout) → envelope/budget → spend → audit.
 * The audit row is written before the result is returned; if it cannot be
 * written the result is withheld (fail closed).
 */
'use strict';
const z = require('zod/v4');
const { randomUUID } = require('crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const limits = require('./limits');
const { finalize, encodeCursor, decodeCursor, UNTRUSTED_NOTE } = require('./output');
const { summarizeArgs, canonical } = require('./audit');
const { ToolError } = require('./errors');
const { tools: ALL_TOOLS } = require('./tools');
const { version } = require('../../../package.json');
const { logger } = require('../../utils/logger');

const READ_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});
const TOOL_NAME_RE = /^tin_[a-z0-9_]{2,60}$/;
const ENVELOPE_SCHEMA = {
  items: z.array(z.any()),
  meta: z.looseObject({ count: z.number(), truncated: z.boolean(), bytes: z.number().optional() }),
};
const dayKey = (d) => d.toISOString().slice(0, 10);
const OUTCOME_BY_CODE = Object.freeze({
  RATE_LIMITED: 'limited',
  QUOTA_EXCEEDED: 'limited',
  TOO_MANY_CONCURRENT: 'limited',
  TIMEOUT: 'error',
  UNAVAILABLE: 'error',
  NOT_FOUND: 'rejected',
  INVALID_ARGUMENT: 'rejected',
  CURSOR_INVALID: 'rejected',
  AUDIT_UNAVAILABLE: 'error',
});

const SERVER_INSTRUCTIONS =
  'Throttlein marketplace operations (orders, shipments, refunds, sellers, KYC, settlements) for the signed-in staff member; read-only. ' +
  'Call tin_access_whoami first. Results follow {items, meta}; continue with meta.nextCursor when present. ' +
  'Amounts are INR rupees; dates are ISO 8601 (UTC) and date filters are IST calendar days. ' +
  'Contact details are masked unless a call passes reveal: true and the connection may reveal them. ' +
  UNTRUSTED_NOTE;

/** Tools this connection may see: scope held, not switched off by a superadmin. */
function toolsFor({ scopes, settings }, tools = ALL_TOOLS) {
  return tools.filter((t) => scopes.includes(t.scope) && !settings.disabledTools.includes(t.name));
}

const errorResult = (code, message) => ({
  isError: true,
  content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify({ error: { code, message } }) }],
});

function buildServer({ principal, settings, config, audit, request, tools = ALL_TOOLS }) {
  const visible = toolsFor({ scopes: principal.scopes, settings }, tools);
  const server = new McpServer(
    { name: 'throttlein', version },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  for (const tool of visible) {
    if (!TOOL_NAME_RE.test(tool.name)) throw new Error(`invalid tool name ${tool.name}`);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.untrustedOutput ? `${tool.description}\n\n${UNTRUSTED_NOTE}` : tool.description,
        inputSchema: tool.input || {},
        outputSchema: ENVELOPE_SCHEMA,
        annotations: { ...READ_ANNOTATIONS, title: tool.title },
      },
      (args) =>
        runTool({ tool, args, principal, settings, config, audit, request, visibleTools: visible.map((t) => t.name) }),
    );
  }
  return server;
}

async function runTool({ tool, args, principal, settings, config, audit, request, visibleTools }) {
  const started = Date.now();
  const L = settings.limits;
  let outcome = 'ok';
  let code;
  let records = 0;
  let bytes = 0;
  let result;
  let release = null;
  const auditDetail = {};
  const filtersMac = (filters) => audit.argsMac(filters || {});

  try {
    const [tokenRate, userRate] = await Promise.all([
      limits.hit(`rate:t:${principal.family}`, L.tokenPerMinute, 60000),
      limits.hit(`rate:u:${principal.user._id}`, L.userPerMinute, 60000),
    ]);
    if (!tokenRate.allowed || !userRate.allowed)
      throw new ToolError('RATE_LIMITED', 'Too many calls; wait a minute and retry.');
    const quotaKey = `quota:${principal.family}:${dayKey(new Date())}`;
    if ((await limits.peek(quotaKey)) >= L.dailyRecords)
      throw new ToolError('QUOTA_EXCEEDED', 'The daily record quota for this connection is used up.');
    release = limits.acquire(`conc:${principal.user._id}`, L.concurrent);
    if (!release) throw new ToolError('TOO_MANY_CONCURRENT', 'Too many calls in progress; retry shortly.');

    // Reveal is honoured only when the scope, the superadmin switch and the request all agree; it is recorded.
    const reveal = Boolean(args?.reveal) && principal.scopes.includes('contact:read') && settings.allowContactReveal;
    if (args?.reveal && !reveal) auditDetail.revealDenied = true;
    if (reveal) auditDetail.reveal = true;

    const ctx = {
      user: principal.user,
      scopes: principal.scopes,
      connection: principal.connection,
      settings,
      visibleTools,
      audit,
      requestId: request.id,
      view: { reveal },
      pageSize: (requested) => Math.max(1, Math.min(Number(requested) || L.pageSize, L.pageSize)),
      decodeCursor: (cursor, filters) => {
        if (cursor === undefined || cursor === null || cursor === '') return null;
        const position = decodeCursor(config.keys.cursor, cursor, {
          tool: tool.name,
          user: principal.user._id,
          filtersMac: filtersMac(filters),
        });
        if (position === null)
          throw new ToolError('CURSOR_INVALID', 'The cursor is invalid or expired; start again without it.');
        return position;
      },
      encodeCursor: (filters, position) =>
        encodeCursor(config.keys.cursor, {
          tool: tool.name,
          user: principal.user._id,
          filtersMac: filtersMac(filters),
          position,
        }),
    };

    let timer;
    const raw = await Promise.race([
      tool.run(args || {}, ctx),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new ToolError('TIMEOUT', 'The call took too long; narrow the filters.')),
          L.toolTimeoutMs || config.limits.toolTimeoutMs,
        );
      }),
    ]).finally(() => clearTimeout(timer));

    const done = finalize(raw, { budgetBytes: L.responseBytes, cursorAfter: raw?.cursorAfter || null });
    if (done.removedKeys) logger.warn(`[mcp] output guard removed ${done.removedKeys} key(s) from ${tool.name}`);
    records = done.records;
    bytes = done.bytes;
    if (records > 0) {
      const quota = await limits.reserve(quotaKey, records, L.dailyRecords, 86400000);
      if (!quota.allowed)
        throw new ToolError(
          'QUOTA_EXCEEDED',
          'This result exceeds the remaining daily record quota; request fewer records or try again tomorrow.',
        );
    }
    result = {
      content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify(done.payload) }],
      structuredContent: done.payload,
    };
  } catch (error) {
    if (error instanceof ToolError) {
      outcome = OUTCOME_BY_CODE[error.code] || 'denied';
      code = error.code;
      result = errorResult(error.code, error.message);
    } else {
      outcome = 'error';
      code = 'INTERNAL';
      logger.error({ err: error }, `[mcp] ${tool.name} failed (${request.id}):`);
      result = errorResult('INTERNAL', `Something went wrong. Reference: ${request.id}`);
    }
  } finally {
    if (release) release();
  }

  try {
    await audit.record({
      event: 'tool.call',
      outcome,
      code,
      requestId: request.id,
      user: principal.user._id,
      userEmail: principal.user.email,
      token: principal.family,
      tool: tool.name,
      argsMac: audit.argsMac(args),
      argsSummary: summarizeArgs(args, tool.safeArgs || []),
      detail: Object.keys(auditDetail).length ? auditDetail : undefined,
      records,
      bytes,
      durationMs: Date.now() - started,
      ip: request.ip,
      client: request.client,
    });
  } catch (error) {
    logger.error({ err: error }, `[mcp] audit write failed for ${tool.name} (${request.id}):`);
    return errorResult(
      'AUDIT_UNAVAILABLE',
      `The request could not be recorded, so its result is withheld. Reference: ${request.id}`,
    );
  }
  logger.info(
    `[mcp] ${principal.user.email} ${tool.name} ${outcome}${code ? ` ${code}` : ''} ${records} rows ${Date.now() - started}ms`,
  );
  return result;
}

const newRequestId = () => randomUUID();

module.exports = { buildServer, runTool, toolsFor, SERVER_INSTRUCTIONS, ENVELOPE_SCHEMA, newRequestId, canonical };
