// ---------------------------------------------------------------------------
// TRACING  (V2.11 → Part VIII: the traces pillar)
//
// A trace answers "where did the time go for THIS request?" — a tree of timed
// spans (HTTP handler → service → each DB query), all carrying the request id so
// you can reconstruct one request's journey across layers (and, in a multi-service
// system, across services).
//
// This is a deliberately small, dependency-free implementation using Node's
// AsyncLocalStorage, which propagates context through async calls WITHOUT having
// to thread a "ctx" parameter through every function signature. It emits spans to
// the logger; swapping in OpenTelemetry later means replacing this module's
// internals while `withSpan` callers stay unchanged.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

const storage = new AsyncLocalStorage();

/** Start a trace for a request; everything inside shares this context. */
export function runInTrace({ traceId = randomUUID(), attributes = {} }, fn) {
  return storage.run({ traceId, spans: [], attributes }, fn);
}

export function currentTrace() {
  return storage.getStore() ?? null;
}

/**
 * Time an operation as a span within the current trace.
 *   const user = await withSpan('users.lookup', { id }, () => findUserById(id));
 * Records duration and errors; a no-op (just runs fn) outside a trace.
 */
export async function withSpan(name, attributes, fn) {
  const trace = currentTrace();
  const start = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    trace?.spans.push({ name, ms: Number(ms.toFixed(2)), ...attributes });
  }
}

/** Emit the completed trace as one structured log line. */
export function finishTrace({ route, status, ms }) {
  const trace = currentTrace();
  if (!trace) return;
  // Only log the span breakdown for slow requests — tracing everything is
  // expensive and noisy; real systems SAMPLE. This is a simple latency-based
  // sampler: always keep the slow ones, which are the interesting ones.
  if (ms > 250 || status >= 500) {
    logger.info(
      { traceId: trace.traceId, route, status, totalMs: ms, spans: trace.spans },
      'trace',
    );
  }
}
