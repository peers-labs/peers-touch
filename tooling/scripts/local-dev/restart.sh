#!/usr/bin/env bash
# restart.sh — Restart current worktree dev service(s)
# Usage: restart.sh [station|relay|desktop|desktop-web|mobile|all]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

target="${1:-all}"

case "$target" in
  station)
    bash "$SCRIPT_DIR/stop.sh" station
    bash "$SCRIPT_DIR/station-dev.sh"
    ;;
  desktop)
    bash "$SCRIPT_DIR/stop.sh" desktop
    bash "$SCRIPT_DIR/desktop-dev.sh" app
    ;;
  desktop-web)
    bash "$SCRIPT_DIR/stop.sh" desktop
    bash "$SCRIPT_DIR/desktop-dev.sh" web
    ;;
  mobile)
    bash "$SCRIPT_DIR/stop.sh" mobile
    bash "$SCRIPT_DIR/mobile-ios-sim.sh"
    ;;
  all)
    bash "$SCRIPT_DIR/stop.sh" all
    bash "$SCRIPT_DIR/station-dev.sh"
    ;;
  *)
    echo "[ERROR] Usage: restart.sh [station|desktop|desktop-web|mobile|all]"
    exit 1
    ;;
esac
