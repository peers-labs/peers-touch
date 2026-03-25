#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"
WEB_PID_FILE="/tmp/peers-touch-desktop-web.pid"
DESKTOP_PID_FILE="/tmp/peers-touch-desktop-tauri.pid"
source "$SCRIPT_DIR/_ensure-station.sh"

if [[ ! -d "$DESKTOP_DIR" ]]; then
  echo "[ERROR] desktop app dir not found: $DESKTOP_DIR"
  exit 1
fi

ensure_station_ready "$PROJECT_ROOT"

if [[ -f "$WEB_PID_FILE" ]]; then
  OLD_WEB_PID="$(cat "$WEB_PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD_WEB_PID:-}" ]] && ps -p "$OLD_WEB_PID" >/dev/null 2>&1; then
    echo "[INFO] stopping web preview process to avoid Vite port conflict: $OLD_WEB_PID"
    kill "$OLD_WEB_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$WEB_PID_FILE"
fi

if [[ -f "$DESKTOP_PID_FILE" ]]; then
  OLD_PID="$(cat "$DESKTOP_PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD_PID:-}" ]] && ps -p "$OLD_PID" >/dev/null 2>&1; then
    echo "[INFO] stopping previous desktop preview process: $OLD_PID"
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$DESKTOP_PID_FILE"
fi

cd "$DESKTOP_DIR"

if command -v pnpm >/dev/null 2>&1 && [[ -f "pnpm-lock.yaml" ]]; then
  CMD=(pnpm tauri:dev -- --no-watch)
else
  CMD=(npm run tauri:dev -- --no-watch)
fi

echo "[INFO] starting desktop preview (tauri)..."
"${CMD[@]}" &
echo $! > "$DESKTOP_PID_FILE"
echo "[INFO] pid: $(cat "$DESKTOP_PID_FILE")"
echo "[INFO] close desktop app or Ctrl+C to stop"
wait
