#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# pt-relay-issue-invites.sh — bootstrap invite tokens for the test bench
#
# Each station needs a one-time admin-issued invite_token before it can mount
# itself onto the Relay's `/api/v1/relay/forward/*` plane. This script:
#
#   1. Mints a short-lived admin JWT locally using the same PEERS_AUTH_SECRET
#      the Relay container is configured with (read from .env.pt-relay).
#   2. Calls POST /api/v1/relay/invite four times — one open invite per station
#      (no station_peer_id binding at creation time; each station provides its
#      own peer_id via the X-Station-Peer-ID header at register time).
#   3. Idempotently rewrites RELAY_CLIENT_* variables in each station's
#      .env.pt-station-* file:
#        RELAY_CLIENT_ENABLED=true
#        RELAY_CLIENT_RELAY_URL=http://10.37.118.48:18081
#        RELAY_CLIENT_RELAY_STREAM_ADDR=10.37.118.48:4501
#        RELAY_CLIENT_INVITE_TOKEN=<freshly minted invite_token>
#
# Re-running the script issues NEW invite tokens (invites are single-use). If
# the existing relay_token cache file under /app/data/relay_token is still
# valid (i.e. station was already mounted at least once and the JWT has not
# expired), the new invite remains unused — that is intentional and safe.
#
# Layering note: this script lives in tooling/ — it is operator ceremony, not
# product code. It only fills in fields the relay-client subserver already
# reads from YAML/env. See:
#   apps/station/frame/core/plugin/native/subserver/relay-client/plugin.go
#   apps/station/frame/core/plugin/native/subserver/relay/handler_admin.go
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Fixed test-bench layout. Mirrors .localenv §1.
RELAY_HTTP_HOST="${RELAY_HTTP_HOST:-10.37.118.48}"
RELAY_HTTP_PORT="${RELAY_HTTP_PORT:-18081}"
RELAY_STREAM_HOST="${RELAY_STREAM_HOST:-${RELAY_HTTP_HOST}}"
RELAY_STREAM_PORT="${RELAY_STREAM_PORT:-4501}"

RELAY_BASE_URL="http://${RELAY_HTTP_HOST}:${RELAY_HTTP_PORT}"
RELAY_STREAM_ADDR="${RELAY_STREAM_HOST}:${RELAY_STREAM_PORT}"

RELAY_ENV_FILE="$PROJECT_ROOT/tooling/docker/.env.pt-relay"

STATION_ENV_FILES=(
  "$PROJECT_ROOT/tooling/docker/.env.pt-station-1"
  "$PROJECT_ROOT/tooling/docker/.env.pt-station-2"
  "$PROJECT_ROOT/tooling/docker/.env.pt-station-relay-only"
  "$PROJECT_ROOT/tooling/docker/.env"
)

# Default labels mirror compose project names so /api/v1/relay/mounts is
# self-explanatory in the dashboard.
declare -a STATION_LABELS=(
  "pt-station-1"
  "pt-station-2"
  "pt-station-relay-only"
  "pt-station-local"
)

# Invite TTL — long enough to outlive normal startup latency, short enough
# that a leaked invite expires before it can be abused. Seven days mirrors
# the baked-in default of relay/handler_admin.go.
INVITE_TTL="${INVITE_TTL:-168h}"

# Admin JWT TTL — only used during this script's run.
ADMIN_TTL_SECONDS="${ADMIN_TTL_SECONDS:-300}"

log()  { printf '\033[0;36m[invite]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[invite]\033[0m %s\n' "$*"; }
fail() { printf '\033[0;31m[invite]\033[0m %s\n' "$*" >&2; exit 1; }

# ── Resolve PEERS_AUTH_SECRET ────────────────────────────────────────────────
if [ ! -f "$RELAY_ENV_FILE" ]; then
  fail "$RELAY_ENV_FILE not found — cannot derive admin JWT secret"
fi
SECRET="$(grep -E '^PEERS_AUTH_SECRET=' "$RELAY_ENV_FILE" | head -n1 | sed 's/^PEERS_AUTH_SECRET=//')"
if [ -z "$SECRET" ]; then
  fail "PEERS_AUTH_SECRET missing in $RELAY_ENV_FILE"
fi

