#!/usr/bin/env bash
# status.sh — Show current worktree dev status
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

check_pid() {
  local name="$1" file="$2" expected="$3"
  if [[ -f "$file" ]]; then
    local pid command
    pid="$(cat "$file" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1; then
      command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      if [[ -n "$expected" && "$command" != *"$expected"* ]]; then
        echo "  $name: stopped (stale PID reused by another process)"
      else
        echo "  $name: running (PID $pid)"
      fi
    else
      echo "  $name: stopped (stale PID file)"
    fi
  else
    echo "  $name: stopped"
  fi
}

echo ""
echo "Peers-Touch Local Dev Status"
echo "============================"
echo ""
echo "Profile: ${PT_DEV_PROFILE:-<unset>}"
echo "Slot:    ${PT_DEV_SLOT:-0}"
echo ""
echo "Station:"
echo "  Mode : ${PT_STATION_MODE:-local}"
echo "  URL  : ${PT_STATION_URL:-http://127.0.0.1:18080}"
if curl -fsS -m 2 "${PT_STATION_URL:-http://127.0.0.1:18080}/api/oauth/providers" >/dev/null 2>&1; then
  echo "  Ready: yes"
else
  echo "  Ready: no"
fi
check_pid "PID" "$PT_DEV_PIDS/station.pid" "$PT_DEV_DATA/station-conf/peers-sqlite.yml"
echo "  Log  : $PT_DEV_LOGS/station.log"
echo ""
echo "Relay:"
echo "  Mode : ${PT_RELAY_MODE:-remote}"
echo "  URL  : ${PT_RELAY_URL:-<not set>}"
check_pid "PID" "$PT_DEV_PIDS/relay.pid" "$PROJECT_ROOT"
echo ""
echo "Desktop:"
echo "  App gateway : :${PT_DESKTOP_APP_GATEWAY_PORT:-3030}"
echo "  App web     : :${PT_DESKTOP_APP_WEB_PORT:-3210}"
echo "  Web gateway : :${PT_DESKTOP_WEB_GATEWAY_PORT:-3031}"
echo "  Web web     : :${PT_DESKTOP_WEB_WEB_PORT:-3211}"
echo ""
echo "Mobile:"
echo "  Web port    : :${PT_MOBILE_WEB_PORT:-5173}"
echo "  Station URL : ${PT_MOBILE_DEFAULT_STATION_URL:-$PT_STATION_URL}"
echo ""
