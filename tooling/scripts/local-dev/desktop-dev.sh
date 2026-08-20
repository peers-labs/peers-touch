#!/usr/bin/env bash
# desktop-dev.sh — Start Desktop for current worktree profile
# Usage: desktop-dev.sh [app|web]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

MODE="${1:-app}"

# Derive a stable port offset from WORKTREE_ID so each worktree gets
# deterministic, non-conflicting ports without explicit configuration.
# Range: 0–99, giving base+offset within safe ephemeral territory.
_wt_offset=$(printf '%s' "${WORKTREE_ID}" | cksum | awk '{print $1 % 100}')

case "$MODE" in
  app)
    export PT_PROFILE="${PT_DEV_PROFILE:-desktop}-app"
    _base_gw="${PT_DESKTOP_APP_GATEWAY_PORT:-3030}"
    _base_web="${PT_DESKTOP_APP_WEB_PORT:-3210}"
    export GATEWAY_PORT="$((_base_gw + _wt_offset))"
    export WEB_PORT="$((_base_web + _wt_offset))"
    ;;
  web)
    export PT_PROFILE="${PT_DEV_PROFILE:-desktop}-web"
    _base_gw="${PT_DESKTOP_WEB_GATEWAY_PORT:-3031}"
    _base_web="${PT_DESKTOP_WEB_WEB_PORT:-3211}"
    export GATEWAY_PORT="$((_base_gw + _wt_offset))"
    export WEB_PORT="$((_base_web + _wt_offset))"
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
