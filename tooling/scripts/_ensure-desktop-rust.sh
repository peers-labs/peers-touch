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
# Environment variables consumed:
#   RESTART — If set to "1", kill existing Rust BFF and restart unconditionally.
#   PT_DESKTOP_E2E — If "true", enable the opt-in native Playwright observer.
#
# Behavior:
#   - If RESTART=1 → kill existing process and start fresh.
#   - If Rust source changed since last start → kill and restart automatically.
#   - If gateway port is already listening (no changes) → reuse, return immediately.
#   - If Tauri PID file exists and process is alive → wait for gateway.
#   - Otherwise → start `pnpm tauri dev` in background.
#   - Sets TAURI_PID to the launched process PID (empty if reused).
set -euo pipefail

gateway_is_listening() {
  lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

tauri_artifact_path() {
  local desktop_dir="$1"
  # Common dev artifact locations.
  if [[ -f "$desktop_dir/src-tauri/target/debug/peers-touch-desktop" ]]; then
    echo "$desktop_dir/src-tauri/target/debug/peers-touch-desktop"
    return 0
  fi
  if [[ -f "$desktop_dir/src-tauri/target/debug/peers_touch_desktop" ]]; then
    echo "$desktop_dir/src-tauri/target/debug/peers_touch_desktop"
    return 0
  fi
  return 1
}

# Fingerprint for deciding whether an existing Tauri/Rust BFF process is reusable.
# Includes:
# - key env/args that affect runtime behaviour
# - Rust build inputs (Cargo + src-tauri/src)
tauri_compute_fingerprint() {
  local desktop_dir="$1"
  local profile="$2"
  local gw_port="$3"
  local vite_port="$4"
  local station_url="${PEERS_STATION_URL:-}"
  local e2e_testing="${PT_DESKTOP_E2E:-false}"

  local files=()
  files+=("$desktop_dir/src-tauri/Cargo.toml")
  if [[ -f "$desktop_dir/src-tauri/Cargo.lock" ]]; then files+=("$desktop_dir/src-tauri/Cargo.lock"); fi
  if [[ -f "$desktop_dir/src-tauri/tauri.conf.json" ]]; then files+=("$desktop_dir/src-tauri/tauri.conf.json"); fi

  local rs_hashes
  rs_hashes="$(
    find "$desktop_dir/src-tauri/src" -name '*.rs' -type f 2>/dev/null \
      | LC_ALL=C sort \
      | xargs shasum -a 256 2>/dev/null \
      | shasum -a 256 \
      | awk '{print $1}'
  )"

  local file_hashes
  file_hashes="$(
    for f in "${files[@]}"; do
      [[ -f "$f" ]] && echo "$f"
    done | LC_ALL=C sort | xargs shasum -a 256 2>/dev/null | shasum -a 256 | awk '{print $1}'
  )"

  printf '%s\n' \
    "kind=tauri-rust-bff" \
    "profile=${profile}" \
    "gateway_port=${gw_port}" \
    "vite_port=${vite_port}" \
    "station_url=${station_url}" \
    "e2e_testing=${e2e_testing}" \
    "files=${file_hashes}" \
    "src_rs=${rs_hashes}" \
    | shasum -a 256 | awk '{print $1}'
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

# Check if Rust source has been modified since the PID file was written.
# Returns 0 (true) if source is newer → restart needed.
rust_source_changed() {
  local pid_file="$1"
  local desktop_dir="$2"
  local ref_file="$pid_file"

  # Prefer using the built artifact timestamp as reference. This prevents
  # unnecessary restarts if the running `pnpm tauri dev` has already rebuilt
  # in-place after source changes.
  local artifact
  if artifact="$(tauri_artifact_path "$desktop_dir")"; then
    ref_file="$artifact"
  fi

  if [[ ! -f "$ref_file" ]]; then
    return 1
  fi
  # Any .rs file newer than reference means source changed after last build
  if find "$desktop_dir/src-tauri/src" -name '*.rs' -newer "$ref_file" 2>/dev/null | head -1 | grep -q .; then
    return 0
  fi
  # Cargo.toml/lock changes also warrant a restart (dependency updates)
  if [[ "$desktop_dir/src-tauri/Cargo.toml" -nt "$ref_file" ]]; then
    return 0
  fi
  if [[ -f "$desktop_dir/src-tauri/Cargo.lock" ]] && [[ "$desktop_dir/src-tauri/Cargo.lock" -nt "$ref_file" ]]; then
    return 0
  fi
  if [[ -f "$desktop_dir/src-tauri/tauri.conf.json" ]] && [[ "$desktop_dir/src-tauri/tauri.conf.json" -nt "$ref_file" ]]; then
    return 0
  fi
  return 1
}

