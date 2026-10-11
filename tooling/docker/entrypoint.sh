#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# entrypoint.sh — emits hierarchy-merge overlays from runtime env, then exec's
# the station binary.
#
# All overlays use the existing `peers.config.hierarchy-merge: true` mechanism
# in apps/station/app/conf/peers.yml, appended to its `includes:` list. Last
# wins, so these overlays always override the baked-in defaults without
# editing the committed YAML files.
#
# Overlays produced:
#   conf/store.docker.yml         — only when PEERS_DB_DSN is set
#   conf/paths.docker.yml         — always (binds TCP 4001 and redirects keys
#                                   into /app/data)
#   conf/federation.docker.yml    — emitted whenever any node-level libp2p
#                                   federation env var is set. Single overlay
#                                   for ALL libp2p hosts in the process
#                                   (bootstrap subserver + transport host
#                                    that the registry attaches its DHT to).
#                                   Carries:
#                                     - federation.bootstrap-nodes
#                                       (DHT seeds + ConnectionGater allow-list)
#                                     - federation.public-addrs
#                                       (multiaddrs the node announces — required
#                                        under Docker/NAT where libp2p's local
#                                        interface scan returns bridge IPs)
#                                     - federation.direct-outbound
#                                       (Gater: false ⇒ dial only seeds)
#                                     - federation.direct-inbound
#                                       (Gater: false ⇒ accept only from seeds)
#   conf/relay.docker.yml         — relay role only; projects signing and
#                                   operator policy for Circuit control
#   conf/relay_pool.docker.yml    — Station role only; configures one standard
#                                   Circuit Relay target and its control origin
#   conf/server_host.docker.yml   — only when PEERS_NODE_SERVER_BASEURL is set.
#                                   Drives:
#                                     - peers.node.server.baseurl
#                                       (federation locator's StationDomain is
#                                        derived from baseurl's URL host portion;
#                                        also used by webfinger/activitypub for
#                                        actor-URI minting)
# ─────────────────────────────────────────────────────────────────────────────
set -e

case "${PEERS_NODE_ROLE:-}" in
  station|relay)
    ;;
  "")
    echo "[entrypoint] PEERS_NODE_ROLE is required (station or relay)" >&2
    exit 1
    ;;
  *)
    echo "[entrypoint] invalid PEERS_NODE_ROLE=${PEERS_NODE_ROLE}; expected station or relay" >&2
    exit 1
    ;;
esac

if [ "$PEERS_NODE_ROLE" = "relay" ]; then
  : "${PEERS_NODE_SERVER_BASEURL:?PEERS_NODE_SERVER_BASEURL is required for relay role}"
  : "${PEERS_LIBP2P_PUBLIC_ADDRS:?PEERS_LIBP2P_PUBLIC_ADDRS is required for relay role}"
  : "${RELAY_OPERATOR_KEY_FILE:?RELAY_OPERATOR_KEY_FILE is required for relay role}"
  : "${RELAY_OPERATOR_ISSUER:?RELAY_OPERATOR_ISSUER is required for relay role}"
  : "${RELAY_OPERATOR_AUDIENCE:?RELAY_OPERATOR_AUDIENCE is required for relay role}"
  : "${RELAY_OPERATOR_SCOPE:?RELAY_OPERATOR_SCOPE is required for relay role}"
fi

if [ "$PEERS_NODE_ROLE" = "station" ] &&
  [ "${STATION_RELAY_ENABLED:-false}" = "true" ]; then
  : "${STATION_RELAY_PEER_ID:?STATION_RELAY_PEER_ID is required}"
  : "${STATION_RELAY_MULTIADDR:?STATION_RELAY_MULTIADDR is required}"
  : "${STATION_RELAY_CONTROL_ORIGIN:?STATION_RELAY_CONTROL_ORIGIN is required}"
fi

