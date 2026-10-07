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
#   conf/paths.docker.yml         — always (redirects key files into /app/data)
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
#   conf/relay.docker.yml         — relay role only; projects the mandatory
#                                   listener, TLS, signing-key, operator-policy,
#                                   and development loopback-exception settings
#   conf/relay_client.docker.yml  — only when RELAY_CLIENT_ENABLED=true
#                                   (Station nodes only — turns on the station-side
#                                    pump that mounts the local Station onto the Relay
#                                    via /api/v1/relay/register + framed TCP stream)
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
  : "${RELAY_STREAM_LISTEN_ADDR:?RELAY_STREAM_LISTEN_ADDR is required for relay role}"
  : "${PEERS_NODE_SERVER_BASEURL:?PEERS_NODE_SERVER_BASEURL is required for relay role}"
  : "${RELAY_SIGNING_KEY_FILE:?RELAY_SIGNING_KEY_FILE is required for relay role}"
  : "${RELAY_OPERATOR_KEY_FILE:?RELAY_OPERATOR_KEY_FILE is required for relay role}"
  : "${RELAY_OPERATOR_ISSUER:?RELAY_OPERATOR_ISSUER is required for relay role}"
  : "${RELAY_OPERATOR_AUDIENCE:?RELAY_OPERATOR_AUDIENCE is required for relay role}"
  : "${RELAY_OPERATOR_SCOPE:?RELAY_OPERATOR_SCOPE is required for relay role}"
  case "${RELAY_ALLOW_INSECURE_LOOPBACK:-false}" in
    true)
      ;;
    false)
      : "${RELAY_PUBLIC_LISTEN_ADDR:?RELAY_PUBLIC_LISTEN_ADDR is required for relay role}"
      : "${RELAY_PUBLIC_UPSTREAM_URL:?RELAY_PUBLIC_UPSTREAM_URL is required for relay role}"
      : "${RELAY_TLS_CERT_FILE:?RELAY_TLS_CERT_FILE is required for relay role}"
      : "${RELAY_TLS_KEY_FILE:?RELAY_TLS_KEY_FILE is required for relay role}"
      case "$PEERS_NODE_SERVER_BASEURL" in
        https://*)
          ;;
        *)
          echo "[entrypoint] relay role requires an HTTPS PEERS_NODE_SERVER_BASEURL" >&2
          exit 1
          ;;
      esac
      ;;
    *)
      echo "[entrypoint] RELAY_ALLOW_INSECURE_LOOPBACK must be true or false" >&2
      exit 1
      ;;
  esac
  if [ "${RELAY_CLIENT_ENABLED:-false}" = "true" ]; then
    echo "[entrypoint] relay role cannot enable relay-client" >&2
    exit 1
  fi
fi

# /app/data is a named volume; subdirectories must be created at runtime
# (mkdir from the Dockerfile would be shadowed by the empty volume mount).
# Each subdirectory hosts a single concern so the volume layout is greppable:
#   /app/data/oss                   — OSS local-backend store
#   /app/data/messaging-attachments — Messaging encrypted attachment blobs
#   /app/data/social-private-objects — Social encrypted private object blobs
#   /app/data/libp2pIdentity.key     — transport identity (paths.docker.yml)
#   /app/data/bootstrap.key          — bootstrap subserver identity (paths.docker.yml)
mkdir -p \
  /app/data/oss \
  /app/data/messaging-attachments \
  /app/data/social-private-objects

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

# ── paths.docker.yml (libp2p key files persistent under /app/data) ──────────
# Always emitted so the named volume (`peers_data:/app/data`) preserves
# Relay/Station PeerIDs across container recreation.
cat > /app/conf/paths.docker.yml <<'EOF'
peers:
  node:
    transport:
      native:
        libp2p-identity-key-file: data/libp2pIdentity.key
    server:
      subserver:
        bootstrap:
          identity-key: data/bootstrap.key
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

