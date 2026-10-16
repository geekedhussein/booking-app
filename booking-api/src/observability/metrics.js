// ---------------------------------------------------------------------------
// METRICS  (V2.11 → Part VIII: the metrics pillar)
//
// Logs describe individual events; metrics describe AGGREGATE behaviour over
// time — request rate, error rate, latency distribution, queue depth. A scraper
// (Prometheus) polls /metrics on an interval and stores the series.
//
// THE CARDINALITY RULE: label by ROUTE PATTERN ('/v1/bookings/:id'), never by the
// actual path ('/v1/bookings/12345'). Every distinct label combination is its own
// time series — labelling by id would create one series per booking and melt the
// metrics backend. Same reason we don't label by user id or request id.
// ---------------------------------------------------------------------------

import client from 'prom-client';

export const registry = new client.Registry();

// Process-level metrics (CPU, memory, event-loop lag, handles). Event-loop lag is
// especially valuable in Node: it's the direct signal that something is blocking
// the single thread (Part IX concurrency).
client.collectDefaultMetrics({ register: registry });

// --- HTTP metrics -----------------------------------------------------------
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status'],
  // Buckets chosen around expected API latencies; a histogram lets you compute
  // p50/p95/p99 at query time rather than pre-committing to an average.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

// --- Domain metrics ---------------------------------------------------------
// Business-level counters are often MORE useful than infrastructure ones: a
// spike in booking_conflicts_total tells you something real about contention.
export const bookingsCreatedTotal = new client.Counter({
  name: 'bookings_created_total',
  help: 'Bookings successfully created',
  registers: [registry],
});

export const bookingConflictsTotal = new client.Counter({
  name: 'booking_conflicts_total',
  help: 'Booking attempts rejected for lack of capacity',
  registers: [registry],
});

export const outboxPendingGauge = new client.Gauge({
  name: 'outbox_pending_events',
  help: 'Outbox rows awaiting delivery (rising = the relay is falling behind)',
  registers: [registry],
});

export const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query latency in seconds',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});
