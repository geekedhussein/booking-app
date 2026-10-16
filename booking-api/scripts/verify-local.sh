#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# VERIFY THE WHOLE BACKEND ON THIS MACHINE  (not app code)
#
# Starts MongoDB (single-node replica set) and Redis in Docker, installs
# dependencies, migrates both databases, then runs every test tier plus the
# race demo and the demo seed. Prints a PASS/FAIL summary at the end and keeps
# the full output in verify-local.log.
#
#   bash scripts/verify-local.sh
#
# Needs: Node 22+, Docker (Docker Desktop, or Colima: `colima start`).
# Safe to rerun: migrations are idempotent and the seed skips a non-empty DB.
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")/.."
LOG="$PWD/verify-local.log"
: >"$LOG"
RESULTS=()

say() { printf '\n\033[1m== %s\033[0m\n' "$*" | tee -a "$LOG"; }
run() { # run "label" command...
  local label=$1
  shift
  say "$label"
  if "$@" 2>&1 | tee -a "$LOG"; then
    RESULTS+=("PASS  $label")
  else
    RESULTS+=("FAIL  $label")
  fi
}
summary() {
  local status=$?
  say "Summary"
  printf '%s\n' "${RESULTS[@]}" | tee -a "$LOG"
  echo "Full log: $LOG"
  # Exit non-zero if any step failed, so CI or a caller can tell.
  if printf '%s\n' "${RESULTS[@]}" | grep -q '^FAIL'; then exit 1; fi
  exit "$status"
}
trap summary EXIT
set -o pipefail

# --- prerequisites -----------------------------------------------------------
say "Prerequisites"
node -v | tee -a "$LOG"
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "Node 22+ is required." | tee -a "$LOG"
  RESULTS+=("FAIL  Node 22+")
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  if command -v colima >/dev/null; then
    echo "Docker isn't running; starting Colima..." | tee -a "$LOG"
    colima start 2>&1 | tee -a "$LOG"
  fi
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't reachable. Start Docker Desktop or Colima and rerun." | tee -a "$LOG"
  RESULTS+=("FAIL  Docker")
  exit 1
fi

[ -f .env ] || cp .env.example .env
[ -f .env.test ] || cp .env.test.example .env.test

# --- infrastructure ----------------------------------------------------------
run "Start MongoDB + Redis" docker compose up -d mongo redis
say "Wait for MongoDB to become replica-set primary"
for i in $(seq 1 60); do
  if docker compose exec -T mongo mongosh --quiet --eval 'quit(db.hello().isWritablePrimary ? 0 : 1)' >/dev/null 2>&1; then
    echo "primary after ${i}s" | tee -a "$LOG"
    break
  fi
  sleep 1
done
run "Replica set status" docker compose exec -T mongo mongosh --quiet --eval \
  'const s = rs.status(); print(s.set, s.members.map(m => m.name + " " + m.stateStr).join(", "))'

# --- app ---------------------------------------------------------------------
run "npm ci" npm ci --no-audit --no-fund
run "Lint" npm run lint
run "Migrate booking" npm run migrate
run "Migrate booking_test" node --env-file=.env.test src/db/migrate.js
run "Migrate again (must be a no-op)" npm run migrate
run "Unit tests" npm run test:unit
run "Integration tests" npm run test:integration
run "End-to-end tests" npm run test:e2e
run "Race demo" npm run demo:race
run "Seed demo data" npm run seed
