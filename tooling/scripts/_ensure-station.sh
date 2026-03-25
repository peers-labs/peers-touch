#!/usr/bin/env bash
set -euo pipefail

ensure_station_ready() {
  local project_root="$1"
  local station_dir="$project_root/apps/station/app"
  local station_pid_file="/tmp/peers-touch-station.pid"
  local station_log_file="/tmp/peers-touch-station.log"
  local station_target="${VITE_STATION_PROXY_TARGET:-http://127.0.0.1:18080}"
  local station_check_url="${STATION_HEALTHCHECK_URL:-$station_target/api/oauth/providers}"

  station_is_ready() {
    curl -fsS -m 2 "$station_check_url" >/dev/null 2>&1
  }

  if station_is_ready; then
    echo "[INFO] station is ready: $station_check_url"
    return 0
  fi

  if [[ ! -d "$station_dir" ]]; then
    echo "[ERROR] station app dir not found: $station_dir"
    exit 1
  fi

  if [[ -f "$station_pid_file" ]]; then
    local old_pid
    old_pid="$(cat "$station_pid_file" 2>/dev/null || true)"
    if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
      echo "[INFO] station process exists but not ready yet: $old_pid"
    else
      rm -f "$station_pid_file"
    fi
  fi

  if [[ ! -f "$station_pid_file" ]]; then
    echo "[INFO] starting station..."
    (
      cd "$station_dir"
      nohup go run . >>"$station_log_file" 2>&1 &
      echo $! > "$station_pid_file"
    )
    echo "[INFO] station pid: $(cat "$station_pid_file")"
  fi

  for _ in {1..40}; do
    if station_is_ready; then
      echo "[INFO] station ready: $station_check_url"
      return 0
    fi
    sleep 0.5
  done

  echo "[ERROR] station failed to become ready: $station_check_url"
  if [[ -f "$station_log_file" ]]; then
    echo "[INFO] last station logs:"
    tail -n 30 "$station_log_file" || true
  fi
  exit 1
}
