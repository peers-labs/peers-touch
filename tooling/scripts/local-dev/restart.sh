#!/usr/bin/env bash
# restart.sh — Restart current worktree dev service(s)
# Usage: restart.sh [station|relay|desktop|mobile|all]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

target="${1:-all}"

case "$target" in
  station)
    bash "$SCRIPT_DIR/stop.sh" station
    bash "$SCRIPT_DIR/station-dev.sh"
    ;;
  relay)
    bash "$SCRIPT_DIR/stop.sh" relay
    bash "$SCRIPT_DIR/relay-dev.sh"
    ;;
  desktop)
    bash "$SCRIPT_DIR/stop.sh" desktop
    bash "$SCRIPT_DIR/desktop-dev.sh"
    ;;
  mobile)
    bash "$SCRIPT_DIR/stop.sh" mobile
    bash "$SCRIPT_DIR/mobile-ios-sim.sh"
    ;;
  all)
    bash "$SCRIPT_DIR/stop.sh" all
    bash "$SCRIPT_DIR/station-dev.sh"
    bash "$SCRIPT_DIR/relay-dev.sh"
    ;;
  *)
    echo "[ERROR] Usage: restart.sh [station|relay|desktop|mobile|all]"
    exit 1
    ;;
esac
