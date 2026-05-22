#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# pt-discover-relay.sh — bridge the libp2p layer for the test bench
#
# After `make pt-up ENV=pt-relay` the Relay's bootstrap subserver is up but
# the Stations have no idea where to find it (DHT seed list is empty). This
# script:
#
#   1. Queries Relay's `/sub-bootstrap/info` for its libp2p PeerID.
#   2. Composes the externally-dialable multiaddr.
#   3. Idempotently writes PEERS_BOOTSTRAP_NODES into each Station's env file.
#
# Run it once after the Relay starts (its PeerID is now persistent thanks to
# the `peers_data` named volume, so the same multiaddr stays valid across
# restarts and re-deploys).
#
# Layering note: this is **tooling**, not station code. It only fills in a
# config field (peers.node.server.subserver.bootstrap.bootstrap-nodes) that
# the bootstrap subserver already reads from YAML — see
# apps/station/frame/core/plugin/native/subserver/bootstrap/plugin.go:67.
# Step 2 (a future PR) will replace the manual call with on-startup
# auto-registration via the relay client.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Hardcoded for the test bench. Mirrors .localenv §1.
RELAY_HTTP_HOST="10.37.118.48"
RELAY_HTTP_PORT="18081"           # host-side mapping of container :18080
RELAY_LIBP2P_HOST="10.37.118.48"
RELAY_LIBP2P_PORT="4001"          # host-side mapping of container :4001

INFO_URL="http://${RELAY_HTTP_HOST}:${RELAY_HTTP_PORT}/sub-bootstrap/info"

STATION_ENV_FILES=(
  "$PROJECT_ROOT/tooling/docker/.env"
  "$PROJECT_ROOT/tooling/docker/.env.pt-station-1"
  "$PROJECT_ROOT/tooling/docker/.env.pt-station-2"
  "$PROJECT_ROOT/tooling/docker/.env.pt-station-relay-only"
)

log()  { printf '\033[0;36m[discover]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[discover]\033[0m %s\n' "$*"; }
fail() { printf '\033[0;31m[discover]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1. Probe Relay ────────────────────────────────────────────
log "querying Relay bootstrap info: $INFO_URL"
RESPONSE="$(curl -fsS --max-time 5 "$INFO_URL" 2>/dev/null || true)"
if [ -z "$RESPONSE" ]; then
  fail "Relay not reachable at $INFO_URL — start it first: make pt-up ENV=pt-relay"
fi

# ── 2. Extract peer_id ────────────────────────────────────────
# Prefer jq when available; otherwise a tiny regex (peer_id is a stable
# JSON shape: \"peer_id\": \"12D3Koo...\").
if command -v jq >/dev/null 2>&1; then
  PEER_ID="$(echo "$RESPONSE" | jq -r '.peer_id // empty')"
else
  PEER_ID="$(echo "$RESPONSE" | sed -n 's/.*"peer_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
fi

if [ -z "$PEER_ID" ]; then
  fail "Could not parse peer_id from Relay response: $RESPONSE"
fi

MULTIADDR="/ip4/${RELAY_LIBP2P_HOST}/tcp/${RELAY_LIBP2P_PORT}/p2p/${PEER_ID}"
log "Relay PeerID: $PEER_ID"
log "Bootstrap multiaddr: $MULTIADDR"

# ── 3. Patch every station env file (idempotent) ──────────────
# The line ALWAYS exists in the env files (added in Step 1). We rewrite it.
write_env() {
  local file="$1"
  local new_value="$2"
  if [ ! -f "$file" ]; then
    warn "skip: $file not found"
    return 0
  fi
  if ! grep -q '^PEERS_BOOTSTRAP_NODES=' "$file"; then
    warn "$file: PEERS_BOOTSTRAP_NODES line missing — appending"
    printf '\nPEERS_BOOTSTRAP_NODES=%s\n' "$new_value" >> "$file"
    return 0
  fi
  local existing
  existing="$(grep '^PEERS_BOOTSTRAP_NODES=' "$file" | head -n1 | sed 's/^PEERS_BOOTSTRAP_NODES=//')"
  if [ "$existing" = "$new_value" ]; then
    log "$file: unchanged"
    return 0
  fi
  # Portable in-place edit (BSD/GNU sed). Escape '/' in multiaddr for sed.
  local escaped
  escaped="$(printf '%s' "$new_value" | sed 's/[\/&]/\\&/g')"
  if sed --version >/dev/null 2>&1; then
    sed -i "s|^PEERS_BOOTSTRAP_NODES=.*|PEERS_BOOTSTRAP_NODES=${escaped}|" "$file"
  else
    sed -i '' "s|^PEERS_BOOTSTRAP_NODES=.*|PEERS_BOOTSTRAP_NODES=${escaped}|" "$file"
  fi
  log "$file: updated"
}

for f in "${STATION_ENV_FILES[@]}"; do
  write_env "$f" "$MULTIADDR"
done

cat <<EOF

✓ libp2p bootstrap-nodes synchronized.

Next step:
  make pt-up ENV=all          # stations now seed via this Relay
or, for one node:
  make pt-up ENV=pt-station-1

Note: this only wires DHT discovery. Station-to-Relay auto-registration
(application layer / Step 2) will land in a follow-up code PR.
EOF
