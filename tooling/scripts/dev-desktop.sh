#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# dev-desktop.sh — Desktop pure App dev mode
#
# Change record:
# - Reason: split Desktop app/web startup into two independent scripts.
# - Change: this script now starts Tauri App only and relies on an external
#   Vite dev server instead of launching beforeDevCommand itself.
# - Impact: App and Web can run simultaneously in separate terminals without
#   one script implicitly starting the other.
#
# Usage:
#   1. Run ./tooling/scripts/dev-desktop-web.sh
#   2. Run ./tooling/scripts/dev-desktop.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"
APP_PID_FILE="/tmp/peers-touch-desktop-app.pid"
WEB_PORT="${WEB_PORT:-3210}"
WEB_URL="http://localhost:$WEB_PORT"
TAURI_APP_CONFIG='{"build":{"beforeDevCommand":"echo [INFO] external web dev server mode"}}'

source "$SCRIPT_DIR/_ensure-station.sh"

if [[ ! -d "$DESKTOP_DIR" ]]; then
  echo "[ERROR] desktop app dir not found: $DESKTOP_DIR"
  exit 1
fi

ensure_station_ready "$PROJECT_ROOT"

cd "$DESKTOP_DIR"

web_is_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1
  else
    curl -fsS -m 1 "$WEB_URL" >/dev/null 2>&1
  fi
}

app_pid_alive() {
  if [[ -f "$APP_PID_FILE" ]]; then
    local pid
    pid="$(cat "$APP_PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && ps -p "$pid" >/dev/null 2>&1; then
      return 0
    fi
    rm -f "$APP_PID_FILE"
  fi
  return 1
}

if ! web_is_listening; then
  echo "[ERROR] Desktop Web dev server is not running: $WEB_URL"
  echo "[INFO] Please start it first: ./tooling/scripts/dev-desktop-web.sh"
  exit 1
fi

if app_pid_alive; then
  echo "[INFO] Desktop App dev is already running (pid: $(cat "$APP_PID_FILE"))"
  exit 0
fi

echo ""
echo "┌──────────────────────────────────────────────┐"
echo "│  Peers Touch Desktop — App Dev Mode          │"
echo "│                                              │"
echo "│  Frontend : external Vite on 3210            │"
echo "│  App      : Tauri window only                │"
echo "│                                              │"
echo "│  Start web : dev-desktop-web.sh              │"
echo "│  This script does not start Vite             │"
echo "│                                              │"
echo "│  tsx/css changes → instant hot reload        │"
echo "│  .rs changes     → auto recompile + reload   │"
echo "│                                              │"
echo "│  Ctrl+C to stop                              │"
echo "└──────────────────────────────────────────────┘"
echo ""

pnpm tauri dev --config "$TAURI_APP_CONFIG" &
APP_PID=$!
echo "$APP_PID" > "$APP_PID_FILE"

cleanup() {
  if [[ -n "${APP_PID:-}" ]] && ps -p "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" 2>/dev/null || true
  fi
  rm -f "$APP_PID_FILE"
}
trap cleanup EXIT INT TERM
wait "$APP_PID"
