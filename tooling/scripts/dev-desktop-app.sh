#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# dev-desktop-app.sh — Desktop App dev mode (Tauri native window)
#
# Starts the supported Desktop development stack:
#   station → desktop-rust (profile=desktop, gateway=:3030) → desktop-app
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"

PROFILE="${PT_PROFILE:-desktop}"
GATEWAY_PORT="${GATEWAY_PORT:-3030}"
WEB_PORT="${WEB_PORT:-3210}"
WEB_URL="http://localhost:$WEB_PORT"
STATION_PORT="${STATION_PORT:-18080}"
DASHBOARD_URL="http://localhost:${STATION_PORT}/dashboard/"
source "$SCRIPT_DIR/_ensure-station.sh"
source "$SCRIPT_DIR/_ensure-desktop-rust.sh"
source "$SCRIPT_DIR/_ensure-desktop-vite.sh"

if [[ ! -d "$DESKTOP_DIR" ]]; then
  echo "[ERROR] desktop app dir not found: $DESKTOP_DIR"
  exit 1
fi

cleanup() {
  if [[ -n "${VITE_PID:-}" ]] && ps -p "$VITE_PID" >/dev/null 2>&1; then
    kill "$VITE_PID" 2>/dev/null || true
  fi
  [[ -z "${VITE_PID_FILE:-}" ]] || rm -f "$VITE_PID_FILE"
  [[ -z "${VITE_META_FILE:-}" ]] || rm -f "$VITE_META_FILE"
  if [[ -n "${TAURI_PID:-}" ]] && ps -p "$TAURI_PID" >/dev/null 2>&1; then
    kill "$TAURI_PID" 2>/dev/null || true
  fi
  [[ -z "${DESKTOP_RUST_PID_FILE:-}" ]] || rm -f "$DESKTOP_RUST_PID_FILE"
  [[ -z "${DESKTOP_RUST_META_FILE:-}" ]] || rm -f "$DESKTOP_RUST_META_FILE"
}
trap cleanup EXIT INT TERM

# ── 1. Station ────────────────────────────────────────────────
ensure_station_ready "$PROJECT_ROOT"

# ── 2. Vite (frontend dev server) ────────────────────────────
if [[ "${PT_DESKTOP_E2E:-false}" == "true" || "${PT_ACCEPTANCE_NATIVE_DEV:-0}" == "1" ]]; then
  export VITE_ACCEPTANCE_HARNESS=1
  export VITE_RUNTIME_EVIDENCE_HARNESS=1
fi
ensure_desktop_vite_ready "$DESKTOP_DIR" "$WEB_PORT" "$GATEWAY_PORT" "$PROFILE"

# ── 3. Desktop Rust BFF (via Tauri — includes App window) ────
cd "$DESKTOP_DIR"
ensure_desktop_rust_ready "$DESKTOP_DIR" "$GATEWAY_PORT" "$PROFILE" "$WEB_PORT"

# ── banner ────────────────────────────────────────────────────
echo ""
echo "  ┌─────────────────────────────────────────────────────────┐"
echo "  │  Peers Touch Desktop — App Dev Mode                     │"
echo "  │                                                         │"
echo "  │  Profile   : $PROFILE                                   │"
echo "  │  Tauri     : desktop-app (native window)                │"
echo "  │  Frontend  : Vite on :$WEB_PORT                             │"
echo "  │  Gateway   : :$GATEWAY_PORT                                 │"
echo "  │  Station   : :$STATION_PORT                                │"
echo "  │  Dashboard : $DASHBOARD_URL  │"
echo "  │                                                         │"
echo "  │  tsx/css → Vite hot reload                              │"
echo "  │  .rs    → auto recompile + reload                       │"
echo "  │                                                         │"
echo "  │  Ctrl+C to stop                                         │"
echo "  └─────────────────────────────────────────────────────────┘"
echo ""

# ── cleanup & wait ────────────────────────────────────────────
if [[ -n "${TAURI_PID:-}" ]]; then
  wait "$TAURI_PID"
elif [[ -n "${VITE_PID:-}" ]]; then
  wait "$VITE_PID"
else
  echo "[INFO] All processes were already running. Press Ctrl+C to exit."
  while true; do sleep 60; done
fi
