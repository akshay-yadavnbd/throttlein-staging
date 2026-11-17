/**
 * Environment for the assistant service. Parsed once, validated, frozen.
 *
 * The service talks to exactly two things: Groq (the model) and the
 * Throttlein API (as the signed-in user). It has no database connection by
 * design — every fact it learns and every change it makes goes through the
 * same public routes the dashboards use, so the API's own auth and ownership
 * rules are the boundary.
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const intIn = (raw, fallback, min, max, name) => {
  const n = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  return n;
};
const list = (raw) => String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);

function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const secret = String(env.CHATBOT_SECRET || '');
  if (secret.length < 32) throw new Error('CHATBOT_SECRET must be at least 32 characters (node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
  const apiKey = String(env.GROQ_API_KEY || '');
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');
  const backendApiUrl = String(env.BACKEND_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(backendApiUrl)) throw new Error('BACKEND_API_URL must be an http(s) URL ending in /api');
  const allowedOrigins = list(env.ALLOWED_ORIGINS);
  if (!isProd) allowedOrigins.push('http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001');

  return Object.freeze({
    isProd,
    port: intIn(env.PORT, 5100, 1, 65535, 'PORT'),
    backendApiUrl,
    secret,
    allowedOrigins: Object.freeze(allowedOrigins),
    groq: Object.freeze({
      apiKey,
      model: String(env.GROQ_MODEL || 'qwen/qwen3.8-27b'),
      baseUrl: String(env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
      // Covers up to two rate-limit waits (25 s each) plus the request itself.
      timeoutMs: intIn(env.GROQ_TIMEOUT_MS, 90000, 5000, 180000, 'GROQ_TIMEOUT_MS'),
      maxCompletionTokens: intIn(env.GROQ_MAX_TOKENS, 1500, 200, 8000, 'GROQ_MAX_TOKENS'),
    }),
    limits: Object.freeze({
      messagesPerMinute: intIn(env.CHAT_MESSAGES_PER_MINUTE, 20, 1, 500, 'CHAT_MESSAGES_PER_MINUTE'),
      maxMessageChars: 2000,
      maxHistory: 20,
      maxToolRounds: 6,
      // ≈1,500 tokens; the free Groq tier allows ~8k tokens a minute across every call of a turn.
      toolResultChars: 6000,
      backendTimeoutMs: 15000,
      backendMaxBytes: 4 * 1024 * 1024,
      confirmationTtlMs: 5 * 60 * 1000,
    }),
  });
}

module.exports = { loadConfig };