case "${PEERS_STATION_CLUSTER_MODE:-single}" in
  single)
    ;;
  cluster)
    case "${PEERS_OSS_BACKEND:-local}" in
      shared-fs|s3)
        ;;
      *)
        echo "[entrypoint] cluster mode requires PEERS_OSS_BACKEND=shared-fs or s3" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "[entrypoint] invalid PEERS_STATION_CLUSTER_MODE=${PEERS_STATION_CLUSTER_MODE}" >&2
    exit 1
    ;;
esac

# /app/data is a named volume; subdirectories must be created at runtime
# (mkdir from the Dockerfile would be shadowed by the empty volume mount).
# Each subdirectory hosts a single concern so the volume layout is greppable:
#   /app/data/oss                   — OSS local-backend store
#   /app/data/messaging-attachments — Messaging encrypted attachment blobs
#   /app/data/social-private-objects — Social encrypted private object blobs
#   /app/data/libp2pIdentity.key     — current transport identity (paths.docker.yml)
#   /app/data/bootstrap.key          — logical Station root identity
#   /app/data/station-node.key       — bootstrap node identity
mkdir -p \
  /app/data/oss \
  /app/data/messaging-attachments \
  /app/data/social-private-objects \
  /app/data/relay-credentials

# ── Node label pattern injection ──────────────────────────────────────────────
# Expand ${PEERS_NODE_LABEL} in actor.yml using envsubst.
# Only PEERS_NODE_LABEL is expanded; other $-references in the file stay intact.
if command -v envsubst >/dev/null 2>&1; then
  envsubst '${PEERS_NODE_LABEL}' < /app/conf/actor.yml > /app/conf/actor.yml.tmp
  mv /app/conf/actor.yml.tmp /app/conf/actor.yml
fi

OVERLAYS=""

# ── store.docker.yml (PG DSN) ────────────────────────────────────────────────
if [ -n "$PEERS_DB_DSN" ]; then
  cat > /app/conf/store.docker.yml <<EOF
peers:
  store:
    rds:
      gorm:
        - name: postgres
          driver: postgres
          enable: true
          default: true
          dsn: ${PEERS_DB_DSN}
        - name: ai_chat
          driver: postgres
          enable: true
          default: false
          dsn: ${PEERS_DB_DSN}
        - name: oss
          driver: postgres
          enable: true
          default: false
          dsn: ${PEERS_DB_DSN}
        - name: applet_store
          driver: postgres
          enable: true
          default: false
          dsn: ${PEERS_DB_DSN}
        - name: launcher
          driver: postgres
          enable: true
          default: false
          dsn: ${PEERS_DB_DSN}
        - name: agent
          driver: postgres
          enable: true
          default: false
          dsn: ${PEERS_DB_DSN}
EOF
  OVERLAYS="${OVERLAYS}, store.docker.yml"
fi

# ── oss_backend.docker.yml (explicit object namespace ownership) ────────────
if [ -n "${PEERS_OSS_BACKEND:-}" ]; then
  cat > /app/conf/oss_backend.docker.yml <<EOF
peers:
  node:
    server:
      subserver:
        oss:
          backend: ${PEERS_OSS_BACKEND}
EOF
  OVERLAYS="${OVERLAYS}, oss_backend.docker.yml"
fi

# ── paths.docker.yml (libp2p key files persistent under /app/data) ──────────
# Always emitted so the named volume (`peers_data:/app/data`) preserves
# Relay/Station PeerIDs across container recreation.
cat > /app/conf/paths.docker.yml <<'EOF'
peers:
  node:
    transport:
      addrs:
        - /ip4/0.0.0.0/tcp/4001
      native:
        libp2p-identity-key-file: data/libp2pIdentity.key
    server:
      subserver:
        bootstrap:
          station-root-key-file: data/bootstrap.key
          node-identity-key-file: data/station-node.key
EOF
OVERLAYS="${OVERLAYS}, paths.docker.yml"

