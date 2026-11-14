#!/usr/bin/env bash
#
# WE-20261104 / WE-S5 — real-container workspace volume lifecycle gates.
#
# The persistent identity is the workspace volume + sandbox_ref; the container
# is disposable. Drives the INDEPENDENT provisioner over HTTP against the local
# Docker daemon and asserts, with REAL containers/volumes (no mocks):
#
#   L1 provisioner health reports oci_linux available
#   L2 allocate + write a file into the /workspace volume
#   L3 DORMANT -> cold-start retains the file (volume outlives the container)
#   L4 release keep_volume=true drops the container but KEEPS the volume; a
#      re-allocate against the same ref sees the prior file
#   L5 release with a FOREIGN volume_ref is rejected and removes nothing:
#      neither the named foreign host volume nor the owned container is touched
#   L6 release keep_volume=false deletes the owned volume (full teardown)
#
# Output: tooling/acceptance/reports/task-workbench/we-s5-lifecycle-gates.json
#
# Usage:  bash tooling/acceptance/closures/we-s5/lifecycle-gates.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
NET="wbox-isolated"
MGMT="wbox-mgmt"
PROV="we-s5-provisioner"
REF="we-s5-ws"
FOREIGN_VOL="we-s5-foreign-host-data"
BASE_TAG="peers/workspace-sandbox-base:24.04-1"
PROV_TAG="peers/workspace-sandbox-provisioner:dev"
REPORT_DIR="$ROOT/tooling/acceptance/reports/task-workbench"
REPORT="$REPORT_DIR/we-s5-lifecycle-gates.json"

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

