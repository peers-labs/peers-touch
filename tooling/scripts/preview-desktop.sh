#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# preview-desktop.sh — Production-like preview (loads from dist/)
#
# Unlike dev-desktop.sh (HMR mode), this script builds the
# frontend into dist/ and loads it statically, mimicking the
# production build. Use this for final verification before release.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"
VITE_PORT="${VITE_PORT:-3000}"
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

if command -v lsof >/dev/null 2>&1; then
  PORT_PIDS="$(lsof -tiTCP:"$VITE_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${PORT_PIDS:-}" ]]; then
    echo "[INFO] port $VITE_PORT is in use, killing listener process(es): $PORT_PIDS"
    while IFS= read -r pid; do
      [[ -n "${pid:-}" ]] || continue
      kill "$pid" 2>/dev/null || true
    done <<< "$PORT_PIDS"
    sleep 1
  fi
fi

cd "$DESKTOP_DIR"

echo "[INFO] building frontend..."
pnpm build

echo "[INFO] building Rust BFF (if needed)..."
(cd src-tauri && cargo build 2>&1 | tail -3)

BINARY="$DESKTOP_DIR/src-tauri/target/debug/peers-touch-desktop"
if [[ ! -f "$BINARY" ]]; then
  echo "[ERROR] Rust binary not found: $BINARY"
  exit 1
fi

echo "[INFO] starting desktop preview (production-like)..."
"$BINARY" &
echo $! > "$DESKTOP_PID_FILE"
echo "[INFO] pid: $(cat "$DESKTOP_PID_FILE")"
echo "[INFO] close desktop app or Ctrl+C to stop"
wait
