#!/usr/bin/env bash
# station-logs.sh — Show Station logs for current profile.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

node "$SCRIPT_DIR/machine-dev.mjs" check \
  --workspace-root "$PROJECT_ROOT" \
  --env-repo "$PT_ENV_REPO" \
  --capabilities station.connect >/dev/null

if [[ "${PT_STATION_MODE:-local}" == "remote" ]]; then
  if [[ -z "${PT_STATION_DEPLOY_ENV:-}" ]]; then
    echo "[ERROR] PT_STATION_DEPLOY_ENV is not set. Cannot query remote logs."
    exit 1
  fi
  exec /bin/bash "$PROJECT_ROOT/tooling/scripts/deploy/deploy.sh" logs "$PT_STATION_DEPLOY_ENV"
fi

log_file="$PT_DEV_LOGS/station.log"
echo "[INFO] Local Station log: $log_file"
tail -n 80 "$log_file" 2>/dev/null || echo "[INFO] No local Station log found"