c_b64() { base64 -d 2>/dev/null || true; }
log() { printf '\033[36m[we-s5]\033[0m %s\n' "$*"; }
record() { # record <id> <pass(0|1)> <evidence>
  local id="$1" pass="$2" evidence="$3"
  RESULTS+=("$id|$pass|$evidence")
  if [[ "$pass" == "1" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    printf '\033[32mPASS\033[0m %s — %s\n' "$id" "$evidence"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf '\033[31mFAIL\033[0m %s — %s\n' "$id" "$evidence"
  fi
}

cleanup() {
  docker rm -f "$PROV" "wbox-$REF" >/dev/null 2>&1 || true
  docker volume rm "wbox-vol-$REF" "$FOREIGN_VOL" >/dev/null 2>&1 || true
  docker network rm "$MGMT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── Images ──────────────────────────────────────────────────────────────
log "building base + provisioner images (content-id-pinned)"
docker build -q -t "$BASE_TAG" \
  -f "$ROOT/tooling/docker/sandbox/sandbox-base.Dockerfile" \
  --build-arg APT_MIRROR=mirrors.aliyun.com "$ROOT" >/dev/null
IMAGE_ID="$(docker inspect -f '{{.Id}}' "$BASE_TAG")"
log "base image pinned id: $IMAGE_ID"
docker build -q -t "$PROV_TAG" \
  -f "$ROOT/tooling/docker/sandbox/provisioner.Dockerfile" "$ROOT" >/dev/null

# ── Networks + provisioner ────────────────────────────────────────────────
docker network inspect "$NET" >/dev/null 2>&1 || docker network create --internal "$NET" >/dev/null
docker network inspect "$MGMT" >/dev/null 2>&1 || docker network create "$MGMT" >/dev/null
cleanup
docker network inspect "$NET" >/dev/null 2>&1 || docker network create --internal "$NET" >/dev/null
docker network inspect "$MGMT" >/dev/null 2>&1 || docker network create "$MGMT" >/dev/null
docker run -d --name "$PROV" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e "SANDBOX_ALLOWED_IMAGE_IDS=$IMAGE_ID" \
  -e "SANDBOX_ISOLATED_NETWORK=$NET" \
  --network "$MGMT" "$PROV_TAG" >/dev/null
sleep 2

# req <json> <path> ; prints raw body (works for non-2xx via --content-on-error)
req() { docker exec "$PROV" wget -q --content-on-error -O- \
  --post-data="$1" --header='Content-Type: application/json' \
  "http://127.0.0.1:8090$2"; }
alloc() { req "{\"sandbox_ref\":\"$REF\",\"image_ref\":\"$IMAGE_ID\"}" /v1/sandboxes/allocate; }
exec_sh() { req "{\"sandbox_ref\":\"$REF\",\"command\":\"sh\",\"args\":[\"-c\",\"$1\"]}" /v1/sandboxes/exec; }
stdout_of() { printf '%s' "$1" | sed -n 's/.*"stdout":"\([^"]*\)".*/\1/p' | c_b64; }
container_exists() { docker inspect "wbox-$REF" >/dev/null 2>&1; }
container_running() { [[ "$(docker inspect -f '{{.State.Running}}' "wbox-$REF" 2>/dev/null || echo false)" == "true" ]]; }
owned_volume_exists() { docker volume inspect "wbox-vol-$REF" >/dev/null 2>&1; }

# L1
HEALTH="$(docker exec "$PROV" wget -qO- http://127.0.0.1:8090/healthz)"
printf '%s' "$HEALTH" | grep -q '"available":true' \
  && record L1 1 "$HEALTH" || record L1 0 "$HEALTH"

# L2 — allocate and write a marker into the persistent volume.
alloc >/dev/null; sleep 1
W_OUT="$(exec_sh 'echo we-s5-life > /workspace/life.txt && cat /workspace/life.txt')"
[[ "$(stdout_of "$W_OUT" | tr -d '[:space:]')" == "we-s5-life" ]] \
  && record L2 1 "allocated and wrote /workspace/life.txt" || record L2 0 "$W_OUT"

# L3 — park DORMANT (container stopped), then cold-start: file must survive.
req "{\"sandbox_ref\":\"$REF\"}" /v1/sandboxes/dormant >/dev/null
sleep 1
PARKED="$(docker inspect -f '{{.State.Running}}' "wbox-$REF" 2>/dev/null || echo gone)"
alloc >/dev/null; sleep 1
LIFE_AFTER="$(exec_sh 'cat /workspace/life.txt')"
LIFE_TXT="$(stdout_of "$LIFE_AFTER" | tr -d '[:space:]')"
if [[ "$PARKED" == "false" ]] && container_running && [[ "$LIFE_TXT" == "we-s5-life" ]]; then
  record L3 1 "dormant($PARKED)->cold-started, file survived"
else
  record L3 0 "parked=$PARKED running=$(container_running && echo yes || echo no) file=$LIFE_TXT"
fi

# L4 — keep_volume release removes the container but keeps the volume; a
# re-allocate against the same ref reattaches the persisted workspace.
req "{\"sandbox_ref\":\"$REF\",\"keep_volume\":true}" /v1/sandboxes/release >/dev/null
sleep 1
if ! container_exists && owned_volume_exists; then
  alloc >/dev/null; sleep 1
  RE_TXT="$(stdout_of "$(exec_sh 'cat /workspace/life.txt')" | tr -d '[:space:]')"
  container_running && [[ "$RE_TXT" == "we-s5-life" ]] \
    && record L4 1 "keep_volume retained volume; re-allocate saw file" \
    || record L4 0 "re-alloc running=$(container_running && echo yes || echo no) file=$RE_TXT"
else
  record L4 0 "container_exists=$(container_exists && echo yes || echo no) volume=$(owned_volume_exists && echo yes || echo no)"
fi

# L5 — a foreign volume_ref must be rejected and remove nothing.
docker volume create "$FOREIGN_VOL" >/dev/null
FOREIGN_RESP="$(req "{\"sandbox_ref\":\"$REF\",\"volume_ref\":\"$FOREIGN_VOL\",\"keep_volume\":false}" /v1/sandboxes/release)"
sleep 1
FOREIGN_OK="$(docker volume inspect "$FOREIGN_VOL" >/dev/null 2>&1 && echo yes || echo no)"
if printf '%s' "$FOREIGN_RESP" | grep -qi 'policy rejected' && \
   [[ "$FOREIGN_OK" == "yes" ]] && container_exists; then
  record L5 1 "foreign release rejected; foreign volume + owned container intact"
else
  record L5 0 "resp=$FOREIGN_RESP foreign_vol=$FOREIGN_OK container=$(container_exists && echo yes || echo no)"
fi

# L6 — final release with keep_volume=false tears down container AND volume.
req "{\"sandbox_ref\":\"$REF\",\"keep_volume\":false}" /v1/sandboxes/release >/dev/null
sleep 1
if ! container_exists && ! owned_volume_exists; then
  record L6 1 "container and owned volume removed"
else
  record L6 0 "container=$(container_exists && echo yes || echo no) volume=$(owned_volume_exists && echo yes || echo no)"
fi

# ── Report ────────────────────────────────────────────────────────────────
mkdir -p "$REPORT_DIR"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_REV="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
{
  printf '{\n'
  printf '  "plan": "WE-20261104",\n'
  printf '  "slice": "WE-S5",\n'
  printf '  "gate": "workspace-volume-lifecycle",\n'
  printf '  "ran_at": "%s",\n' "$TS"
  printf '  "source_commit": "%s",\n' "$GIT_REV"
  printf '  "image_id": "%s",\n' "$IMAGE_ID"
  printf '  "pass": %d,\n' "$PASS_COUNT"
  printf '  "fail": %d,\n' "$FAIL_COUNT"
  printf '  "results": [\n'
  total=${#RESULTS[@]}
  for i in "${!RESULTS[@]}"; do
    IFS='|' read -r id pass evidence <<<"${RESULTS[$i]}"
    [[ $pass == 1 ]] && ok=true || ok=false
    esc_ev="$(printf '%s' "$evidence" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    comma=","
    [[ $i -eq $((total - 1)) ]] && comma=""
    printf '    {"id":"%s","pass":%s,"evidence":"%s"}%s\n' "$id" "$ok" "$esc_ev" "$comma"
  done
  printf '  ]\n}\n'
} > "$REPORT"

log "report: $REPORT"
printf 'PASS=%d FAIL=%d\n' "$PASS_COUNT" "$FAIL_COUNT"
[[ "$FAIL_COUNT" -eq 0 ]]
