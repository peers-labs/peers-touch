#!/usr/bin/env bash
# relay-logs.sh — Show Relay logs for current profile.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

if [[ "${PT_RELAY_MODE:-remote}" == "remote" ]]; then
  if [[ -z "${PT_RELAY_DEPLOY_ENV:-}" ]]; then
    echo "[ERROR] PT_RELAY_DEPLOY_ENV is not set. Cannot query remote logs."
    exit 1
  fi
  exec /bin/bash "$PROJECT_ROOT/tooling/scripts/deploy/deploy.sh" logs "$PT_RELAY_DEPLOY_ENV"
fi

log_file="$PT_DEV_LOGS/relay.log"
echo "[INFO] Local Relay log: $log_file"
tail -n 80 "$log_file" 2>/dev/null || echo "[INFO] No local Relay log found"
