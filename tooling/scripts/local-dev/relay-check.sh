#!/usr/bin/env bash
# relay-check.sh — Health probe only; never starts or deploys Relay.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

RELAY_URL="${PT_RELAY_URL:-}"
if [[ -z "$RELAY_URL" ]]; then
  echo "[ERROR] PT_RELAY_URL is not set in the active profile."
  exit 1
fi

RELAY_CHECK_URL="${PT_RELAY_HEALTH_URL:-$RELAY_URL/healthz}"

echo "[INFO] Relay health check"
echo "       URL   : $RELAY_URL"
echo "       Probe : $RELAY_CHECK_URL"

if curl -fsS -m 5 "$RELAY_CHECK_URL" >/dev/null 2>&1; then
  echo "       Status: ready"
  exit 0
fi

echo "       Status: NOT reachable"
exit 1
