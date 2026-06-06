#!/usr/bin/env bash
# mobile-ios-sim.sh — Start Mobile iOS Simulator for current worktree profile
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

export PEERS_STATION_URL="${PT_STATION_URL:-http://127.0.0.1:18080}"
MOBILE_WEB_PORT="${PT_MOBILE_WEB_PORT:-5173}"
export VITE_DEFAULT_STATION_URL="$PEERS_STATION_URL"
export VITE_DEV_SERVER_PORT="$MOBILE_WEB_PORT"
export MOBILE_TAURI_DEV_CONFIG="$PT_DEV_DATA/mobile-tauri-dev.json"

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
