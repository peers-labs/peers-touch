#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"
PID_FILE="/tmp/peers-touch-desktop-web.pid"
source "$SCRIPT_DIR/_ensure-station.sh"

PORT="${1:-3000}"

if [[ ! -d "$DESKTOP_DIR" ]]; then
  echo "[ERROR] desktop app dir not found: $DESKTOP_DIR"
  exit 1
fi

ensure_station_ready "$PROJECT_ROOT"

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "[ERROR] port must be numeric, got: $PORT"
  exit 1
fi

if command -v lsof >/dev/null 2>&1 && lsof -ti ":$PORT" >/dev/null 2>&1; then
  echo "[ERROR] port $PORT is already in use"
  echo "        choose another port: ./tooling/scripts/preview-web.sh 3001"
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD_PID:-}" ]] && ps -p "$OLD_PID" >/dev/null 2>&1; then
    echo "[INFO] stopping previous web preview process: $OLD_PID"
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

cd "$DESKTOP_DIR"

if command -v pnpm >/dev/null 2>&1 && [[ -f "pnpm-lock.yaml" ]]; then
  CMD=(pnpm dev -- --host 0.0.0.0 --port "$PORT")
else
  CMD=(npm run dev -- --host 0.0.0.0 --port "$PORT")
fi

echo "[INFO] starting web preview..."
echo "[INFO] url: http://localhost:$PORT/"
"${CMD[@]}" &
echo $! > "$PID_FILE"
echo "[INFO] pid: $(cat "$PID_FILE")"
echo "[INFO] use Ctrl+C to stop foreground logs, or run:"
echo "       kill $(cat "$PID_FILE")"
wait
