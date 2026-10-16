// ---------------------------------------------------------------------------
// HEALTH ROUTES  (Part I/XI; V2.11 liveness vs readiness)
//
// TWO different questions, deliberately separate:
//
//   /health/live  — "is the process alive?" Dependency-FREE. If this fails the
//                   orchestrator RESTARTS the container. It must never check the
//                   database: a slow DB would make every instance look dead and
//                   trigger a fleet-wide restart storm.
//
//   /health/ready — "can this instance SERVE traffic right now?" Checks the DB
//                   and Redis. If this fails the load balancer stops ROUTING to
//                   this instance without killing it — it can recover on its own.
//
// /health stays as an alias for liveness (backward compatible, unversioned).
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { ping } from '../db/index.js';
import { redis } from '../cache/redis.js';
import { registry } from '../observability/metrics.js';
import { timeoutAfter } from '../utils/sleep.js';

export const healthRouter = Router();

function liveness(_req, res) {
  res.status(200).json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()) });
}

healthRouter.get('/', liveness);
healthRouter.get('/live', liveness);

healthRouter.get('/ready', async (_req, res) => {
  const checks = {};

  // Each dependency is probed with a short timeout — a readiness check must
  // itself be fast, or it becomes the outage.
  try {
    await Promise.race([ping(), timeoutAfter(2000)]);
    checks.database = 'ok';
  } catch (err) {
    checks.database = `error: ${err.message}`;
  }

  try {
    await Promise.race([redis.ping(), timeoutAfter(2000)]);
    checks.redis = 'ok';
  } catch (err) {
    checks.redis = `error: ${err.message}`;
  }

  // The database is REQUIRED to serve traffic. Redis is not: the cache degrades
  // gracefully (V2.1), so a Redis blip shouldn't pull the instance out of
  // rotation — it's reported but doesn't fail readiness.
  const ready = checks.database === 'ok';
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
});

// Prometheus scrape endpoint (V2.11). Unversioned, like health — infrastructure,
// not part of the API contract.
healthRouter.get('/metrics', async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});
