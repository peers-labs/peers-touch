#!/usr/bin/env bash
# dev-testnet-desktops.sh — Launch 3 Desktop instances for actors a/b/c
#
# Each instance connects to its own Station on the internal test network.
# All 3 run simultaneously on this Mac with isolated profiles, ports, and sessions.
#
# Usage:
#   ./tooling/scripts/dev-testnet-desktops.sh
#   ./tooling/scripts/dev-testnet-desktops.sh a      # Only actor a
#   ./tooling/scripts/dev-testnet-desktops.sh a b    # Actors a and b
#
# Architecture:
#   Desktop-a → Station-a (10.37.94.156:18080)
#   Desktop-b → Station-b (10.37.195.98:18080)
#   Desktop-c → Station-c (10.37.246.80:18080)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ALL_ACTORS=(a b c)

# Keep this script compatible with macOS /bin/bash 3.2.
actor_station_url() {
  case "$1" in
    a) echo "http://10.37.94.156:18080" ;;
    b) echo "http://10.37.195.98:18080" ;;
    c) echo "http://10.37.246.80:18080" ;;
    *) return 1 ;;
  esac
}

actor_web_port() {
  case "$1" in
    a) echo "3210" ;;
    b) echo "3211" ;;
    c) echo "3212" ;;
    *) return 1 ;;
  esac
}

actor_gateway_port() {
  case "$1" in
    a) echo "3030" ;;
    b) echo "3031" ;;
    c) echo "3032" ;;
    *) return 1 ;;
  esac
}

# ── Parse args: which actors to launch ────────────────────────────────────────
if [[ $# -gt 0 ]]; then
  ACTORS=("$@")
else
  ACTORS=("${ALL_ACTORS[@]}")
fi

# ── Validate actors ───────────────────────────────────────────────────────────
for actor in "${ACTORS[@]}"; do
  if ! actor_station_url "$actor" >/dev/null; then
    echo "ERROR: Unknown actor '$actor'. Must be one of: a, b, c"
    exit 1
  fi
done

echo "═══════════════════════════════════════════════════════════"
echo "  Peers Touch Testnet — Desktop Clients"
echo ""
for actor in "${ACTORS[@]}"; do
  echo "  Actor ${actor}: Station=$(actor_station_url "$actor")  Web=:$(actor_web_port "$actor")  Gateway=:$(actor_gateway_port "$actor")"
done
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Launch desktops ───────────────────────────────────────────────────────────
PIDS=()

for actor in "${ACTORS[@]}"; do
  echo "==> Starting Desktop for actor ${actor}..."

  PEERS_STATION_URL="$(actor_station_url "$actor")" \
  PT_PROFILE="testnet-${actor}" \
  WEB_PORT="$(actor_web_port "$actor")" \
  GATEWAY_PORT="$(actor_gateway_port "$actor")" \
  "$SCRIPT_DIR/dev-desktop-app.sh" &

  PIDS+=($!)
  # Small stagger to avoid port race
  sleep 2
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  All ${#ACTORS[@]} Desktop instances launching."
echo "  Press Ctrl+C to stop all."
echo "═══════════════════════════════════════════════════════════"

# ── Wait for all, propagate Ctrl+C ───────────────────────────────────────────
cleanup() {
  echo ""
  echo "==> Stopping all Desktop instances..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait
  echo "==> Done."
}

trap cleanup SIGINT SIGTERM

for pid in "${PIDS[@]}"; do
  wait "$pid" 2>/dev/null || true
done
