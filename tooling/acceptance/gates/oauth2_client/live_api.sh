#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${OAUTH2_CLIENT_TEST_ENV_FILE:-}"
if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "OAUTH2_CLIENT_TEST_ENV_FILE must identify the encrypted test environment" >&2
  exit 2
fi

for command in curl gh go jq python3; do
  command -v "$command" >/dev/null || {
    echo "missing required command: $command" >&2
    exit 2
  }
done

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required=(
  ADDR
  OAUTH_ADMIN_PASSWORD
  OAUTH_ADMIN_USERNAME
  OAUTH_GITHUB_CLIENT_ID
  OAUTH_GITHUB_REDIRECT_URI
  OAUTH_GITHUB_STORAGE_BRANCH
  OAUTH_GITHUB_STORAGE_OWNER
  OAUTH_GITHUB_STORAGE_REPO
  OAUTH_GOOGLE_CLIENT_ID
  OAUTH_GOOGLE_REDIRECT_URI
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing required environment variable: $name" >&2
    exit 2
  fi
done

if [[ "$ADDR" != "127.0.0.1:8080" ]]; then
  echo "live OAuth2 API Gate requires ADDR=127.0.0.1:8080" >&2
  exit 2
fi
if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port 8080 is already in use" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
module_root="$repo_root/apps/oauth2-client"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/oauth2-client-live.XXXXXX")"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$temporary"
}
trap cleanup EXIT

cd "$module_root"
go build -o "$temporary/oauth2-client-server" ./cmd/server
"$temporary/oauth2-client-server" >"$temporary/server.log" 2>&1 &
server_pid="$!"

for _ in $(seq 1 50); do
  if curl -fs --max-time 1 http://127.0.0.1:8080/api/healthz >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "OAuth2 client exited before health became ready" >&2
    exit 1
  fi
  sleep 0.2
done
curl -fsS --max-time 1 http://127.0.0.1:8080/api/healthz >/dev/null

for endpoint in \
  api/healthz \
  api/oauth/github/start \
  api/oauth/github/callback \
  api/admin \
  api/admin/data; do
  headers="$temporary/${endpoint//\//_}.method.headers"
  status="$(curl -sS -o /dev/null -D "$headers" -w '%{http_code}' \
    -X POST "http://127.0.0.1:8080/$endpoint")"
  if [[ "$status" != "405" ]] ||
    ! grep -Eiq '^Allow:[[:space:]]*GET\r?$' "$headers"; then
    echo "non-GET request was not rejected by $endpoint" >&2
    exit 1
  fi
done

ambiguous_status="$(curl -sS -o "$temporary/ambiguous.json" -w '%{http_code}' \
  'http://127.0.0.1:8080/api/oauth/github/callback?state=state&code=code&error=access_denied')"
if [[ "$ambiguous_status" != "400" ]] ||
  [[ "$(jq -r '.error' "$temporary/ambiguous.json")" != "invalid_callback_result" ]]; then
  echo "ambiguous OAuth callback was not rejected" >&2
  exit 1
fi

probe_start() {
  local provider="$1"
  local client_id="$2"
  local redirect_uri="$3"
  local expected_host="$4"
  local headers="$temporary/$provider.headers"
  local location

  curl -sS -D "$headers" -o /dev/null \
    "http://127.0.0.1:8080/api/oauth/$provider/start?site_id=default&return_to=http%3A%2F%2F127.0.0.1%3A49158%2Fcallback"
  location="$(awk '/^Location:/{sub(/^[^:]+:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit}' "$headers")"
  PROVIDER="$provider" \
  LOCATION="$location" \
  CLIENT_ID="$client_id" \
  REDIRECT_URI="$redirect_uri" \
  EXPECTED_HOST="$expected_host" \
    python3 - <<'PY'
import os
import sys
from urllib.parse import parse_qs, urlparse

provider = os.environ["PROVIDER"]
location = urlparse(os.environ["LOCATION"])
query = parse_qs(location.query)

required = {
    "client_id": os.environ["CLIENT_ID"],
    "code_challenge_method": "S256",
    "redirect_uri": os.environ["REDIRECT_URI"],
}
if location.scheme != "https" or location.hostname != os.environ["EXPECTED_HOST"]:
    raise SystemExit(f"{provider} authorization endpoint is invalid")
for key, expected in required.items():
    if query.get(key) != [expected]:
        raise SystemExit(f"{provider} authorization parameter {key} is invalid")
if not query.get("state", [""])[0] or not query.get("code_challenge", [""])[0]:
    raise SystemExit(f"{provider} authorization state or PKCE challenge is missing")
if provider == "google" and query.get("response_type") != ["code"]:
    raise SystemExit("google authorization response_type is not code")
PY
}

