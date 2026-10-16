import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAccessToken, socketUrl } from '../lib/api.js';

/**
 * Live booking events for one resource (backend Milestone 8 + the V2.3 outbox
 * relay). On any event we invalidate the cached schedule, so the day track and
 * slot list redraw without a refresh.
 *
 * The token is only checked at the WebSocket handshake and access tokens live
 * 15 minutes, so every (re)connect fetches a fresh one. Reconnects back off
 * exponentially up to 30s.
 */
export function useBookingSocket(resourceId, { enabled = true, onEvent } = {}) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled || !resourceId) return undefined;
    let socket;
    let retryTimer;
    let attempt = 0;
    let stopped = false;

    async function connect() {
      const token = await getAccessToken();
      if (stopped || !token) return;
      socket = new WebSocket(socketUrl(token));

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        socket.send(JSON.stringify({ action: 'subscribe', resourceId: String(resourceId) }));
      };

      socket.onmessage = (msg) => {
        let event;
        try {
          event = JSON.parse(msg.data);
        } catch {
          return;
        }
        if (!event.type?.startsWith('booking.')) return;
        queryClient.invalidateQueries({ queryKey: ['schedule', String(resourceId)] });
        queryClient.invalidateQueries({ queryKey: ['dayBookings', String(resourceId)] });
        queryClient.invalidateQueries({ queryKey: ['providerBookings'] });
        onEventRef.current?.(event);
      };

      socket.onclose = () => {
        setConnected(false);
        if (stopped) return;
        attempt += 1;
        retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt));
      };

      socket.onerror = () => socket.close();
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [resourceId, enabled, queryClient]);

  return { connected };
}
