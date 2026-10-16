import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser talks to ONE origin (Vite). Vite forwards API,
// docs and WebSocket traffic to the backend, so there is no CORS to configure
// and cookies/headers behave like production behind a reverse proxy.
const target = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000';

const proxy = {
  '/v1': target,
  '/docs': target,
  '/ws': { target: target.replace(/^http/, 'ws'), ws: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
