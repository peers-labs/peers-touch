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
#   PT_ACCEPTANCE_NATIVE_DEV — If "1", launch an exclusively owned native cell.
#   PT_ACCEPTANCE_WEBDRIVER_PORT — Mapped to the plugin's TAURI_WEBDRIVER_PORT.
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

# Native readiness must belong to the process started by this invocation.
# Shared with the Vite helper, which is sourced after this helper by both callers.
desktop_process_owns_port() {
  local port="$1" owner="$2" pid parent
  local listeners
  listeners="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$listeners" ]] || return 1
  for pid in $listeners; do
    while [[ "$pid" != "$owner" ]]; do
      parent="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')" || return 1
      [[ "$parent" =~ ^[0-9]+$ && "$parent" -gt 1 && "$parent" != "$pid" ]] || return 1
      pid="$parent"
    done
  done
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
    "station_url=${station_url}" \
    "e2e_testing=${e2e_testing}" \
    "native_dev=${PT_ACCEPTANCE_NATIVE_DEV:-0}" \
    "gateway_port=${3:-}" \
    "vite_port=${4:-}" \
    "storage_root=${PEERS_STORAGE_ROOT:-}" \
    "webdriver_port=${PT_ACCEPTANCE_WEBDRIVER_PORT:-}" \
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
  local i exit_status process_state
  # #region debug-point F:startup-wait
  [[ -z "${DEBUG_SERVER_URL:-}" ]] || curl -sS --max-time 1 -X POST "$DEBUG_SERVER_URL" -H 'Content-Type: application/json' -d "{\"sessionId\":\"message-outbox-stall\",\"runId\":\"${DEBUG_RUN_ID:-native-startup}\",\"hypothesisId\":\"F\",\"location\":\"wait_for_gateway\",\"msg\":\"[DEBUG] startup wait\",\"data\":{\"port\":\"$port\",\"pid\":\"$check_pid\",\"timeout\":\"$max_wait\"}}" >/dev/null 2>&1 || true
  # #endregion
  for (( i=1; i<=max_wait; i++ )); do
    process_state=""
    if [[ -n "$check_pid" ]]; then
      process_state="$(ps -o stat= -p "$check_pid" 2>/dev/null | tr -d ' ' || true)"
    fi
    if [[ -n "$check_pid" && ( -z "$process_state" || "$process_state" == Z* ) ]]; then
      # #region debug-point F:startup-exit
      [[ -z "${DEBUG_SERVER_URL:-}" ]] || curl -sS --max-time 1 -X POST "$DEBUG_SERVER_URL" -H 'Content-Type: application/json' -d "{\"sessionId\":\"message-outbox-stall\",\"runId\":\"${DEBUG_RUN_ID:-native-startup}\",\"hypothesisId\":\"F\",\"location\":\"wait_for_gateway\",\"msg\":\"[DEBUG] startup child exited\",\"data\":{\"pid\":\"$check_pid\"}}" >/dev/null 2>&1 || true
      # #endregion
      exit_status=0
      wait "$check_pid" 2>/dev/null || exit_status=$?
      [[ "$exit_status" -ne 0 ]] || exit_status=1
      echo "[ERROR] Tauri process exited before gateway readiness (pid: $check_pid, exit: $exit_status)"
      return "$exit_status"
    fi
    if gateway_is_listening "$port"; then
      if [[ "${PT_ACCEPTANCE_NATIVE_DEV:-0}" == "1" ]] && ! desktop_process_owns_port "$port" "$check_pid"; then
        echo "[ERROR] Gateway port :$port belongs to another process"
        return 1
      fi
      echo "[INFO] HTTP Gateway ready: 127.0.0.1:$port"
      return 0
    fi
    sleep 1
  done
  # #region debug-point F:startup-timeout
  [[ -z "${DEBUG_SERVER_URL:-}" ]] || curl -sS --max-time 1 -X POST "$DEBUG_SERVER_URL" -H 'Content-Type: application/json' -d "{\"sessionId\":\"message-outbox-stall\",\"runId\":\"${DEBUG_RUN_ID:-native-startup}\",\"hypothesisId\":\"F\",\"location\":\"wait_for_gateway\",\"msg\":\"[DEBUG] startup timeout\",\"data\":{\"port\":\"$port\",\"pid\":\"$check_pid\"}}" >/dev/null 2>&1 || true
  # #endregion
  echo "[ERROR] HTTP Gateway did not start within ${max_wait}s"
  return 124
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

