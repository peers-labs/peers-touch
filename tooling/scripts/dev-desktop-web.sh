#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# dev-desktop-web.sh — Desktop Web dev mode (browser debugging)
#
# Starts a complete, independent Desktop Web stack:
#   station → desktop-rust (profile=desktop-web, gateway=:3031) → browser
#
# This instance is fully isolated from dev-desktop-app.sh.
# They run separate Rust BFF processes with separate sessions,
# so you can log in with different accounts simultaneously.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"

PROFILE="${PT_PROFILE:-${PROFILE:-desktop-web}}"
GATEWAY_PORT="${GATEWAY_PORT:-3031}"
WEB_PORT="${WEB_PORT:-3211}"
WEB_URL="http://localhost:$WEB_PORT"
STATION_PORT="${STATION_PORT:-18080}"
STATION_URL="${PEERS_STATION_URL:-http://127.0.0.1:${STATION_PORT}}"
DASHBOARD_URL="${STATION_URL}/dashboard/"
source "$SCRIPT_DIR/_ensure-station.sh"
source "$SCRIPT_DIR/_ensure-desktop-rust.sh"
source "$SCRIPT_DIR/_ensure-desktop-vite.sh"

if [[ ! -d "$DESKTOP_DIR" ]]; then
  echo "[ERROR] desktop app dir not found: $DESKTOP_DIR"
  exit 1
fi

# ── 1. Station ────────────────────────────────────────────────
if [[ "${PEERS_STATION_MODE:-local}" == "remote" ]]; then
  station_target="${PEERS_STATION_URL:-http://127.0.0.1:18080}"
  station_check_url="${STATION_HEALTHCHECK_URL:-$station_target/api/oauth/providers}"
  if curl -fsS -m 5 "$station_check_url" >/dev/null 2>&1; then
    echo "[INFO] remote station is ready: $station_check_url"
  else
    echo "[ERROR] remote station is not reachable: $station_check_url"
    exit 1
  fi
else
  ensure_station_ready "$PROJECT_ROOT"
fi

# ── 2. Vite (frontend dev server) ────────────────────────────
ensure_desktop_vite_ready "$DESKTOP_DIR" "$WEB_PORT" "$GATEWAY_PORT" "$PROFILE"

# ── 3. Desktop Rust BFF (headless — window hidden) ───────────
cd "$DESKTOP_DIR"
ensure_desktop_rust_ready "$DESKTOP_DIR" "$GATEWAY_PORT" "$PROFILE" "$WEB_PORT" --headless

# ── banner ────────────────────────────────────────────────────
echo ""
echo "  ┌─────────────────────────────────────────────────────────┐"
echo "  │  Peers Touch Desktop — Web Dev Mode                     │"
echo "  │                                                         │"
echo "  │  Profile   : $PROFILE                              │"
echo "  │  Browser   : $WEB_URL                        │"
echo "  │  Gateway   : :$GATEWAY_PORT                                 │"
echo "  │  Station   : :$STATION_PORT                                │"
echo "  │  Dashboard : $DASHBOARD_URL  │"
echo "  │                                                         │"
echo "  │  Open $WEB_URL in any browser.              │"
echo "  │  App and Web run separate sessions — you can log in     │"
echo "  │  with different accounts for cross-account testing.     │"
echo "  │                                                         │"
echo "  │  tsx/css → Vite hot reload                              │"
echo "  │  .rs    → auto recompile + gateway restart              │"
echo "  │                                                         │"
echo "  │  Ctrl+C to stop                                         │"
echo "  └─────────────────────────────────────────────────────────┘"
echo ""

# ── cleanup & wait ────────────────────────────────────────────
cleanup() {
  if [[ -n "${VITE_PID:-}" ]] && ps -p "$VITE_PID" >/dev/null 2>&1; then
    kill "$VITE_PID" 2>/dev/null || true
  fi
  rm -f "$VITE_PID_FILE"
  rm -f "${VITE_META_FILE:-}"
  if [[ -n "${TAURI_PID:-}" ]] && ps -p "$TAURI_PID" >/dev/null 2>&1; then
    kill "$TAURI_PID" 2>/dev/null || true
  fi
  rm -f "$DESKTOP_RUST_PID_FILE"
  rm -f "${DESKTOP_RUST_META_FILE:-}"
}
trap cleanup EXIT INT TERM

if [[ -n "${VITE_PID:-}" ]]; then
  wait "$VITE_PID" || true
elif [[ -n "${TAURI_PID:-}" ]]; then
  wait "$TAURI_PID" || true
else
  echo "[INFO] All processes were already running. Press Ctrl+C to exit."
  while true; do sleep 60; done
fi
