/**
 * Audit trail for the connector. Each row gets a `seq` from the atomic
 * Counter and an HMAC over its canonical form, so edits and gaps are
 * detectable. Arguments are recorded as a keyed MAC (low-entropy values such
 * as emails cannot be dictionary-reversed) plus a summary that keeps only the
 * values a tool declared safe.
 */
'use strict';
const { createHmac } = require('crypto');
const repo = require('./mcp.repository');
const { logger } = require('../../utils/logger');

const COUNTER_NAME = 'mcp-audit';
const ROW_FIELDS = [
  'event',
  'outcome',
  'code',
  'requestId',
  'user',
  'userEmail',
  'token',
  'tool',
  'argsMac',
  'argsSummary',
  'detail',
  'records',
  'bytes',
  'durationMs',
  'ip',
  'client',
];

function canonical(value) {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'object' && typeof value.toHexString === 'function') return JSON.stringify(value.toHexString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const mac = (key, value) => createHmac('sha256', key).update(canonical(value)).digest('hex');

function summarizeArgs(args, safeKeys = []) {
  if (!args || typeof args !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (safeKeys.includes(k) && (typeof v !== 'string' || v.length <= 64)) out[k] = v;
    else if (typeof v === 'string') out[k] = { type: 'string', length: v.length };
    else if (Array.isArray(v)) out[k] = { type: 'array', length: v.length };
    else out[k] = { type: v === null ? 'null' : typeof v };
  }
  return out;
}

function macInput(row) {
  const base = { seq: row.seq, at: row.at };
  for (const f of ROW_FIELDS) if (row[f] !== undefined && row[f] !== null) base[f] = row[f];
  return base;
}

function createAudit({
  keys,
  createRow = repo.createAuditRow,
  nextSeq = () => repo.nextAuditSeq(COUNTER_NAME),
  now = () => new Date(),
}) {
  return {
    argsMac: (args) => mac(keys.args, args ?? {}),
    /** Throws when the row cannot be written; callers withhold the result. */
    async record(entry) {
      const row = { at: now() };
      for (const f of ROW_FIELDS) if (entry[f] !== undefined && entry[f] !== null) row[f] = entry[f];
      row.seq = await nextSeq();
      row.mac = mac(keys.audit, macInput(row));
      await createRow(row);
      return row.seq;
    },
    /** For events whose result must not depend on the audit store (sign-in metadata, revocations). */
    async tryRecord(entry) {
      try {
        return await this.record(entry);
      } catch (error) {
        logger.error({ err: error }, '[mcp] audit write failed for %s %s', entry.event, '-');
        return null;
      }
    },
    /** rows sorted by seq ascending. */
    verify(rows) {
      const badMac = [];
      const gaps = [];
      let prev = null;
      for (const row of rows) {
        if (mac(keys.audit, macInput(row)) !== row.mac) badMac.push(row.seq);
        if (prev !== null && row.seq !== prev + 1) gaps.push([prev, row.seq]);
        prev = row.seq;
      }
      return { ok: badMac.length === 0 && gaps.length === 0, checked: rows.length, badMac, gaps };
    },
  };
}

module.exports = { canonical, summarizeArgs, createAudit, COUNTER_NAME };