# ── Mint an HS256 JWT (subject=admin) ────────────────────────────────────────
# We hand-roll the JWT to avoid forcing a Python / pyjwt dependency on
# operator workstations. Algorithm + claim shape mirrors
# apps/station/frame/core/auth/jwt.go.
b64url() {
  # base64url without padding, on a single line.
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

now_epoch="$(date -u +%s)"
exp_epoch=$(( now_epoch + ADMIN_TTL_SECONDS ))

header_json='{"alg":"HS256","typ":"JWT"}'
# subject_id="admin" is fine: the relay subserver's requireAdmin guard only
# rejects relay-access:* / relay-client:* prefixes (handler.go:88-92).
payload_json="$(printf '{"subject_id":"admin","attrs":{"role":"admin"},"iat":%s,"exp":%s}' "$now_epoch" "$exp_epoch")"

header_b64="$(printf '%s' "$header_json" | b64url)"
payload_b64="$(printf '%s' "$payload_json" | b64url)"
signing_input="${header_b64}.${payload_b64}"
signature_b64="$(printf '%s' "$signing_input" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64url)"

ADMIN_JWT="${signing_input}.${signature_b64}"

# ── Probe relay reachability ─────────────────────────────────────────────────
log "probing $RELAY_BASE_URL"
if ! curl -fsS --max-time 5 "$RELAY_BASE_URL/sub-oss/healthz" >/dev/null 2>&1; then
  fail "Relay not reachable at $RELAY_BASE_URL — bring it up first: make pt-up ENV=pt-relay"
fi

# ── Issue invites + patch env files ──────────────────────────────────────────
issue_invite() {
  local label="$1"
  local body
  body="$(printf '{"label":"%s","expires_in":"%s"}' "$label" "$INVITE_TTL")"
  local resp
  if ! resp="$(curl -fsS --max-time 10 \
      -H "Authorization: Bearer ${ADMIN_JWT}" \
      -H "Content-Type: application/json" \
      -X POST \
      --data "$body" \
      "$RELAY_BASE_URL/api/v1/relay/invite")"; then
    fail "POST /api/v1/relay/invite failed for label=$label"
  fi
  if command -v jq >/dev/null 2>&1; then
    echo "$resp" | jq -r '.invite_token // empty'
  else
    echo "$resp" | sed -n 's/.*"invite_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
  fi
}

# Portable in-place sed (BSD on macOS vs GNU on Linux).
sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

# Set or replace KEY=VALUE in a dotenv file. We escape '|' in values so we
# can use it as the sed delimiter (env values in this project never contain
# '|' but '/' shows up in URLs and tokens).
upsert_env() {
  local file="$1" key="$2" value="$3"
  local escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\\&|]/\\&/g')"
  if grep -q "^${key}=" "$file"; then
    sed_inplace "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

idx=0
for env_file in "${STATION_ENV_FILES[@]}"; do
  if [ ! -f "$env_file" ]; then
    warn "skip: $env_file not found"
    idx=$(( idx + 1 ))
    continue
  fi
  label="${STATION_LABELS[$idx]:-station}"
  log "issuing invite for $label → ${env_file##*/}"
  invite_token="$(issue_invite "$label")"
  if [ -z "$invite_token" ]; then
    fail "empty invite_token for $label"
  fi
  upsert_env "$env_file" "RELAY_CLIENT_ENABLED" "true"
  upsert_env "$env_file" "RELAY_CLIENT_RELAY_URL" "$RELAY_BASE_URL"
  upsert_env "$env_file" "RELAY_CLIENT_RELAY_STREAM_ADDR" "$RELAY_STREAM_ADDR"
  upsert_env "$env_file" "RELAY_CLIENT_LABEL" "$label"
  upsert_env "$env_file" "RELAY_CLIENT_INVITE_TOKEN" "$invite_token"
  log "  ✓ ${env_file##*/}: invite issued"
  idx=$(( idx + 1 ))
done

cat <<EOF

✓ Issued ${idx} invite tokens. Next step:

  make pt-up ENV=pt-station-1
  make pt-up ENV=pt-station-2
  make pt-up ENV=pt-station-relay-only
  # local node only if your local docker daemon is running:
  # make pt-up ENV=pt-station-local

After each station is up:

  curl -s ${RELAY_BASE_URL}/api/v1/relay/mounts \\
    -H "Authorization: Bearer \$ADMIN_JWT" | jq

The Relay's /api/v1/relay/mounts should list each station with status=Online.

Re-run this script ONLY when:
  * you reset the Relay's database (mount + invite tables wiped), OR
  * a station's persistent /app/data/relay_token has expired, AND
  * you removed that file so the station falls back to the invite path.

EOF
