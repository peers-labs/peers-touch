#!/usr/bin/env bash
# desktop-dev.sh — Start Desktop for current worktree profile
# Usage: desktop-dev.sh [app|web]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

MODE="${1:-app}"

if [[ "${PT_MACHINE_LEASE_KIND:-}" == "local.slot" ]] \
  && [[ "${PT_MACHINE_LEASE_RESOURCE_ID:-}" == "$PT_DEV_SLOT" ]]; then
  node "$SCRIPT_DIR/machine-dev.mjs" verify-held \
    --workspace-root "$PROJECT_ROOT" \
    --resource-kind local.slot \
    --resource-id "$PT_DEV_SLOT" >/dev/null
else
  exec node "$SCRIPT_DIR/machine-dev.mjs" lease \
    --workspace-root "$PROJECT_ROOT" \
    --env-repo "$PT_ENV_REPO" \
    --resource-kind local.slot \
    --resource-id "$PT_DEV_SLOT" \
    --budget-seconds "${PT_LOCAL_SLOT_LEASE_BUDGET_SECONDS:-43200}" \
    -- /bin/bash "$0" "$MODE"
fi

_caller_gw="${PT_GATEWAY_PORT:-}"
_caller_web="${PT_RENDERER_PORT:-}"
_caller_profile="${PT_PROFILE:-}"

case "$MODE" in
  app)
    export PT_PROFILE="${_caller_profile:-${PT_DEV_PROFILE:-desktop}-app}"
    export GATEWAY_PORT="${_caller_gw:-${PT_DESKTOP_APP_GATEWAY_PORT}}"
    export WEB_PORT="${_caller_web:-${PT_DESKTOP_APP_WEB_PORT}}"
    ;;
  web)
    export PT_PROFILE="${_caller_profile:-${PT_DEV_PROFILE:-desktop}-web}"
    export GATEWAY_PORT="${_caller_gw:-${PT_DESKTOP_WEB_GATEWAY_PORT}}"
    export WEB_PORT="${_caller_web:-${PT_DESKTOP_WEB_WEB_PORT}}"
    ;;
  *)
    echo "[ERROR] Usage: desktop-dev.sh [app|web]"
    exit 1
    ;;
esac

export PEERS_STATION_URL="${PT_STATION_URL:-http://127.0.0.1:18080}"
export STATION_HEALTHCHECK_URL="${PT_STATION_HEALTH_URL:-$PEERS_STATION_URL/api/oauth/providers}"
export PEERS_STATION_MODE="${PT_STATION_MODE:-local}"
export STATION_PORT="${PT_STATION_PORT:-18080}"
export PEERS_STORAGE_ROOT="${PEERS_STORAGE_ROOT:-$PT_DEV_DATA/desktop-$MODE}"

node "$SCRIPT_DIR/machine-dev.mjs" check \
  --workspace-root "$PROJECT_ROOT" \
  --env-repo "$PT_ENV_REPO" \
  --capabilities station.connect >/dev/null

# Ensure Station is reachable (don't redeploy if already running)
if [[ "${PT_STATION_MODE:-local}" == "remote" ]]; then
  if curl -fsS -m 3 "$STATION_HEALTHCHECK_URL" >/dev/null 2>&1; then
    echo "[OK] Station already running: $PEERS_STATION_URL"
  else
    bash "$SCRIPT_DIR/station-dev.sh"
  fi
else
  bash "$SCRIPT_DIR/station-dev.sh"
fi

# Delegate to existing desktop script
DESKTOP_SCRIPT="$PROJECT_ROOT/tooling/scripts/dev-desktop-${MODE}.sh"
if [[ "$MODE" == "app" ]]; then
  DESKTOP_SCRIPT="$PROJECT_ROOT/tooling/scripts/dev-desktop-app.sh"
else
  DESKTOP_SCRIPT="$PROJECT_ROOT/tooling/scripts/dev-desktop-web.sh"
fi

exec "$DESKTOP_SCRIPT"
