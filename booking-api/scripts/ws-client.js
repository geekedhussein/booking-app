// DEMO client: connects to a WS server, subscribes to a resource, logs events.
// Usage: node scripts/ws-client.js <port> <token> <resourceId>
import WebSocket from 'ws';

const [, , port, token, resourceId] = process.argv;
const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);

ws.on('open', () => {
  console.log(`[client] connected to instance on port ${port}`);
  ws.send(JSON.stringify({ action: 'subscribe', resourceId }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  console.log('[client] received:', JSON.stringify(msg));
});

ws.on('error', (err) => console.error('[client] error:', err.message));

// Exit after 8 seconds so the demo terminates on its own.
setTimeout(() => {
  ws.close();
  process.exit(0);
}, 8000);