# ── federation.docker.yml (node-level libp2p federation policy) ──────────────
# Single overlay that wires every node-level libp2p concern (seeds, announced
# public-addrs, ConnectionGater switches) into peers.node.federation.*. Both
# the bootstrap subserver host and the transport host (used by the registry
# DHT) consume from this one location at startup, so there is no chance of
# two libp2p hosts in the same process drifting on federation policy.
#
# Defaults when env is unset: direct-outbound=true, direct-inbound=true,
# bootstrap-nodes=[], public-addrs=[]. We only emit a key when its env var
# is present, so unspecified deployments keep the federation.yml defaults.
if [ -n "$PEERS_BOOTSTRAP_NODES" ] \
  || [ -n "$PEERS_LIBP2P_PUBLIC_ADDRS" ] \
  || [ -n "$PEERS_FEDERATION_DIRECT_OUTBOUND" ] \
  || [ -n "$PEERS_FEDERATION_DIRECT_INBOUND" ] \
  || [ -n "$PEERS_FEDERATION_REPUBLISH_INTERVAL_SEC" ] \
  || [ -n "$PEERS_FEDERATION_REPUBLISH_DISABLED" ] \
  || [ -n "$PEERS_FEDERATION_MIN_DHT_PEERS" ]; then
  {
    echo "peers:"
    echo "  node:"
    echo "    federation:"
    if [ -n "$PEERS_BOOTSTRAP_NODES" ]; then
      echo "      bootstrap-nodes:"
      # Split CSV → indented YAML list. Strip whitespace around each entry.
      echo "$PEERS_BOOTSTRAP_NODES" | tr ',' '\n' | while IFS= read -r addr; do
        addr_trimmed=$(echo "$addr" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
        [ -n "$addr_trimmed" ] && echo "        - ${addr_trimmed}"
      done
    fi
    if [ -n "$PEERS_LIBP2P_PUBLIC_ADDRS" ]; then
      echo "      public-addrs:"
      echo "$PEERS_LIBP2P_PUBLIC_ADDRS" | tr ',' '\n' | while IFS= read -r addr; do
        addr_trimmed=$(echo "$addr" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
        [ -n "$addr_trimmed" ] && echo "        - ${addr_trimmed}"
      done
    fi
    if [ -n "$PEERS_FEDERATION_DIRECT_OUTBOUND" ]; then
      echo "      direct-outbound: ${PEERS_FEDERATION_DIRECT_OUTBOUND}"
    fi
    if [ -n "$PEERS_FEDERATION_DIRECT_INBOUND" ]; then
      echo "      direct-inbound: ${PEERS_FEDERATION_DIRECT_INBOUND}"
    fi
    # Phase D — locator republisher cadence + kill switch. Only emitted
    # when the operator explicitly opts in; the federation.yml defaults
    # cover the unspecified case.
    if [ -n "$PEERS_FEDERATION_REPUBLISH_INTERVAL_SEC" ]; then
      echo "      republish-interval-sec: ${PEERS_FEDERATION_REPUBLISH_INTERVAL_SEC}"
    fi
    if [ -n "$PEERS_FEDERATION_REPUBLISH_DISABLED" ]; then
      echo "      republish-disabled: ${PEERS_FEDERATION_REPUBLISH_DISABLED}"
    fi
    # Phase E.2 — readiness gate threshold. Same opt-in model: empty
    # means "use federation.yml" (which itself defaults to 1).
    if [ -n "$PEERS_FEDERATION_MIN_DHT_PEERS" ]; then
      echo "      min-dht-peers: ${PEERS_FEDERATION_MIN_DHT_PEERS}"
    fi
  } > /app/conf/federation.docker.yml
  OVERLAYS="${OVERLAYS}, federation.docker.yml"
fi

# ── relay.docker.yml (Relay control policy) ─────────────────────────────────
if [ "$PEERS_NODE_ROLE" = "relay" ]; then
  cat > /app/conf/relay.docker.yml <<EOF
peers:
  node:
    server:
      subserver:
        relay:
          operator-key-file: "${RELAY_OPERATOR_KEY_FILE}"
          operator-issuer: "${RELAY_OPERATOR_ISSUER}"
          operator-audience: "${RELAY_OPERATOR_AUDIENCE}"
          operator-scope: "${RELAY_OPERATOR_SCOPE}"
EOF
  OVERLAYS="${OVERLAYS}, relay.docker.yml"
fi

# ── relay_pool.docker.yml (Station standard Circuit target) ─────────────────
if [ "$PEERS_NODE_ROLE" = "station" ] && [ "${STATION_RELAY_ENABLED:-false}" = "true" ]; then
  cat > /app/conf/relay_pool.docker.yml <<EOF
peers:
  node:
    relay-pool:
      mode: custom
      relays:
        - peer-id: "${STATION_RELAY_PEER_ID}"
          addresses:
            - "${STATION_RELAY_MULTIADDR}"
          control-origin: "${STATION_RELAY_CONTROL_ORIGIN}"
          invite-token: "${STATION_RELAY_INVITE_TOKEN:-}"
          credential-file: "${STATION_RELAY_CREDENTIAL_FILE:-/app/data/relay-credentials/${STATION_RELAY_PEER_ID}.json}"
          tls-ca-file: "${STATION_RELAY_TLS_CA_FILE:-}"
          label: "${STATION_RELAY_LABEL:-station}"
EOF
  OVERLAYS="${OVERLAYS}, relay_pool.docker.yml"
fi

# ── server_host.docker.yml (per-deployment baseurl) ─────────────────────────
# The baked-in conf/server.host.local.yml carries a static baseurl that's only
# correct for the local dev box. In Docker we need each deployment to
# advertise its own host:port so the federation locator's StationDomain and
# the webfinger/activitypub URI minting both line up. Setting
# PEERS_NODE_SERVER_BASEURL in .env.<environment> drives this overlay.
if [ -n "$PEERS_NODE_SERVER_BASEURL" ]; then
  cat > /app/conf/server_host.docker.yml <<EOF
peers:
  node:
    server:
      baseurl: "${PEERS_NODE_SERVER_BASEURL}"
EOF
  OVERLAYS="${OVERLAYS}, server_host.docker.yml"
fi

# ── Patch peers.yml `includes:` once, idempotently ───────────────────────────
# We only append entries the file does not yet mention. Newly emitted overlays
# are added to the end so hierarchy-merge applies them last.
if [ -n "$OVERLAYS" ]; then
  for overlay in store.docker.yml paths.docker.yml federation.docker.yml relay.docker.yml relay_pool.docker.yml server_host.docker.yml; do
    case ",$OVERLAYS," in
      *",$overlay,"*|*", $overlay,"*)
        if ! grep -q "$overlay" /app/conf/peers.yml; then
          sed -i "s|\(includes:.*\)|\1, $overlay|" /app/conf/peers.yml
        fi
        ;;
    esac
  done
fi

# ── Host CLI provider wiring (e.g. traecli) ─────────────────────────────────
# The compose file bind-mounts the host's real CLI binary at
# /usr/local/bin/host-cli-bin and the host CLI auth/config home at
# /root/.host-cli-home when PEERS_HOST_CLI_*_MOUNT are set. Here we expose
# them under their canonical names (traecli on PATH, ~/.trae) so the agent
# subprocess can spawn the CLI without rebuilding the image. This is
# idempotent and a no-op when the sources are absent (default /dev/null bind).
HOST_CLI_BIN=/usr/local/bin/host-cli-bin
if [ -f "$HOST_CLI_BIN" ] && [ -x "$HOST_CLI_BIN" ]; then
  ln -sf "$HOST_CLI_BIN" /usr/local/bin/traecli
  echo "[entrypoint] host CLI binary wired: traecli -> $HOST_CLI_BIN"
fi

HOST_CLI_HOME=/root/.host-cli-home
if [ -d "$HOST_CLI_HOME" ] && [ -n "$(ls -A "$HOST_CLI_HOME" 2>/dev/null)" ]; then
  # Reuse the host's CLI login/config. Bind-mount is read-write so the CLI can
  # refresh its session metadata; ~/.trae is the canonical config location.
  rm -rf /root/.trae
  ln -sf "$HOST_CLI_HOME" /root/.trae
  echo "[entrypoint] host CLI home wired: /root/.trae -> $HOST_CLI_HOME"
fi

exec "$@"
