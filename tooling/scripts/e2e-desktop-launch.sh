#!/usr/bin/env bash
# e2e-desktop-launch.sh — Launch Desktop for full E2E with injected env vars
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Inherit all PEERS_ATELIER_FULL_E2E_* env vars from parent
export PT_STATION_SKIP_DEPLOY=true
export PT_STATION_MODE=remote
export PEERS_STATION_URL="${PEERS_STATION_URL:-http://10.37.94.156:18080}"
export STATION_PORT="${PT_STATION_PORT:-18080}"
export GATEWAY_PORT="${PT_DESKTOP_APP_GATEWAY_PORT:-3230}"
export WEB_PORT="${PT_DESKTOP_APP_WEB_PORT:-3410}"
export PT_PROFILE="${PT_DEV_PROFILE:-three}-app"

source "$SCRIPT_DIR/_ensure-station.sh"
source "$SCRIPT_DIR/_ensure-desktop-rust.sh"
source "$SCRIPT_DIR/_ensure-desktop-vite.sh"

DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"

ensure_station_ready "$PROJECT_ROOT"
ensure_desktop_vite_ready "$DESKTOP_DIR" "$WEB_PORT" "$GATEWAY_PORT" "$PT_PROFILE"
ensure_desktop_rust_ready "$DESKTOP_DIR" "$GATEWAY_PORT" "$PT_PROFILE" "$WEB_PORT"

echo "[E2E] Desktop launched for full E2E"
# Keep alive until killed
while true; do sleep 10; done