probe_start github "$OAUTH_GITHUB_CLIENT_ID" "$OAUTH_GITHUB_REDIRECT_URI" github.com
probe_start google "$OAUTH_GOOGLE_CLIENT_ID" "$OAUTH_GOOGLE_REDIRECT_URI" accounts.google.com

curl -fsS \
  -u "$OAUTH_ADMIN_USERNAME:$OAUTH_ADMIN_PASSWORD" \
  -H "Accept: application/json" \
  http://127.0.0.1:8080/api/admin/data >"$temporary/admin.json"
jq -e '
  ([.identities[].provider] | sort) == ["github", "google"] and
  all(.identities[]; .email_verified == true and .login_count >= 1)
' "$temporary/admin.json" >/dev/null

OAUTH2_CLIENT_LIVE=1 go test ./internal/integration \
  -run '^TestLiveGitHubStorePersistsRefreshClaimAcrossInstances$' \
  -count=1

tree="$(gh api \
  "repos/$OAUTH_GITHUB_STORAGE_OWNER/$OAUTH_GITHUB_STORAGE_REPO/git/trees/$OAUTH_GITHUB_STORAGE_BRANCH?recursive=1" \
  --jq ".tree[].path")"
for prefix in transactions identities credentials refresh-operations audits; do
  if ! grep -Eq "^oauth-data/$prefix/.+\\.json$" <<<"$tree"; then
    echo "missing GitHub repository record class: $prefix" >&2
    exit 1
  fi
done

mkdir -m 700 "$temporary/envelopes"
while IFS= read -r record_path; do
  [[ "$record_path" == oauth-data/*.json ||
     "$record_path" == oauth-data/*/*.json ||
     "$record_path" == oauth-data/*/*/*.json ||
     "$record_path" == oauth-data/*/*/*/*.json ]] || continue
  output="$temporary/envelopes/${record_path//\//_}"
  gh api \
    "repos/$OAUTH_GITHUB_STORAGE_OWNER/$OAUTH_GITHUB_STORAGE_REPO/contents/$record_path?ref=$OAUTH_GITHUB_STORAGE_BRANCH" \
    --jq .content | tr -d '\n' | base64 -d >"$output"
  jq -e \
    --arg key_id "$OAUTH_CREDENTIAL_ACTIVE_KEY_ID" \
    '.version == 1 and .key_id == $key_id and
     .algorithm == "AES-256-GCM" and
     (.nonce | type == "string") and
     (.ciphertext | type == "string")' \
    "$output" >/dev/null
done <<<"$tree"

for secret in \
  "$OAUTH_GITHUB_CLIENT_SECRET" \
  "$OAUTH_GOOGLE_CLIENT_SECRET" \
  "$OAUTH_GITHUB_APP_PRIVATE_KEY_B64" \
  "$OAUTH_CREDENTIAL_KEY_V1" \
  "${OAUTH_CREDENTIAL_KEY_V2:-}" \
  "$OAUTH_STORAGE_INDEX_HMAC_KEY" \
  "$OAUTH_AUDIT_HMAC_KEY" \
  "$OAUTH_ADMIN_PASSWORD"; do
  if [[ -n "$secret" ]] && grep -FRq -- "$secret" "$temporary/envelopes"; then
    echo "plaintext secret found in GitHub repository envelopes" >&2
    exit 1
  fi
done

rotation="$(go run ./cmd/rotate-records)"
jq -e \
  '.complete == true and .failed == 0 and .rotated == 0 and .unchanged > 0' \
  <<<"$rotation" >/dev/null

jq -n \
  --arg source_commit "$(git -C "$repo_root" rev-parse HEAD)" \
  --arg repository "$OAUTH_GITHUB_STORAGE_OWNER/$OAUTH_GITHUB_STORAGE_REPO" \
  --arg active_key "$OAUTH_CREDENTIAL_ACTIVE_KEY_ID" \
  --argjson identity_count "$(jq '.identities | length' "$temporary/admin.json")" \
  --argjson envelope_count "$(find "$temporary/envelopes" -type f | wc -l | tr -d ' ')" \
  '{
    status: "PASS",
    source_commit: $source_commit,
    providers: ["github", "google"],
    identity_count: $identity_count,
    repository: $repository,
    envelope_count: $envelope_count,
    active_key: $active_key,
    pkce_method: "S256",
    method_contract: "GET-only",
    ambiguous_callback_rejected: true,
    plaintext_secrets: false,
    rotation_idempotent: true
  }'
