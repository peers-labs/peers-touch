#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# _ensure-tauri-dev.sh — Shared Tauri dev process detection
#
# Provides functions to detect and manage Tauri dev processes,
# preventing duplicate Vite/Rust compilations and port conflicts.
#
# Usage (sourced by other scripts):
#   source "$SCRIPT_DIR/_ensure-tauri-dev.sh"
#
#   if tauri_dev_is_running; then
#     echo "Already running, open browser at $TAURI_DEV_VITE_URL"
#   else
#     start_tauri_dev
#   fi
# ─────────────────────────────────────────────────────────────
set -euo pipefail

TAURI_DEV_PID_FILE="/tmp/peers-touch-tauri-dev.pid"
TAURI_DEV_VITE_PORT="${TAURI_DEV_VITE_PORT:-3210}"
TAURI_DEV_VITE_URL="http://localhost:$TAURI_DEV_VITE_PORT"

# Check if Vite dev server is listening on the expected port.
_vite_is_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$TAURI_DEV_VITE_PORT" -sTCP:LISTEN >/dev/null 2>&1
  else
    curl -fsS -m 1 "$TAURI_DEV_VITE_URL" >/dev/null 2>&1
  fi
}

# Check if a previously recorded Tauri dev PID is still alive.
_tauri_pid_alive() {
  if [[ -f "$TAURI_DEV_PID_FILE" ]]; then
    local pid
    pid="$(cat "$TAURI_DEV_PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && ps -p "$pid" >/dev/null 2>&1; then
      return 0
    fi
    rm -f "$TAURI_DEV_PID_FILE"
  fi
  return 1
}

# Returns 0 if a Tauri dev session (Vite + Rust BFF) is already running.
tauri_dev_is_running() {
  if _tauri_pid_alive && _vite_is_listening; then
    return 0
  fi
  return 1
}

# Stop any existing Tauri dev process and clean up port.
tauri_dev_stop() {
  if [[ -f "$TAURI_DEV_PID_FILE" ]]; then
    local pid
    pid="$(cat "$TAURI_DEV_PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && ps -p "$pid" >/dev/null 2>&1; then
      echo "[INFO] stopping previous Tauri dev process: $pid"
      kill "$pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$TAURI_DEV_PID_FILE"
  fi

  if command -v lsof >/dev/null 2>&1; then
    local port_pids
    port_pids="$(lsof -tiTCP:"$TAURI_DEV_VITE_PORT" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${port_pids:-}" ]]; then
      echo "[INFO] port $TAURI_DEV_VITE_PORT still in use, cleaning up: $port_pids"
      while IFS= read -r p; do
        [[ -n "${p:-}" ]] || continue
        kill "$p" 2>/dev/null || true
      done <<< "$port_pids"
      sleep 1
    fi
  fi
}

# Launch `pnpm tauri:dev` in the background, record PID, wait for Vite.
# Call this from the desktop directory.
start_tauri_dev() {
  tauri_dev_stop

  pnpm tauri:dev &
  local tauri_pid=$!
  echo "$tauri_pid" > "$TAURI_DEV_PID_FILE"

  echo "[INFO] Tauri dev started (pid: $tauri_pid), waiting for Vite..."
  for _ in {1..60}; do
    if ! ps -p "$tauri_pid" >/dev/null 2>&1; then
      echo "[ERROR] Tauri dev process exited unexpectedly"
      rm -f "$TAURI_DEV_PID_FILE"
      exit 1
    fi
    if _vite_is_listening; then
      echo "[INFO] Vite dev server ready: $TAURI_DEV_VITE_URL"
      return 0
    fi
    sleep 1
  done

  echo "[ERROR] Vite dev server did not start within 60s"
  kill "$tauri_pid" 2>/dev/null || true
  rm -f "$TAURI_DEV_PID_FILE"
  exit 1
}

# Wait for the Tauri dev process to exit (foreground block).
wait_tauri_dev() {
  if [[ -f "$TAURI_DEV_PID_FILE" ]]; then
    local pid
    pid="$(cat "$TAURI_DEV_PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && ps -p "$pid" >/dev/null 2>&1; then
      wait "$pid" 2>/dev/null || true
    fi
  fi
}