tauri_meta_matches() {
  local meta_file="$1"
  local desired_fp="$2"
  local desired_profile="$3"
  local desired_gw_port="$4"
  local desired_vite_port="$5"
  local desired_station_url="${6:-}"

  if [[ ! -f "$meta_file" ]]; then
    return 1
  fi

  # shellcheck disable=SC1090
  source "$meta_file"

  [[ "${TAURI_FINGERPRINT:-}" == "$desired_fp" ]] || return 1
  [[ "${TAURI_PROFILE:-}" == "$desired_profile" ]] || return 1
  [[ "${TAURI_GATEWAY_PORT:-}" == "$desired_gw_port" ]] || return 1
  [[ "${TAURI_VITE_PORT:-}" == "$desired_vite_port" ]] || return 1
  [[ "${TAURI_STATION_URL:-}" == "$desired_station_url" ]] || return 1
  return 0
}

# Kill existing Rust BFF process and free the gateway port.
kill_existing_rust_bff() {
  local gw_port="$1"
  local pid_file="$2"
  local meta_file="${3:-}"
  local existing_pid

  # Kill process from PID file
  if [[ -f "$pid_file" ]]; then
    existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "${existing_pid:-}" ]] && ps -p "$existing_pid" >/dev/null 2>&1; then
      echo "[INFO] Killing old Rust BFF (pid: $existing_pid)..."
      kill "$existing_pid" 2>/dev/null || true
      for _ in {1..10}; do
        ps -p "$existing_pid" >/dev/null 2>&1 || break
        sleep 0.5
      done
      # Force kill if still alive
      if ps -p "$existing_pid" >/dev/null 2>&1; then
        kill -9 "$existing_pid" 2>/dev/null || true
      fi
    fi
    rm -f "$pid_file"
  fi
  [[ -n "${meta_file:-}" ]] && rm -f "$meta_file"

  # Also kill anything still listening on the gateway port
  local port_pids
  port_pids="$(lsof -tiTCP:"$gw_port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$port_pids" ]]; then
    echo "[INFO] Killing processes on port :$gw_port..."
    echo "$port_pids" | xargs kill 2>/dev/null || true
    sleep 1
    port_pids="$(lsof -tiTCP:"$gw_port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$port_pids" ]]; then
      echo "$port_pids" | xargs kill -9 2>/dev/null || true
    fi
  fi
}

