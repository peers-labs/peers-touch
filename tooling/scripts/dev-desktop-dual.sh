#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# dev-desktop-dual.sh — Start App + Web in one terminal
#
# Launches both instances sequentially within one script.
# App (Tauri native window) + Web (browser via headless binary).
# They share one Station but run isolated Rust BFF processes.
#
# Ctrl+C stops everything.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"

APP_PROFILE="desktop"
APP_GATEWAY_PORT=3030
APP_VITE_PORT=3210

WEB_PROFILE="desktop-web"
WEB_GATEWAY_PORT=3031
WEB_VITE_PORT=3211

STATION_PORT="${STATION_PORT:-18080}"
STATION_URL="${PEERS_STATION_URL:-http://localhost:${STATION_PORT}}"
DASHBOARD_URL="${STATION_URL%/}/dashboard/"

source "$SCRIPT_DIR/_ensure-station.sh"

PIDS_TO_KILL=()

cleanup() {
  if [[ ${#PIDS_TO_KILL[@]} -gt 0 ]]; then
    for pid in "${PIDS_TO_KILL[@]}"; do
      if ps -p "$pid" >/dev/null 2>&1; then
        kill "$pid" 2>/dev/null || true
      fi
    done
  fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

port_is_listening() {
  lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_port() {
  local port="$1" label="$2" max="${3:-300}" check_pid="${4:-}"
  for (( i=1; i<=max; i++ )); do
    if [[ -n "$check_pid" ]] && ! ps -p "$check_pid" >/dev/null 2>&1; then
      echo "[ERROR] $label process exited (pid: $check_pid)"
      return 1
    fi
    if port_is_listening "$port"; then
      echo "[INFO] $label ready on :$port"
      return 0
    fi
    sleep 1
  done
  echo "[WARN] $label did not start within ${max}s"
  return 0
}

echo ""
echo "  Peers Touch Desktop — Dual Mode"
echo "  ─────────────────────────────────────────────────"
echo "  App       : Tauri window,  Vite :$APP_VITE_PORT,  Gateway :$APP_GATEWAY_PORT"
echo "  Web       : Browser,       Vite :$WEB_VITE_PORT,  Gateway :$WEB_GATEWAY_PORT"
echo "  Station   : $STATION_URL (shared)"
echo "  Dashboard : $DASHBOARD_URL"
echo ""
echo "  Starting services…"
echo ""

# ── 1. Station ──────────────────────────────────────────────
ensure_station_ready "$PROJECT_ROOT"

# ── 2. App Vite ─────────────────────────────────────────────
if port_is_listening "$APP_VITE_PORT"; then
  echo "[INFO] App Vite already on :$APP_VITE_PORT"
else
  echo "[INFO] Starting App Vite on :$APP_VITE_PORT ..."
  (cd "$DESKTOP_DIR" && VITE_GATEWAY_PORT="$APP_GATEWAY_PORT" pnpm dev) &
  APP_VITE_PID=$!
  PIDS_TO_KILL+=($APP_VITE_PID)
  wait_for_port "$APP_VITE_PORT" "App Vite" 60 "$APP_VITE_PID"
fi

# ── 3. App Rust (Tauri dev — native window) ─────────────────
if port_is_listening "$APP_GATEWAY_PORT"; then
  echo "[INFO] App Gateway already on :$APP_GATEWAY_PORT"
else
  echo "[INFO] Starting App Rust BFF (Tauri dev, profile=$APP_PROFILE) ..."
  TAURI_CONFIG="{\"build\":{\"devUrl\":\"http://localhost:${APP_VITE_PORT}\",\"beforeDevCommand\":\"echo [INFO] external web dev server mode\"}}"
  (cd "$DESKTOP_DIR" && PT_GATEWAY_PORT="$APP_GATEWAY_PORT" PT_PROFILE="$APP_PROFILE" pnpm tauri dev --config "$TAURI_CONFIG") &
  APP_RUST_PID=$!
  PIDS_TO_KILL+=($APP_RUST_PID)
  wait_for_port "$APP_GATEWAY_PORT" "App Gateway" 600 "$APP_RUST_PID"
fi

# ── 4. Web Vite ─────────────────────────────────────────────
if port_is_listening "$WEB_VITE_PORT"; then
  echo "[INFO] Web Vite already on :$WEB_VITE_PORT"
else
  echo "[INFO] Starting Web Vite on :$WEB_VITE_PORT ..."
  (cd "$DESKTOP_DIR" && VITE_GATEWAY_PORT="$WEB_GATEWAY_PORT" pnpm dev --port "$WEB_VITE_PORT") &
  WEB_VITE_PID=$!
  PIDS_TO_KILL+=($WEB_VITE_PID)
  wait_for_port "$WEB_VITE_PORT" "Web Vite" 60 "$WEB_VITE_PID"
fi

# ── 5. Web Rust (headless binary — no Tauri window) ─────────
if port_is_listening "$WEB_GATEWAY_PORT"; then
  echo "[INFO] Web Gateway already on :$WEB_GATEWAY_PORT"
else
  BINARY="$DESKTOP_DIR/src-tauri/target/debug/peers-touch-desktop"
  if [[ ! -x "$BINARY" ]]; then
    echo "[INFO] Binary not found, building ..."
    (cd "$DESKTOP_DIR/src-tauri" && cargo build) || { echo "[ERROR] cargo build failed"; exit 1; }
  fi
  echo "[INFO] Starting Web Rust BFF (headless binary, profile=$WEB_PROFILE) ..."
  (PT_GATEWAY_PORT="$WEB_GATEWAY_PORT" PT_PROFILE="$WEB_PROFILE" "$BINARY") &
  WEB_RUST_PID=$!
  PIDS_TO_KILL+=($WEB_RUST_PID)
  wait_for_port "$WEB_GATEWAY_PORT" "Web Gateway" 30 "$WEB_RUST_PID"
fi

echo ""
echo "  ┌─────────────────────────────────────────────────────────┐"
echo "  │  All services are running!                              │"
echo "  │                                                         │"
echo "  │  App       : Tauri native window  (Gateway :$APP_GATEWAY_PORT)       │"
echo "  │  Web       : http://localhost:$WEB_VITE_PORT   (Gateway :$WEB_GATEWAY_PORT)       │"
echo "  │  Dashboard : $DASHBOARD_URL  │"
echo "  │                                                         │"
echo "  │  Ctrl+C to stop all                                     │"
echo "  └─────────────────────────────────────────────────────────┘"
echo ""

wait
