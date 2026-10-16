// ---------------------------------------------------------------------------
// METRICS MIDDLEWARE  (V2.11)
//
// Times every request and records it against the ROUTE PATTERN, not the raw URL
// (the cardinality rule — see observability/metrics.js).
//
// A wrinkle worth knowing: when a handler errors, Express unwinds to the error
// handler and RESETS req.baseUrl to '' before the response 'finish' event fires
// (req.route survives). So labelling purely at finish time would drop the mount
// prefix and report '/:id' instead of '/v1/bookings/:id'. We therefore capture
// baseUrl inside the router (`captureMountPath`, mounted on each router) where
// it's still correct, and combine the two at finish time.
// ---------------------------------------------------------------------------

import { httpRequestDuration, httpRequestsTotal } from '../observability/metrics.js';

/** Mount FIRST inside a router to remember its mount path for metrics. */
export function captureMountPath(req, _res, next) {
  if (req.baseUrl) req._mountPath = req.baseUrl;
  next();
}

function routePattern(req) {
  const mount = req.baseUrl || req._mountPath || '';
  if (req.route?.path) {
    return `${mount}${req.route.path}`.replace(/\/$/, '') || '/';
  }
  // No route matched (404s from unknown paths). Bucket them together so a
  // scanner hitting random URLs can't explode our label cardinality.
  return 'unmatched';
}

export function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = {
      method: req.method,
      route: routePattern(req),
      status: String(res.statusCode),
    };
    httpRequestDuration.observe(labels, seconds);
    httpRequestsTotal.inc(labels);
  });

  next();
}
