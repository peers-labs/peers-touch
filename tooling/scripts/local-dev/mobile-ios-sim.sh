#!/usr/bin/env bash
# mobile-ios-sim.sh — Start Mobile iOS Simulator for current worktree profile
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

export PEERS_STATION_URL="${PT_STATION_URL:?Reviewed Station URL is required}"
MOBILE_WEB_PORT="${PT_MOBILE_WEB_PORT:?Machine Mobile port is required}"
export VITE_DEFAULT_STATION_URL="$PEERS_STATION_URL"
export VITE_DEV_SERVER_PORT="$MOBILE_WEB_PORT"
export MOBILE_TAURI_DEV_CONFIG="$PT_DEV_DATA/mobile-tauri-dev.json"

node "$SCRIPT_DIR/machine-dev.mjs" check \
  --workspace-root "$PROJECT_ROOT" \
  --env-repo "$PT_ENV_REPO" \
  --capabilities station.connect >/dev/null

# Connection is an observation. An offline Station does not trigger equipment.
if ! curl --silent --fail --max-time 3 "$PEERS_STATION_URL/health" >/dev/null; then
  echo "Station is unavailable at $PEERS_STATION_URL; Mobile starts with this configured origin." >&2
fi
echo "Profile: $PT_DEV_PROFILE · Station: $PEERS_STATION_URL · Vite: $MOBILE_WEB_PORT"
exec /bin/bash "$PROJECT_ROOT/apps/mobile/scripts/ios-dev-sim.sh" "$@"