tauri_meta_matches() (
  local meta_file="$1"
  local desired_fp="$2"
  local desired_profile="$3"
  local desired_station_url="${4:-}"

  if [[ ! -f "$meta_file" ]]; then
    return 1
  fi

  # shellcheck disable=SC1090
  source "$meta_file"

  [[ "${TAURI_FINGERPRINT:-}" == "$desired_fp" ]] || return 1
  [[ "${TAURI_PROFILE:-}" == "$desired_profile" ]] || return 1
  [[ "${TAURI_STATION_URL:-}" == "$desired_station_url" ]] || return 1
  return 0
)

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
  local wt_id="${WORKTREE_ID:-default}"
  local pid_file="/tmp/peers-touch-desktop-rust-${profile}-${wt_id}.pid"
  local meta_file="/tmp/peers-touch-desktop-rust-${profile}-${wt_id}.meta"
  local native_dev="${PT_ACCEPTANCE_NATIVE_DEV:-0}" instance_key=""
  if [[ "$native_dev" == "1" ]]; then
    : "${PT_ACCEPTANCE_WEBDRIVER_PORT:?Native Acceptance requires a WebDriver port}"
    instance_key="$(printf '%s\n' "$(cd "$desktop_dir" && pwd -P)" "$wt_id" "$profile" "$gw_port" "$vite_port" "${PEERS_STORAGE_ROOT:-}" "$PT_ACCEPTANCE_WEBDRIVER_PORT" | shasum -a 256 | awk '{print $1}')"
    pid_file="${TMPDIR:-/tmp}/peers-touch-desktop-rust-${instance_key}.pid"
    meta_file="${pid_file%.pid}.meta"
  fi
  TAURI_PID=""
  DESKTOP_RUST_PID_FILE="$pid_file"
  DESKTOP_RUST_META_FILE="$meta_file"

  local dev_url="http://localhost:${vite_port}"
  local tauri_config
  local e2e_testing="${PT_DESKTOP_E2E:-false}"
  if [[ "$native_dev" == "1" ]]; then
    if [[ "$headless" == "--headless" ]]; then
      echo "[ERROR] Native Acceptance requires a native window"
      return 1
    fi
    e2e_testing=true
  fi
  local wt_suffix
  if [[ "$native_dev" == "1" ]]; then
    wt_suffix="$(printf '%s\n' "$wt_id" "$profile" "$gw_port" "$vite_port" "$PT_ACCEPTANCE_WEBDRIVER_PORT" | shasum -a 256 | awk '{print substr($1, 1, 24)}')"
  else
    wt_suffix="$(printf '%s' "$wt_id" | tr -cs 'a-zA-Z0-9' '-' | sed 's/-$//')"
  fi
  local bundle_id="com.peertouch.dev.${wt_suffix}"
  if [[ "$headless" == "--headless" && "$e2e_testing" == "true" ]]; then
    tauri_config="{\"identifier\":\"${bundle_id}\",\"build\":{\"devUrl\":\"${dev_url}\",\"beforeDevCommand\":\"echo [INFO] external web dev server mode\"},\"app\":{\"windows\":[{\"create\":false}],\"security\":{\"capabilities\":[\"default\",{\"identifier\":\"e2e-webdriver\",\"windows\":[\"*\"],\"permissions\":[\"wdio-webdriver:default\"]}]}}}"
  elif [[ "$headless" == "--headless" ]]; then
    tauri_config="{\"identifier\":\"${bundle_id}\",\"build\":{\"devUrl\":\"${dev_url}\",\"beforeDevCommand\":\"echo [INFO] external web dev server mode\"},\"app\":{\"windows\":[{\"create\":false}]}}"
  elif [[ "$e2e_testing" == "true" ]]; then
    tauri_config="{\"identifier\":\"${bundle_id}\",\"build\":{\"devUrl\":\"${dev_url}\",\"beforeDevCommand\":\"echo [INFO] external web dev server mode\"},\"app\":{\"security\":{\"capabilities\":[\"default\",{\"identifier\":\"e2e-webdriver\",\"windows\":[\"*\"],\"permissions\":[\"wdio-webdriver:default\"]}]}}}"
  else
    tauri_config="{\"identifier\":\"${bundle_id}\",\"build\":{\"devUrl\":\"${dev_url}\",\"beforeDevCommand\":\"echo [INFO] external web dev server mode\"}}"
  fi

  local desired_fp
  desired_fp="$(tauri_compute_fingerprint "$desktop_dir" "$profile" "$gw_port" "$vite_port"):${PT_CLIENT_SURFACE:-desktop}"

  # Determine if a restart is needed: explicit RESTART=1 or source code changed
  local needs_restart=false
  if [[ "$native_dev" == "1" ]]; then
    if gateway_is_listening "$gw_port" || gateway_is_listening "$PT_ACCEPTANCE_WEBDRIVER_PORT" || rust_pid_alive "$pid_file" >/dev/null; then
      echo "[ERROR] Native Desktop cell is already occupied; refusing reuse or port-based cleanup"
      return 1
    fi
  elif [[ "${RESTART:-}" == "1" ]]; then
    needs_restart=true
    echo "[INFO] RESTART=1 — forcing Rust BFF restart"
  elif ! tauri_meta_matches "$meta_file" "$desired_fp" "$profile" "${PEERS_STATION_URL:-}"; then
    needs_restart=true
    echo "[INFO] Rust BFF config/env fingerprint mismatch — restarting"
  elif rust_source_changed "$pid_file" "$desktop_dir"; then
    needs_restart=true
    echo "[INFO] Rust source changed since last start — restarting BFF"
  fi

  if [[ "$needs_restart" == "true" ]]; then
    kill_existing_rust_bff "$gw_port" "$pid_file" "$meta_file"
  elif [[ "$native_dev" != "1" ]] && gateway_is_listening "$gw_port"; then
    echo "[INFO] Rust BFF already running (gateway on :$gw_port, profile=$profile)"
    return 0
  elif [[ "$native_dev" != "1" ]]; then
    local existing_pid
    if existing_pid="$(rust_pid_alive "$pid_file")"; then
      echo "[INFO] Tauri process alive (pid: $existing_pid), waiting for gateway..."
      wait_for_gateway "$gw_port" 120 "$existing_pid"
      return $?
    fi
  fi

  echo "[INFO] Starting Desktop Rust BFF (profile=$profile, gateway=:$gw_port)..."

  # Both headless (web) and windowed (app) modes use `pnpm tauri dev --config`
  # to ensure devUrl, window creation, and beforeDevCommand overrides are
  # applied correctly. Browser mode keeps the Rust BFF rendererless so no
  # hidden WebView can become a second session owner.
  # See docs/architecture/runtime/desktop-runtime-architecture.md §6.4.
  local tauri_feature_args=()
  if [[ "$native_dev" == "1" ]]; then
    tauri_feature_args=(--no-watch --features acceptance-webdriver)
    echo "[INFO] Native Acceptance WebDriver enabled (single build, no watcher)"
  elif [[ "${PT_DESKTOP_E2E:-false}" == "true" ]]; then
    tauri_feature_args=(--features e2e-testing)
    echo "[INFO] Native Playwright observer enabled (e2e-testing feature)"
  fi
  (
    cd "$desktop_dir"
    export PT_GATEWAY_PORT="$gw_port"
    export PT_PROFILE="$profile"
    export PEERS_STATION_URL="${PEERS_STATION_URL:-}"
    export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
    if [[ "$native_dev" == "1" ]]; then
      export TAURI_WEBDRIVER_PORT="$PT_ACCEPTANCE_WEBDRIVER_PORT"
    fi
    unset MAKEFLAGS MFLAGS
    exec pnpm tauri dev ${tauri_feature_args[@]+"${tauri_feature_args[@]}"} --config "$tauri_config"
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
TAURI_CLIENT_SURFACE='${PT_CLIENT_SURFACE:-desktop}'
TAURI_PID='${TAURI_PID}'
EOF
  echo "[INFO] Rust BFF started (pid: $TAURI_PID), waiting for gateway..."

  wait_for_gateway "$gw_port" "${DESKTOP_RUST_STARTUP_TIMEOUT_SECONDS:-300}" "$TAURI_PID"
}
