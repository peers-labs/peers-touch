#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# git-serve.sh — Lightweight local git server for LAN deployment
#
# Runs git-daemon on the project root so remote hosts can fetch
# directly from the local machine over LAN without pushing to GitHub.
#
# Usage:
#   git-serve.sh start   Start git daemon (background)
#   git-serve.sh stop    Stop git daemon
#   git-serve.sh status  Check if running
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PID_DIR="$PROJECT_ROOT/.local/dev/pids"
PID_FILE="$PID_DIR/git-daemon.pid"
GIT_PORT="${PT_GIT_SERVE_PORT:-9418}"

mkdir -p "$PID_DIR"

# Detect local IP for display
local_ip() {
  # macOS: grab en0 IPv4
  ipconfig getifaddr en0 2>/dev/null || \
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || \
  echo "127.0.0.1"
}

is_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

cmd="${1:-status}"

case "$cmd" in
  start)
    if is_running; then
      echo "[INFO] git daemon already running (PID $(cat "$PID_FILE"))"
      echo "       git://$(local_ip):$GIT_PORT/peers-touch"
      exit 0
    fi

    echo "[INFO] Starting git daemon on :$GIT_PORT ..."

    # Export the project root under the virtual path /peers-touch
    git daemon \
      --reuseaddr \
      --listen=0.0.0.0 \
      --port="$GIT_PORT" \
      --base-path="$(dirname "$PROJECT_ROOT")" \
      --export-all \
      --enable=upload-pack \
      --pid-file="$PID_FILE" \
      --detach \
      "$(dirname "$PROJECT_ROOT")"

    sleep 0.3
    if is_running; then
      IP="$(local_ip)"
      echo "[OK] git daemon running (PID $(cat "$PID_FILE"))"
      echo ""
      echo "  Remote fetch URL:"
      echo "    git://$(local_ip):$GIT_PORT/$(basename "$PROJECT_ROOT")"
      echo ""
      echo "  Test: git ls-remote git://$IP:$GIT_PORT/$(basename "$PROJECT_ROOT")"
      echo ""
    else
      echo "[ERROR] git daemon failed to start"
      exit 1
    fi
    ;;

  stop)
    if is_running; then
      pid="$(cat "$PID_FILE")"
      kill "$pid" 2>/dev/null || true
      rm -f "$PID_FILE"
      echo "[OK] git daemon stopped (was PID $pid)"
    else
      echo "[INFO] git daemon not running"
      rm -f "$PID_FILE"
    fi
    ;;

  status)
    if is_running; then
      echo "[OK] git daemon running (PID $(cat "$PID_FILE"))"
      echo "     URL: git://$(local_ip):$GIT_PORT/$(basename "$PROJECT_ROOT")"
    else
      echo "[INFO] git daemon not running"
      echo "       Start with: make git-serve"
    fi
    ;;

  *)
    echo "Usage: git-serve.sh {start|stop|status}"
    exit 1
    ;;
esac
