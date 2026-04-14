#!/usr/bin/env bash
# _ensure-desktop-rust.sh — Shared helper: ensure Desktop Rust BFF is running.
#
# Both dev-desktop-app.sh and dev-desktop-web.sh source this file.
# The Rust BFF (including HTTP Gateway) is currently embedded in the Tauri
# process. Starting Tauri = starting Rust BFF.
#
# Exported function:
#   ensure_desktop_rust_ready <desktop_dir> <gateway_port> <profile> <vite_port> [--headless]
#
# Environment variables set for the child Tauri process:
#   PT_GATEWAY_PORT — HTTP gateway listen port
#   PT_PROFILE      — Storage profile name (isolates session/config/data)
#
# Behavior:
#   - If gateway port is already listening → reuse, return immediately.
#   - If Tauri PID file exists and process is alive → wait for gateway.
#   - Otherwise → start `pnpm tauri dev` in background.
#   - Sets TAURI_PID to the launched process PID (empty if reused).
set -euo pipefail

gateway_is_listening() {
  lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

rust_pid_alive() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && ps -p "$pid" >/dev/null 2>&1; then
      echo "$pid"
      return 0
    fi
    rm -f "$pid_file"
  fi
  return 1
}

wait_for_gateway() {
  local port="$1"
  local max_wait="${2:-300}"
  local check_pid="${3:-}"
  for (( i=1; i<=max_wait; i++ )); do
    if [[ -n "$check_pid" ]] && ! ps -p "$check_pid" >/dev/null 2>&1; then
      echo "[ERROR] Tauri process exited unexpectedly (pid: $check_pid)"
      return 1
    fi
    if gateway_is_listening "$port"; then
      echo "[INFO] HTTP Gateway ready: 127.0.0.1:$port"
      return 0
    fi
    sleep 1
  done
  echo "[WARN] HTTP Gateway did not start within ${max_wait}s (Rust may still be compiling)"
  return 0
}

ensure_desktop_rust_ready() {
  local desktop_dir="$1"
  local gw_port="$2"
  local profile="$3"
  local vite_port="$4"
  local headless="${5:-}"
  local pid_file="/tmp/peers-touch-desktop-rust-${profile}.pid"
  TAURI_PID=""
  DESKTOP_RUST_PID_FILE="$pid_file"

  local dev_url="http://localhost:${vite_port}"
  local tauri_config
  if [[ "$headless" == "--headless" ]]; then
    tauri_config="{\"build\":{\"devUrl\":\"${dev_url}\",\"beforeDevCommand\":\"echo [INFO] external web dev server mode\"},\"app\":{\"windows\":[{\"visible\":false}]}}"
  else
    tauri_config="{\"build\":{\"devUrl\":\"${dev_url}\",\"beforeDevCommand\":\"echo [INFO] external web dev server mode\"}}"
  fi

  if gateway_is_listening "$gw_port"; then
    echo "[INFO] Rust BFF already running (gateway on :$gw_port, profile=$profile)"
    return 0
  fi

  local existing_pid
  if existing_pid="$(rust_pid_alive "$pid_file")"; then
    echo "[INFO] Tauri process alive (pid: $existing_pid), waiting for gateway..."
    wait_for_gateway "$gw_port" 120 "$existing_pid"
    return $?
  fi

  echo "[INFO] Starting Desktop Rust BFF (profile=$profile, gateway=:$gw_port)..."

  # Both headless (web) and windowed (app) modes use `pnpm tauri dev --config`
  # to ensure devUrl, window visibility, and beforeDevCommand overrides are
  # applied correctly. The binary cannot accept runtime config overrides.
  # See docs/architecture/runtime/desktop-runtime-architecture.md §6.4.
  (
    cd "$desktop_dir"
    export PT_GATEWAY_PORT="$gw_port"
    export PT_PROFILE="$profile"
    pnpm tauri dev --config "$tauri_config"
  ) &
  TAURI_PID=$!

  echo "$TAURI_PID" > "$pid_file"
  echo "[INFO] Rust BFF started (pid: $TAURI_PID), waiting for gateway..."

  wait_for_gateway "$gw_port" 300 "$TAURI_PID"
}
