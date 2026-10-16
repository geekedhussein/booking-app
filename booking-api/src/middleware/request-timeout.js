// ---------------------------------------------------------------------------
// REQUEST TIMEOUT  (Phase 1 → Part IX: resource exhaustion defense)
//
// A request that never finishes (stuck query, dozing client) holds a connection
// open. Enough of them and the connection pool is exhausted and the whole service
// stalls. This middleware guarantees every request is bounded: if the response
// hasn't been sent within REQUEST_TIMEOUT_MS, we send a 503 and move on.
//
// Note: this ends the HTTP response, but it can't forcibly abort whatever async
// work is still running behind it (Node has no thread to kill). It protects the
// CLIENT experience and frees the socket; truly cancelling downstream work needs
// AbortSignal plumbed into DB/HTTP calls — a deeper enhancement.
// ---------------------------------------------------------------------------

import { config } from '../config/index.js';

export function requestTimeout(req, res, next) {
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({
        error: { code: 'TIMEOUT', message: 'Request timed out' },
        requestId: req.id,
      });
    }
  }, config.REQUEST_TIMEOUT_MS);

  // Always clear the timer once the response finishes, so it never fires late.
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
}