# ── relay.docker.yml (Relay subserver TCP stream listener) ──────────────────
# The relay subserver's TCP listener for station mounts. Emitted only on the
# Relay node so stations do NOT accidentally accept relay client streams.
if [ "$PEERS_NODE_ROLE" = "relay" ]; then
  relay_public_config=""
  if [ "${RELAY_ALLOW_INSECURE_LOOPBACK:-false}" = "false" ]; then
    relay_public_config="$(printf \
      '          public-listen-addr: "%s"\n          public-upstream-url: "%s"\n' \
      "$RELAY_PUBLIC_LISTEN_ADDR" \
      "$RELAY_PUBLIC_UPSTREAM_URL")"
  fi
  cat > /app/conf/relay.docker.yml <<EOF
peers:
  node:
    server:
      address: "127.0.0.1:18080"
      subserver:
        relay:
${relay_public_config}
          stream-listen-addr: "${RELAY_STREAM_LISTEN_ADDR}"
          tls-cert-file: "${RELAY_TLS_CERT_FILE:-}"
          tls-key-file: "${RELAY_TLS_KEY_FILE:-}"
          allow-insecure-loopback: ${RELAY_ALLOW_INSECURE_LOOPBACK:-false}
          signing-key-file: "${RELAY_SIGNING_KEY_FILE}"
          operator-key-file: "${RELAY_OPERATOR_KEY_FILE}"
          operator-issuer: "${RELAY_OPERATOR_ISSUER}"
          operator-audience: "${RELAY_OPERATOR_AUDIENCE}"
          operator-scope: "${RELAY_OPERATOR_SCOPE}"
EOF
  OVERLAYS="${OVERLAYS}, relay.docker.yml"
fi

# ── relay_client.docker.yml (Station-side mount onto a remote Relay) ─────────
# Emitted only when RELAY_CLIENT_ENABLED=true. Stations set this; the Relay
# itself does NOT — it is the relay endpoint, not a station mounting onto one.
if [ "$PEERS_NODE_ROLE" = "station" ] && [ "$RELAY_CLIENT_ENABLED" = "true" ]; then
  : "${RELAY_CLIENT_RELAY_URL:?RELAY_CLIENT_RELAY_URL required when RELAY_CLIENT_ENABLED=true}"
  : "${RELAY_CLIENT_RELAY_STREAM_ADDR:?RELAY_CLIENT_RELAY_STREAM_ADDR required when RELAY_CLIENT_ENABLED=true}"
  cat > /app/conf/relay_client.docker.yml <<EOF
peers:
  node:
    server:
      subserver:
        relay-client:
          enabled: true
          relay-url: "${RELAY_CLIENT_RELAY_URL}"
          relay-stream-addr: "${RELAY_CLIENT_RELAY_STREAM_ADDR}"
          invite-token: "${RELAY_CLIENT_INVITE_TOKEN:-}"
          label: "${RELAY_CLIENT_LABEL:-}"
          local-http-port: ${RELAY_CLIENT_LOCAL_HTTP_PORT:-18080}
          bootstrap-identity-url: "${RELAY_CLIENT_BOOTSTRAP_IDENTITY_URL:-http://127.0.0.1:18080/sub-bootstrap/station-identity}"
          token-store-path: "${RELAY_CLIENT_TOKEN_STORE_PATH:-data/relay_token}"
          use-tls: ${RELAY_CLIENT_USE_TLS:-true}
          tls-insecure-skip-verify: ${RELAY_CLIENT_TLS_INSECURE_SKIP_VERIFY:-false}
          credential-refresh-interval-sec: ${RELAY_CLIENT_CREDENTIAL_REFRESH_INTERVAL_SEC:-300}
EOF
  OVERLAYS="${OVERLAYS}, relay_client.docker.yml"
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
  for overlay in store.docker.yml paths.docker.yml federation.docker.yml relay.docker.yml relay_client.docker.yml server_host.docker.yml; do
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
