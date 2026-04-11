#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# dev-desktop-web.sh — Desktop pure Web dev mode
#
# Change record:
# - Reason: split Desktop app/web startup into two independent scripts.
# - Change: this script now starts Vite only and no longer launches Tauri.
# - Impact: browser preview can run independently and concurrently with
#   dev-desktop.sh, which now owns App startup only.
#
# Usage:
#   ./tooling/scripts/dev-desktop-web.sh
#   Then open http://localhost:3210 in Chrome / Firefox / Safari.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"
WEB_PID_FILE="/tmp/peers-touch-desktop-web.pid"
WEB_PORT="${WEB_PORT:-3210}"
WEB_URL="http://localhost:$WEB_PORT"

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

web_listener_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$WEB_PORT" -sTCP:LISTEN 2>/dev/null || true
  fi
}

web_pid_alive() {
  if [[ -f "$WEB_PID_FILE" ]]; then
    local pid
    pid="$(cat "$WEB_PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && ps -p "$pid" >/dev/null 2>&1; then
      return 0
    fi
    rm -f "$WEB_PID_FILE"
  fi
  return 1
}

if web_is_listening; then
  LISTENER_PIDS="$(web_listener_pids | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  echo ""
  echo "┌──────────────────────────────────────────────────────┐"
  echo "│  Desktop Web dev is already running                  │"
  echo "│                                                      │"
  echo "│  Open in browser: $WEB_URL                           │"
  echo "│  PID            : ${LISTENER_PIDS:-unknown}                                │"
  echo "│                                                      │"
  echo "│  This script starts Vite only.                       │"
  echo "│  Run dev-desktop.sh separately for the App.          │"
  echo "└──────────────────────────────────────────────────────┘"
  echo ""
  exit 0
else
  echo ""
  echo "┌──────────────────────────────────────────────────────┐"
  echo "│  Peers Touch Desktop — Web Dev Mode                  │"
  echo "│                                                      │"
  echo "│  Browser URL: $WEB_URL                               │"
  echo "│  Starts     : Vite only                              │"
  echo "│                                                      │"
  echo "│  Run dev-desktop.sh in another terminal if you       │"
  echo "│  also want the App window at the same time.          │"
  echo "│                                                      │"
  echo "│  tsx/css changes → instant hot reload                │"
  echo "│                                                      │"
  echo "│  Ctrl+C to stop                                      │"
  echo "└──────────────────────────────────────────────────────┘"
  echo ""
fi

pnpm dev &
WEB_PID=$!
echo "$WEB_PID" > "$WEB_PID_FILE"

cleanup() {
  if [[ -n "${WEB_PID:-}" ]] && ps -p "$WEB_PID" >/dev/null 2>&1; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  rm -f "$WEB_PID_FILE"
}
trap cleanup EXIT INT TERM

for _ in {1..60}; do
  if ! ps -p "$WEB_PID" >/dev/null 2>&1; then
    echo "[ERROR] Vite dev process exited unexpectedly"
    exit 1
  fi
  if web_is_listening; then
    echo "[INFO] Desktop Web ready: $WEB_URL"
    wait "$WEB_PID"
    exit $?
  fi
  sleep 1
done

echo "[ERROR] Vite dev server did not start within 60s"
exit 1
