#!/usr/bin/env bash
# stop.sh — Stop current worktree dev processes
# Usage: stop.sh [station|relay|desktop|mobile|all]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

target="${1:-all}"

compose_stop_station() {
  local mode="${PT_STATION_MODE:-local}"
  if [[ "$mode" != "compose" ]]; then
    return 0
  fi
  local compose_file="$PROJECT_ROOT/tooling/docker/compose.yml"
  local compose_env_file="${PT_STATION_COMPOSE_ENV_FILE:-$PROJECT_ROOT/tooling/docker/.env}"
  if [[ ! -f "$compose_file" || ! -f "$compose_env_file" ]]; then
    return 0
  fi
  COMPOSE_PROJECT_NAME="${PT_STATION_COMPOSE_PROJECT:-pt-${PT_DEV_PROFILE}}" \
  STATION_PORT="${PT_STATION_PORT:-18080}" \
  POSTGRES_DB="${PT_STATION_DB_NAME:-peers_touch}" \
  PEERS_NODE_LABEL="${PT_STATION_NAME:-local}" \
  docker compose \
    -f "$compose_file" \
    --env-file "$compose_env_file" \
    --profile station \
    stop station >/dev/null 2>&1 || true
  echo "[OK] Stopped compose Station for profile ${PT_DEV_PROFILE}"
}

stop_pid() {
  local name="$1" file="$2" expected="$3"
  if [[ -f "$file" ]]; then
    local pid command
    pid="$(cat "$file" 2>/dev/null || true)"
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        local powershell="/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
        if [[ "$pid" =~ ^[0-9]+$ ]]; then
          command="$(
            "$powershell" -NoProfile -Command \
              "(Get-CimInstance Win32_Process -Filter \"ProcessId=$pid\").CommandLine" |
              tr -d '\r'
          )"
        else
          command=""
        fi
        if [[ -z "$command" ]]; then
          echo "[INFO] $name was not running"
        elif [[ -n "$expected" && "$command" != *"$expected"* ]]; then
          echo "[WARN] Ignored stale $name PID $pid; process is not owned by this profile"
        else
          "$powershell" -NoProfile -Command \
            "Stop-Process -Id $pid -Force -ErrorAction Stop"
          echo "[OK] Stopped $name (PID $pid)"
        fi
        rm -f "$file"
        return
        ;;
    esac
    if [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1; then
      command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      if [[ -n "$expected" && "$command" != *"$expected"* ]]; then
        echo "[WARN] Ignored stale $name PID $pid; process is not owned by this profile"
      else
        kill "$pid" 2>/dev/null || true
        echo "[OK] Stopped $name (PID $pid)"
      fi
    else
      echo "[INFO] $name was not running"
    fi
    rm -f "$file"
  else
    echo "[INFO] $name was not running"
  fi
}

case "$target" in
  station)
    compose_stop_station
    stop_pid "Station" "$PT_DEV_PIDS/station.pid" "peers-sqlite.yml"
    ;;
  relay)
    stop_pid "Relay" "$PT_DEV_PIDS/relay.pid" "$PROJECT_ROOT"
    ;;
  desktop)
    stop_pid "Desktop App Vite" "$PT_DEV_PIDS/desktop-app-vite.pid" "--port ${PT_DESKTOP_APP_WEB_PORT:-}"
    stop_pid "Desktop App Rust" "$PT_DEV_PIDS/desktop-app-rust.pid" "$PROJECT_ROOT"
    ;;
  mobile)
    stop_pid "Mobile" "$PT_DEV_PIDS/mobile-ios-sim.pid" "$PROJECT_ROOT"
    ;;
  all)
    compose_stop_station
    stop_pid "Station" "$PT_DEV_PIDS/station.pid" "peers-sqlite.yml"
    stop_pid "Relay" "$PT_DEV_PIDS/relay.pid" "$PROJECT_ROOT"
    stop_pid "Desktop App Vite" "$PT_DEV_PIDS/desktop-app-vite.pid" "--port ${PT_DESKTOP_APP_WEB_PORT:-}"
    stop_pid "Desktop App Rust" "$PT_DEV_PIDS/desktop-app-rust.pid" "$PROJECT_ROOT"
    stop_pid "Mobile" "$PT_DEV_PIDS/mobile-ios-sim.pid" "$PROJECT_ROOT"
    ;;
  *)
    echo "[ERROR] Usage: stop.sh [station|relay|desktop|mobile|all]"
    exit 1
    ;;
esac
