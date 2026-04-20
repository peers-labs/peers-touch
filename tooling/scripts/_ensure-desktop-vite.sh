#!/usr/bin/env bash
# _ensure-desktop-vite.sh — Shared helper: ensure Vite dev server is running and healthy.
#
# Both dev-desktop-app.sh and dev-desktop-web.sh source this file.
#
# Exported function:
#   ensure_desktop_vite_ready <desktop_dir> <web_port> <gateway_port> <profile>
#
# Sets for caller:
#   VITE_PID      — PID of newly started Vite (empty if reused)
#   VITE_PID_FILE — Path to PID file
#   VITE_META_FILE — Path to meta file (fingerprint + config snapshot)
set -euo pipefail

vite_port_is_listening() {
  lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# Stable-ish fingerprint of Vite runtime requirements.
# Goal: restart automatically when config/locks/env/ports change, but do NOT
# restart just because a random .tsx changed (HMR should handle that).
vite_compute_fingerprint() {
  local desktop_dir="$1"
  local web_port="$2"
  local gateway_port="$3"
  local profile="$4"
  local station_url="${PEERS_STATION_URL:-}"

  local files=()
  files+=("$desktop_dir/package.json")
  files+=("$desktop_dir/pnpm-lock.yaml")
  files+=("$desktop_dir/tsconfig.json")

  # Vite config files (optional)
  if [[ -f "$desktop_dir/vite.config.ts" ]]; then files+=("$desktop_dir/vite.config.ts"); fi
  if [[ -f "$desktop_dir/vite.config.js" ]]; then files+=("$desktop_dir/vite.config.js"); fi
  if [[ -f "$desktop_dir/vite.config.mts" ]]; then files+=("$desktop_dir/vite.config.mts"); fi

  # Env files can affect Vite dev server behaviour
  if [[ -f "$desktop_dir/.env" ]]; then files+=("$desktop_dir/.env"); fi
  if [[ -f "$desktop_dir/.env.local" ]]; then files+=("$desktop_dir/.env.local"); fi
  if [[ -f "$desktop_dir/.env.development" ]]; then files+=("$desktop_dir/.env.development"); fi
  if [[ -f "$desktop_dir/.env.development.local" ]]; then files+=("$desktop_dir/.env.development.local"); fi

  local file_hashes=""
  # macOS sort doesn't support -z; repo paths do not contain whitespace in practice.
  file_hashes="$(
    for f in "${files[@]}"; do
      [[ -f "$f" ]] && echo "$f"
    done | LC_ALL=C sort | xargs shasum -a 256 2>/dev/null | shasum -a 256 | awk '{print $1}'
  )"

  printf '%s\n' \
    "kind=vite" \
    "profile=${profile}" \
    "web_port=${web_port}" \
    "gateway_port=${gateway_port}" \
    "station_url=${station_url}" \
    "files=${file_hashes}" \
    | shasum -a 256 | awk '{print $1}'
}

# Validate Vite is actually serving, not just occupying the port.
vite_is_healthy() {
  local port="$1"
  local http_code
  http_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:${port}/" 2>/dev/null || echo "000")"
  [[ "$http_code" == "200" ]]
}

vite_meta_matches() {
  local meta_file="$1"
  local desired_fp="$2"
  local desired_port="$3"
  local desired_gateway_port="$4"
  local desired_profile="$5"
  local desired_station_url="${6:-}"

  if [[ ! -f "$meta_file" ]]; then
    return 1
  fi

  # shellcheck disable=SC1090
  source "$meta_file"

  [[ "${VITE_FINGERPRINT:-}" == "$desired_fp" ]] || return 1
  [[ "${VITE_PORT:-}" == "$desired_port" ]] || return 1
  [[ "${VITE_GATEWAY_PORT:-}" == "$desired_gateway_port" ]] || return 1
  [[ "${VITE_PROFILE:-}" == "$desired_profile" ]] || return 1
  [[ "${VITE_STATION_URL:-}" == "$desired_station_url" ]] || return 1
  return 0
}

kill_vite_on_port() {
  local port="$1"
  local pid_file="$2"
  local meta_file="${3:-}"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "[INFO] Killing stale Vite on port :$port..."
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 1
    # Force kill if still alive
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      echo "$pids" | xargs kill -9 2>/dev/null || true
      sleep 0.5
    fi
  fi
  rm -f "$pid_file"
  [[ -n "${meta_file:-}" ]] && rm -f "$meta_file"
}

ensure_desktop_vite_ready() {
  local desktop_dir="$1"
  local web_port="$2"
  local gateway_port="$3"
  local profile="$4"
  local web_url="http://localhost:$web_port"

  VITE_PID=""
  VITE_PID_FILE="/tmp/peers-touch-desktop-vite-${profile}.pid"
  VITE_META_FILE="/tmp/peers-touch-desktop-vite-${profile}.meta"

  local desired_fp
  desired_fp="$(vite_compute_fingerprint "$desktop_dir" "$web_port" "$gateway_port" "$profile")"

  if vite_port_is_listening "$web_port"; then
    if vite_is_healthy "$web_port" && vite_meta_matches "$VITE_META_FILE" "$desired_fp" "$web_port" "$gateway_port" "$profile" "${PEERS_STATION_URL:-}"; then
      echo "[INFO] Vite already running and reusable on $web_url"
      return 0
    else
      echo "[INFO] Vite not reusable (stale/unknown/misconfigured) — restarting"
      kill_vite_on_port "$web_port" "$VITE_PID_FILE" "$VITE_META_FILE"
    fi
  fi

  echo "[INFO] Starting Vite on :$web_port..."
  (cd "$desktop_dir" && VITE_GATEWAY_PORT="$gateway_port" pnpm dev --port "$web_port") &
  VITE_PID=$!
  echo "$VITE_PID" > "$VITE_PID_FILE"
  cat > "$VITE_META_FILE" <<EOF
VITE_FINGERPRINT='${desired_fp}'
VITE_PROFILE='${profile}'
VITE_PORT='${web_port}'
VITE_GATEWAY_PORT='${gateway_port}'
VITE_STATION_URL='${PEERS_STATION_URL:-}'
VITE_PID='${VITE_PID}'
EOF

  for _ in {1..60}; do
    if ! ps -p "$VITE_PID" >/dev/null 2>&1; then
      echo "[ERROR] Vite process exited unexpectedly"
      return 1
    fi
    if vite_is_healthy "$web_port"; then
      echo "[INFO] Vite ready: $web_url"
      return 0
    fi
    sleep 1
  done

  echo "[ERROR] Vite did not become healthy within 60s"
  return 1
}
