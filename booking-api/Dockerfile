# =============================================================================
# Dockerfile  (Phase 1 → Part XI: containers)
#
# A container packages the app WITH its exact runtime (Node version, installed
# deps) so it runs identically on your laptop, CI, and production — killing
# "works on my machine" (Part XI). One image runs the API, the worker, AND
# migrations; docker-compose picks which command each container runs.
#
# Multi-stage build: the "deps" stage installs production dependencies; the final
# stage copies only what's needed, keeping the runtime image small and free of
# build tooling.
# =============================================================================

# ---- Stage 1: install production dependencies -------------------------------
FROM node:22-slim AS deps
WORKDIR /app
# Copy only manifests first so this layer is cached and reused unless deps change
# (a Docker layer-caching optimization — faster rebuilds).
COPY package.json package-lock.json* ./
# npm ci = clean, reproducible install from the lockfile (12-Factor: explicit,
# isolated dependencies — Part XI). --omit=dev leaves out test/dev tooling.
RUN npm ci --omit=dev

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Run as a NON-ROOT user (Part IX: least privilege). node:22-slim ships a
# pre-created 'node' user. A container compromise then can't act as root.
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
USER node

EXPOSE 3000

# Liveness check (Part I/XI): the orchestrator polls /health and replaces the
# container if it stops answering. Uses Node itself, so no extra tools needed.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default command runs the API server. Compose overrides this for the worker and
# migration containers.
CMD ["node", "src/server.js"]
