// ---------------------------------------------------------------------------
// SERVER ENTRYPOINT  (Phase 1 → Part VIII: Graceful Shutdown + fail-fast)
//
// This file owns the process lifecycle: start listening, and shut down cleanly
// when told to. Everything about *building* the app lives in app.js; everything
// about *running* it lives here.
// ---------------------------------------------------------------------------

import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { closeDb } from './db/index.js';
import { closeCache } from './cache/index.js';
import { closeQueue } from './queue/notifications.js';
import { attachWebSocketServer } from './realtime/ws.js';
import { closePubSub } from './realtime/pubsub.js';

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(
    `Booking API listening on http://localhost:${config.PORT}  [env: ${config.NODE_ENV}]`,
  );
});

// Attach the WebSocket server to the SAME HTTP server (Part X): WS starts life as
// an HTTP "upgrade" request, so they share a port.
attachWebSocketServer(server);

// --- GRACEFUL SHUTDOWN (Part VIII) -----------------------------------------
// When an orchestrator (or you pressing Ctrl-C) sends a termination signal, we:
//   1. stop accepting NEW connections,
//   2. let IN-FLIGHT requests finish (draining),
//   3. exit cleanly.
// Without this, every deploy/scale-down abruptly kills live requests and users
// see broken responses on EVERY release. `shuttingDown` guards against a second
// signal re-triggering the sequence.

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — beginning graceful shutdown`);

  // server.close() stops new connections; the callback fires once existing
  // requests have drained. Then we close the queue, pub/sub, cache and database
  // connections, in reverse order of how the request path uses them.
  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'Error during server close');
      process.exit(1);
    }
    // Close backing resources in reverse order of importance, AFTER in-flight
    // requests have drained (Part VIII). Each is wrapped to not block the others.
    await Promise.allSettled([closeQueue(), closePubSub(), closeCache(), closeDb()]);
    logger.info('All in-flight requests finished and resources closed — exiting cleanly');
    process.exit(0);
  });

  // Safety net: if draining hangs (e.g. a stuck long-lived connection), force
  // exit after the configured timeout rather than hanging forever. .unref() so
  // this timer itself never keeps the process alive.
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM')); // sent by orchestrators/Docker
process.on('SIGINT', () => shutdown('SIGINT')); //  sent by Ctrl-C in a terminal

// --- CRASH ON PROGRAMMER ERRORS (Part VIII: fail-fast) ---------------------
// An uncaught exception or unhandled promise rejection means the process is in
// an unknown, possibly-corrupted state. The safe move is to log loudly and let
// the process exit so a supervisor restarts it fresh — NOT to swallow it and
// limp onward.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — crashing');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection — crashing');
  process.exit(1);
});