ensure_desktop_rust_ready() {
  local desktop_dir="$1"
  local gw_port="$2"
  local profile="$3"
  local vite_port="$4"
  local headless="${5:-}"
  local pid_file="/tmp/peers-touch-desktop-rust-${profile}.pid"
  local meta_file="/tmp/peers-touch-desktop-rust-${profile}.meta"
  TAURI_PID=""
  DESKTOP_RUST_PID_FILE="$pid_file"
  DESKTOP_RUST_META_FILE="$meta_file"

  local dev_url="http://localhost:${vite_port}"
  local tauri_config
  local e2e_testing="${PT_DESKTOP_E2E:-false}"
  if [[ "$headless" == "--headless" && "$e2e_testing" == "true" ]]; then
    tauri_config="{\"build\":{\"devUrl\":\"${dev_url}\",\"beforeDevCommand\":\"echo [INFO] external web dev server mode\"},\"app\":{\"windows\":[{\"visible\":false}],\"security\":{\"capabilities\":[\"default\",{\"identifier\":\"e2e-playwright\",\"windows\":[\"*\"],\"permissions\":[\"playwright:default\"]}]}}}"
  elif [[ "$headless" == "--headless" ]]; then
    tauri_config="{\"build\":{\"devUrl\":\"${dev_url}\",\"beforeDevCommand\":\"echo [INFO] external web dev server mode\"},\"app\":{\"windows\":[{\"visible\":false}]}}"
  elif [[ "$e2e_testing" == "true" ]]; then
    tauri_config="{\"build\":{\"devUrl\":\"${dev_url}\",\"beforeDevCommand\":\"echo [INFO] external web dev server mode\"},\"app\":{\"security\":{\"capabilities\":[\"default\",{\"identifier\":\"e2e-playwright\",\"windows\":[\"*\"],\"permissions\":[\"playwright:default\"]}]}}}"
  else
    tauri_config="{\"build\":{\"devUrl\":\"${dev_url}\",\"beforeDevCommand\":\"echo [INFO] external web dev server mode\"}}"
  fi

  local desired_fp
  desired_fp="$(tauri_compute_fingerprint "$desktop_dir" "$profile" "$gw_port" "$vite_port")"

  # Determine if a restart is needed: explicit RESTART=1 or source code changed
  local needs_restart=false
  if [[ "${RESTART:-}" == "1" ]]; then
    needs_restart=true
    echo "[INFO] RESTART=1 — forcing Rust BFF restart"
  elif ! tauri_meta_matches "$meta_file" "$desired_fp" "$profile" "$gw_port" "$vite_port" "${PEERS_STATION_URL:-}"; then
    needs_restart=true
    echo "[INFO] Rust BFF config/env fingerprint mismatch — restarting"
  elif rust_source_changed "$pid_file" "$desktop_dir"; then
    needs_restart=true
    echo "[INFO] Rust source changed since last start — restarting BFF"
  fi

  if [[ "$needs_restart" == "true" ]]; then
    kill_existing_rust_bff "$gw_port" "$pid_file" "$meta_file"
  elif gateway_is_listening "$gw_port"; then
    echo "[INFO] Rust BFF already running (gateway on :$gw_port, profile=$profile)"
    return 0
  else
    local existing_pid
    if existing_pid="$(rust_pid_alive "$pid_file")"; then
      echo "[INFO] Tauri process alive (pid: $existing_pid), waiting for gateway..."
      wait_for_gateway "$gw_port" 120 "$existing_pid"
      return $?
    fi
  fi

  echo "[INFO] Starting Desktop Rust BFF (profile=$profile, gateway=:$gw_port)..."

  # Both headless (web) and windowed (app) modes use `pnpm tauri dev --config`
  # to ensure devUrl, window visibility, and beforeDevCommand overrides are
  # applied correctly. The binary cannot accept runtime config overrides.
  # See docs/architecture/runtime/desktop-runtime-architecture.md §6.4.
  local tauri_feature_args=()
  if [[ "${PT_DESKTOP_E2E:-false}" == "true" ]]; then
    tauri_feature_args=(--features e2e-testing)
    echo "[INFO] Native Playwright observer enabled (e2e-testing feature)"
  fi
  (
    cd "$desktop_dir"
    export PT_GATEWAY_PORT="$gw_port"
    export PT_PROFILE="$profile"
    export PEERS_STATION_URL="${PEERS_STATION_URL:-}"
    export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
    pnpm tauri dev ${tauri_feature_args[@]+"${tauri_feature_args[@]}"} --config "$tauri_config"
  ) &
  TAURI_PID=$!

  echo "$TAURI_PID" > "$pid_file"
  cat > "$meta_file" <<EOF
TAURI_FINGERPRINT='${desired_fp}'
TAURI_PROFILE='${profile}'
TAURI_GATEWAY_PORT='${gw_port}'
TAURI_VITE_PORT='${vite_port}'
TAURI_STATION_URL='${PEERS_STATION_URL:-}'
TAURI_E2E_TESTING='${PT_DESKTOP_E2E:-false}'
TAURI_PID='${TAURI_PID}'
EOF
  echo "[INFO] Rust BFF started (pid: $TAURI_PID), waiting for gateway..."

  wait_for_gateway "$gw_port" 300 "$TAURI_PID"
}
