#!/usr/bin/env bash
# station-dev.sh — Start or verify Station for current worktree profile
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

STATION_DIR="$PROJECT_ROOT/apps/station/app"
STATION_PID_FILE="$PT_DEV_PIDS/station.pid"
STATION_LOG_FILE="$PT_DEV_LOGS/station.log"
STATION_URL="${PT_STATION_URL:-http://127.0.0.1:18080}"
STATION_PORT="${PT_STATION_PORT:-18080}"
STATION_MODE="${PT_STATION_MODE:-local}"
STATION_CHECK_URL="$STATION_URL/api/oauth/providers"
DEPLOY_SCRIPT="$PROJECT_ROOT/tooling/scripts/deploy/deploy.sh"

station_is_ready() {
  curl -fsS -m 2 "$STATION_CHECK_URL" >/dev/null 2>&1
}

if [[ "$STATION_MODE" == "remote" ]]; then
  deploy_env="${PT_STATION_DEPLOY_ENV:-}"
  if [[ -z "$deploy_env" ]]; then
    echo "[ERROR] Station mode is remote, but PT_STATION_DEPLOY_ENV is not set."
    echo "        make station now means: deploy/restart/check remote Station."
    echo "        Set it in the active profile, for example:"
    echo "          PT_STATION_DEPLOY_ENV=station-1"
    echo ""
    echo "        If you only want a health probe, run:"
    echo "          make station-check"
    exit 1
  fi

  branch="${PT_STATION_DEPLOY_BRANCH:-$(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null || echo main)}"
  echo "[INFO] Station mode: remote ready closure"
  echo "       URL        : $STATION_URL"
  echo "       Deploy env : $deploy_env"
  echo "       Branch     : $branch"
  echo ""

  BRANCH="$branch" /bin/bash "$DEPLOY_SCRIPT" "$deploy_env"
  /bin/bash "$SCRIPT_DIR/station-check.sh"
  echo "[OK] Remote Station ready: $STATION_URL"
  exit 0
fi

# Local mode
if station_is_ready; then
  echo "[INFO] Station already running: $STATION_URL"
  exit 0
fi

if [[ ! -d "$STATION_DIR" ]]; then
  echo "[ERROR] Station dir not found: $STATION_DIR"
  exit 1
fi

# Kill stale PID
if [[ -f "$STATION_PID_FILE" ]]; then
  old_pid="$(cat "$STATION_PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
    echo "[INFO] Station process exists but not ready: $old_pid"
  else
    rm -f "$STATION_PID_FILE"
  fi
fi

# Start
if [[ ! -f "$STATION_PID_FILE" ]]; then
  echo "[INFO] Starting Station on :$STATION_PORT ..."
  (
    cd "$STATION_DIR"
    STATION_PORT="$STATION_PORT" \
    PEERS_BOOTSTRAP_NODES="${PT_BOOTSTRAP_NODES:-}" \
    PEERS_NODE_LABEL="${PT_STATION_NAME:-local}" \
    nohup go run . >> "$STATION_LOG_FILE" 2>&1 &
    echo $! > "$STATION_PID_FILE"
  )
  echo "[INFO] Station PID: $(cat "$STATION_PID_FILE")"
fi

# Wait
for _ in {1..40}; do
  if station_is_ready; then
    echo "[OK] Station ready: $STATION_URL"
    exit 0
  fi
  sleep 0.5
done

echo "[ERROR] Station failed to become ready"
echo "[INFO] Log: $STATION_LOG_FILE"
tail -n 20 "$STATION_LOG_FILE" 2>/dev/null || true
exit 1
