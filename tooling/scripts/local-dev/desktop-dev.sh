#!/usr/bin/env bash
# desktop-dev.sh — Start Desktop for current worktree profile
# Usage: desktop-dev.sh [app|web]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

MODE="${1:-app}"

case "$MODE" in
  app)
    export PT_PROFILE="${PT_DEV_PROFILE:-desktop}-app"
    export GATEWAY_PORT="${PT_DESKTOP_APP_GATEWAY_PORT:-3030}"
    export WEB_PORT="${PT_DESKTOP_APP_WEB_PORT:-3210}"
    ;;
  web)
    export PT_PROFILE="${PT_DEV_PROFILE:-desktop}-web"
    export GATEWAY_PORT="${PT_DESKTOP_WEB_GATEWAY_PORT:-3031}"
    export WEB_PORT="${PT_DESKTOP_WEB_WEB_PORT:-3211}"
    ;;
  *)
    echo "[ERROR] Usage: desktop-dev.sh [app|web]"
    exit 1
    ;;
esac

export PEERS_STATION_URL="${PT_STATION_URL:-http://127.0.0.1:18080}"
export STATION_PORT="${PT_STATION_PORT:-18080}"

# Ensure Station
bash "$SCRIPT_DIR/station-dev.sh"

# Delegate to existing desktop script
DESKTOP_SCRIPT="$PROJECT_ROOT/tooling/scripts/dev-desktop-${MODE}.sh"
if [[ "$MODE" == "app" ]]; then
  DESKTOP_SCRIPT="$PROJECT_ROOT/tooling/scripts/dev-desktop-app.sh"
else
  DESKTOP_SCRIPT="$PROJECT_ROOT/tooling/scripts/dev-desktop-web.sh"
fi

exec "$DESKTOP_SCRIPT"
