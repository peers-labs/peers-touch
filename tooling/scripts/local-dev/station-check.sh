#!/usr/bin/env bash
# station-check.sh — Health probe only; never starts or deploys Station.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

STATION_URL="${PT_STATION_URL:-http://127.0.0.1:18080}"
STATION_CHECK_URL="${PT_STATION_HEALTH_URL:-$STATION_URL/api/oauth/providers}"

node "$SCRIPT_DIR/machine-dev.mjs" check \
  --workspace-root "$PROJECT_ROOT" \
  --env-repo "$PT_ENV_REPO" \
  --capabilities station.connect >/dev/null

echo "[INFO] Station health check"
echo "       URL   : $STATION_URL"
echo "       Probe : $STATION_CHECK_URL"

if curl -fsS -m 5 "$STATION_CHECK_URL" >/dev/null 2>&1; then
  echo "       Status: ready"
  exit 0
fi

echo "       Status: NOT reachable"
exit 1
