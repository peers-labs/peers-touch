#!/usr/bin/env bash
# relay-status.sh — Show Relay status for current profile.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

if [[ "${PT_RELAY_MODE:-remote}" == "remote" ]]; then
  if [[ -z "${PT_RELAY_DEPLOY_ENV:-}" ]]; then
    echo "[ERROR] PT_RELAY_DEPLOY_ENV is not set. Cannot query remote deployment status."
    exit 1
  fi
  /bin/bash "$PROJECT_ROOT/tooling/scripts/deploy/deploy.sh" status "$PT_RELAY_DEPLOY_ENV"
  /bin/bash "$SCRIPT_DIR/relay-check.sh"
  exit 0
fi

/bin/bash "$SCRIPT_DIR/status.sh"
