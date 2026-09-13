#!/usr/bin/env bash
# mobile-ios-sim.sh — Start Mobile iOS Simulator for current worktree profile
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

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
    -- /bin/bash "$0"
fi

export PEERS_STATION_URL="${PT_STATION_URL:-http://127.0.0.1:18080}"
MOBILE_WEB_PORT="${PT_MOBILE_WEB_PORT:-5173}"
export VITE_DEFAULT_STATION_URL="$PEERS_STATION_URL"
export VITE_DEV_SERVER_PORT="$MOBILE_WEB_PORT"
export MOBILE_TAURI_DEV_CONFIG="$PT_DEV_DATA/mobile-tauri-dev.json"

node "$SCRIPT_DIR/machine-dev.mjs" check \
  --workspace-root "$PROJECT_ROOT" \
  --env-repo "$PT_ENV_REPO" \
  --capabilities station.connect >/dev/null

# Ensure Station
bash "$SCRIPT_DIR/station-dev.sh"

echo ""
echo "  ┌─────────────────────────────────────────────────────────┐"
echo "  │  Peers Touch Mobile — iOS Simulator                     │"
echo "  │                                                         │"
echo "  │  Profile : ${PT_DEV_PROFILE:-default}                   │"
echo "  │  Station : $PEERS_STATION_URL                           │"
echo "  │  Vite    : :$MOBILE_WEB_PORT                            │"
echo "  │                                                         │"
echo "  │  Station URL above can be entered in the Mobile app     │"
echo "  │  station selector, or set VITE_DEFAULT_STATION_URL.     │"
echo "  │                                                         │"
echo "  │  Ctrl+C to stop                                         │"
echo "  └─────────────────────────────────────────────────────────┘"
echo ""

cd "$PROJECT_ROOT"
source "$HOME/.cargo/env" 2>/dev/null || true
pnpm --dir apps/mobile run tauri:ios:dev
