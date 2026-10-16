// ---------------------------------------------------------------------------
// WEBSOCKET SERVER  (Phase 1 → Part X: WebSockets; Part IV auth)
//
// Upgrades an ordinary HTTP connection into a persistent, full-duplex WebSocket
// (Part X). Standard HTTP can't push; this can, so the server tells clients
// "a slot just got booked" the instant it happens, with no polling.
//
// Flow:
//   1. Client connects to  ws://host/ws?token=<JWT>. We authenticate the token
//      at the handshake (Part IV) — browsers can't set an Authorization header
//      on a WS handshake, so a query-param token is the common pattern.
//   2. Client sends {"action":"subscribe","resourceId":1} to receive updates for
//      a resource (and "unsubscribe" to stop).
//   3. When a booking event arrives from the pub/sub layer (possibly originating
//      on ANOTHER instance), we fan it out to every local socket subscribed to
//      that resource.
// ---------------------------------------------------------------------------

import { WebSocketServer } from 'ws';
import { verifyToken } from '../services/auth.service.js';
import { onBookingEvent } from './pubsub.js';
import { logger } from '../utils/logger.js';

export function attachWebSocketServer(httpServer) {
  // noServer: we handle the HTTP "upgrade" ourselves so we can authenticate
  // BEFORE completing the handshake, and only accept upgrades on the /ws path.
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy(); // not our endpoint
      return;
    }

    const token = url.searchParams.get('token');
    let user;
    try {
      const claims = verifyToken(token || ''); // throws if missing/invalid
      user = { id: claims.sub, role: claims.role };
    } catch {
      // Reject the handshake with a 401 before upgrading.
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      ws.subscriptions = new Set(); // resourceIds this socket cares about
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected', userId: ws.user.id }));

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }));
        return;
      }
      // Normalize resourceId to a string so comparisons are consistent (BIGINT
      // ids arrive as strings from the DB — the Part III number/string point).
      const rid = msg.resourceId != null ? String(msg.resourceId) : null;

      if (msg.action === 'subscribe' && rid) {
        ws.subscriptions.add(rid);
        ws.send(JSON.stringify({ type: 'subscribed', resourceId: rid }));
      } else if (msg.action === 'unsubscribe' && rid) {
        ws.subscriptions.delete(rid);
        ws.send(JSON.stringify({ type: 'unsubscribed', resourceId: rid }));
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'unknown action' }));
      }
    });
  });

  // Fan-out: every booking event (from ANY instance, via Redis) goes to each
  // local socket subscribed to that resource.
  onBookingEvent((event) => {
    const rid = String(event.resourceId);
    let delivered = 0;
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN && ws.subscriptions?.has(rid)) {
        ws.send(JSON.stringify(event));
        delivered += 1;
      }
    }
    if (delivered > 0) {
      logger.info({ type: event.type, resourceId: rid, delivered }, 'pushed real-time event');
    }
  });

  logger.info('WebSocket server attached at /ws');
  return wss;
}
