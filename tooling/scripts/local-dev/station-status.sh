#!/usr/bin/env bash
# station-status.sh — Show Station status for current profile.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

node "$SCRIPT_DIR/machine-dev.mjs" check \
  --workspace-root "$PROJECT_ROOT" \
  --env-repo "$PT_ENV_REPO" \
  --capabilities station.connect >/dev/null

if [[ "${PT_STATION_MODE:-local}" == "remote" ]]; then
  if [[ -z "${PT_STATION_DEPLOY_ENV:-}" ]]; then
    echo "[ERROR] PT_STATION_DEPLOY_ENV is not set. Cannot query remote deployment status."
    exit 1
  fi
  /bin/bash "$PROJECT_ROOT/tooling/scripts/deploy/deploy.sh" status "$PT_STATION_DEPLOY_ENV"
  /bin/bash "$SCRIPT_DIR/station-check.sh"
  exit 0
fi

/bin/bash "$SCRIPT_DIR/status.sh"
