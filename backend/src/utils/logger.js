/**
 * Structured logging (pino) with a request-scoped id on every line.
 *
 *   const { logger } = require('../utils/logger');
 *   logger.info({ orderId }, 'order confirmed');
 *   logger.error({ err }, 'payout failed');
 *
 * `requestId` middleware runs each request inside `runWithRequestContext`, so
 * `logger` (a proxy) resolves to a child logger carrying `requestId` while a
 * request is in flight and to the root logger otherwise (workers, boot).
 *
 * Rules: log ids, not documents; never a password, token or full address.
 * `{ err }` is serialised to type / code / message / stack frames only.
 * Output is JSON in production, pretty-printed in development, and silent
 * under tests unless LOG_LEVEL is set.
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const pino = require('pino');
const { env, UNDER_TEST } = require('../config/env');

const requestContext = new AsyncLocalStorage();

/** Keep the stack frames of an error without repeating its header line. */
function stackFrames(error) {
  const stack = typeof error.stack === 'string' ? error.stack.replace(/\r\n/g, '\n') : '';
  const frames = stack.split('\n').filter((line) => /^\s+at\s/.test(line));
  return frames.length ? frames.join('\n') : undefined;
}

/** Error → caller-safe object: class, code, status, message, frames, one level of cause. */
function safeError(error, depth = 0) {
  if (!(error instanceof Error)) return { type: typeof error, value: error === undefined ? undefined : String(error) };
  const out = { type: error.name, message: error.message };
  if (typeof error.code === 'string' || typeof error.code === 'number') out.code = error.code;
  if (Number.isInteger(error.status)) out.status = error.status;
  const frames = stackFrames(error);
  if (frames) out.stack = frames;
  if (depth === 0 && error.cause instanceof Error) out.cause = safeError(error.cause, 1);
  return out;
}

function levelFor() {
  if (env.LOG_LEVEL) return env.LOG_LEVEL;
  return UNDER_TEST ? 'silent' : 'info';
}

const rootLogger = pino({
  level: levelFor(),
  base: undefined, // no pid / hostname on every line
  serializers: { err: safeError, error: safeError },
  redact: {
    paths: ['password', '*.password', 'token', '*.token', 'authorization', '*.authorization', 'secret', '*.secret'],
    censor: '[redacted]',
  },
  ...(env.isProduction || UNDER_TEST
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }),
});

/** Run `fn` with a child logger bound to this request id. */
function runWithRequestContext(requestId, fn) {
  const child = rootLogger.child({ requestId });
  return requestContext.run({ requestId, logger: child }, fn);
}

function currentRequestId() {
  return requestContext.getStore()?.requestId;
}

/** Request-scoped logger inside a request, root logger otherwise. */
const logger = new Proxy(rootLogger, {
  get(target, prop, receiver) {
    const actual = requestContext.getStore()?.logger ?? target;
    const value = Reflect.get(actual, prop, receiver);
    return typeof value === 'function' ? value.bind(actual) : value;
  },
});

module.exports = { logger, rootLogger, safeError, runWithRequestContext, currentRequestId, requestContext };
