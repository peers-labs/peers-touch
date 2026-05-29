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

# ── Actor definitions ─────────────────────────────────────────────────────────
declare -A ACTOR_STATION=(
  [a]="http://10.37.94.156:18080"
  [b]="http://10.37.195.98:18080"
  [c]="http://10.37.246.80:18080"
)
declare -A ACTOR_WEB_PORT=(
  [a]=3210
  [b]=3211
  [c]=3212
)
declare -A ACTOR_GATEWAY_PORT=(
  [a]=3030
  [b]=3031
  [c]=3032
)

ALL_ACTORS=(a b c)

# ── Parse args: which actors to launch ────────────────────────────────────────
if [[ $# -gt 0 ]]; then
  ACTORS=("$@")
else
  ACTORS=("${ALL_ACTORS[@]}")
fi

# ── Validate actors ───────────────────────────────────────────────────────────
for actor in "${ACTORS[@]}"; do
  if [[ -z "${ACTOR_STATION[$actor]:-}" ]]; then
    echo "ERROR: Unknown actor '$actor'. Must be one of: a, b, c"
    exit 1
  fi
done

echo "═══════════════════════════════════════════════════════════"
echo "  Peers Touch Testnet — Desktop Clients"
echo ""
for actor in "${ACTORS[@]}"; do
  echo "  Actor ${actor}: Station=${ACTOR_STATION[$actor]}  Web=:${ACTOR_WEB_PORT[$actor]}  Gateway=:${ACTOR_GATEWAY_PORT[$actor]}"
done
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Launch desktops ───────────────────────────────────────────────────────────
PIDS=()

for actor in "${ACTORS[@]}"; do
  echo "==> Starting Desktop for actor ${actor}..."

  PEERS_STATION_URL="${ACTOR_STATION[$actor]}" \
  PT_PROFILE="testnet-${actor}" \
  WEB_PORT="${ACTOR_WEB_PORT[$actor]}" \
  GATEWAY_PORT="${ACTOR_GATEWAY_PORT[$actor]}" \
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
