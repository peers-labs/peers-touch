#!/usr/bin/env bash
#
# WE-20261104 / WE-S7 — provisioner control-plane authentication gates.
#
# When a shared secret is provisioned (SANDBOX_PROVISIONER_TOKEN), the
# provisioner must require "Authorization: Bearer <token>" on every /v1 call
# while leaving /healthz open for liveness. With no secret configured (dev
# cell) the surface stays open but network placement is the only boundary.
#
# Asserts with the REAL provisioner container (no mocks):
#   A1 healthz is reachable without a token
#   A2 /v1 call with NO Authorization header is refused (401)
#   A3 /v1 call with a WRONG token is refused (401)
#   A4 /v1 call with the CORRECT token is accepted (200)
#   A5 a provisioner started WITHOUT a token still serves /v1 (dev mode)
#
# Output: tooling/acceptance/reports/task-workbench/we-s7-provisioner-auth.json
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
MGMT="wbox-mgmt-auth"
PROV="we-s7-auth"
PROV_OPEN="we-s7-auth-open"
TOKEN="we-s7-gate-token"
BASE_TAG="peers/workspace-sandbox-base:24.04-1"
PROV_TAG="peers/workspace-sandbox-provisioner:dev"
REPORT_DIR="$ROOT/tooling/acceptance/reports/task-workbench"
REPORT="$REPORT_DIR/we-s7-provisioner-auth.json"

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()
log() { printf '\033[36m[we-s7-auth]\033[0m %s\n' "$*"; }
record() {
  local id="$1" pass="$2" evidence="$3"
  RESULTS+=("$id|$pass|$evidence")
  if [[ "$pass" == "1" ]]; then PASS_COUNT=$((PASS_COUNT+1)); printf '\033[32mPASS\033[0m %s — %s\n' "$id" "$evidence";
  else FAIL_COUNT=$((FAIL_COUNT+1)); printf '\033[31mFAIL\033[0m %s — %s\n' "$id" "$evidence"; fi
}

cleanup() {
  docker rm -f "$PROV" "$PROV_OPEN" >/dev/null 2>&1 || true
  docker network rm "$MGMT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "building base + provisioner images"
docker build -q -t "$BASE_TAG" \
  -f "$ROOT/tooling/docker/sandbox/sandbox-base.Dockerfile" \
  --build-arg APT_MIRROR=mirrors.aliyun.com "$ROOT" >/dev/null
IMAGE_ID="$(docker inspect -f '{{.Id}}' "$BASE_TAG")"
docker build -q -t "$PROV_TAG" \
  -f "$ROOT/tooling/docker/sandbox/provisioner.Dockerfile" "$ROOT" >/dev/null

docker network inspect "$MGMT" >/dev/null 2>&1 || docker network create "$MGMT" >/dev/null
cleanup
docker network inspect "$MGMT" >/dev/null 2>&1 || docker network create "$MGMT" >/dev/null

docker run -d --name "$PROV" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e "SANDBOX_ALLOWED_IMAGE_IDS=$IMAGE_ID" \
  -e "SANDBOX_PROVISIONER_TOKEN=$TOKEN" \
  --network "$MGMT" "$PROV_TAG" >/dev/null
sleep 2

# call <container> <auth-header-or-> <path> ; echoes "STATUS|BODY" via -S.
call() {
  local c="$1" auth="$2" path="$3" args=()
  [[ "$auth" != "-" ]] && args=(--header="$auth")
  docker exec "$c" wget -S -q --content-on-error "${args[@]}" -O- \
    "http://127.0.0.1:8090$path" 2>&1
}
# post_call <container> <auth-header-or-> <path> <json> ; POST so /v1 handlers
# (all method-guarded) are exercised rather than GET (405).
post_call() {
  local c="$1" auth="$2" path="$3" json="$4" args=()
  [[ "$auth" != "-" ]] && args=(--header="$auth")
  docker exec "$c" wget -S -q --content-on-error "${args[@]}" \
    --header='Content-Type: application/json' --post-data="$json" -O- \
    "http://127.0.0.1:8090$path" 2>&1
}
status_of() { printf '%s' "$1" | sed -n 's/.*HTTP\/1\.[01] \([0-9]\{3\}\).*/\1/p' | tail -1; }

# A1 — healthz open without a token.
H_BODY="$(call "$PROV" "-" /healthz)"
[[ "$(status_of "$H_BODY")" == "200" ]] \
  && record A1 1 "healthz 200 without token" \
  || record A1 0 "status=$(status_of "$H_BODY")"

# A2 — no Authorization header on /v1 refused.
NOAUTH="$(post_call "$PROV" "-" /v1/sandboxes/reconcile '{"sandbox_refs":[]}')"
[[ "$(status_of "$NOAUTH")" == "401" ]] \
  && record A2 1 "no header -> 401" \
  || record A2 0 "no header -> $(status_of "$NOAUTH")"

# A3 — wrong token refused.
WRONG="$(post_call "$PROV" "Authorization: Bearer not-the-token" /v1/sandboxes/reconcile '{"sandbox_refs":[]}')"
[[ "$(status_of "$WRONG")" == "401" ]] \
  && record A3 1 "wrong token -> 401" \
  || record A3 0 "wrong token -> $(status_of "$WRONG")"

# A4 — correct token accepted (reconcile with empty list returns 200).
OK="$(post_call "$PROV" "Authorization: Bearer $TOKEN" /v1/sandboxes/reconcile '{"sandbox_refs":[]}')"
[[ "$(status_of "$OK")" == "200" ]] \
  && record A4 1 "correct token -> 200" \
  || record A4 0 "correct token -> $(status_of "$OK")"

# A5 — dev mode (no token configured) still serves /v1.
docker run -d --name "$PROV_OPEN" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e "SANDBOX_ALLOWED_IMAGE_IDS=$IMAGE_ID" \
  --network "$MGMT" "$PROV_TAG" >/dev/null
sleep 2
OPEN="$(post_call "$PROV_OPEN" "-" /v1/sandboxes/reconcile '{"sandbox_refs":[]}')"
[[ "$(status_of "$OPEN")" == "200" ]] \
  && record A5 1 "no-token provisioner serves /v1 (dev mode)" \
  || record A5 0 "dev mode status=$(status_of "$OPEN")"

mkdir -p "$REPORT_DIR"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_REV="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
{
  printf '{\n'
  printf '  "plan": "WE-20261104",\n  "slice": "WE-S7",\n'
  printf '  "gate": "provisioner-bearer-auth",\n'
  printf '  "ran_at": "%s",\n  "source_commit": "%s",\n' "$TS" "$GIT_REV"
  printf '  "pass": %d,\n  "fail": %d,\n  "results": [\n' "$PASS_COUNT" "$FAIL_COUNT"
  total=${#RESULTS[@]}
  for i in "${!RESULTS[@]}"; do
    IFS='|' read -r id pass evidence <<<"${RESULTS[$i]}"
    [[ $pass == 1 ]] && ok=true || ok=false
    esc="$(printf '%s' "$evidence" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    comma=","; [[ $i -eq $((total-1)) ]] && comma=""
    printf '    {"id":"%s","pass":%s,"evidence":"%s"}%s\n' "$id" "$ok" "$esc" "$comma"
  done
  printf '  ]\n}\n'
} > "$REPORT"

log "report: $REPORT"
printf 'PASS=%d FAIL=%d\n' "$PASS_COUNT" "$FAIL_COUNT"
[[ "$FAIL_COUNT" -eq 0 ]]
