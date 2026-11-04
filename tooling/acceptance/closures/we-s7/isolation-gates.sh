#!/usr/bin/env bash
#
# WE-20261104 / WE-S7 — real-container isolation gates for WORKSPACE_SANDBOX.
#
# Stands up the independent workspace-sandbox-provisioner against the local
# Docker daemon, attaches workloads only to the internal wbox-isolated
# network, and asserts the fail-closed isolation contract with REAL
# containers (no mocks):
#
#   G1  provisioner health reports oci_linux available
#   G2  mutable/unpinned image is rejected before any run
#   G3  pinned content-id image allocates a running sibling container
#   G4  workload runs as the fixed non-root uid 10001
#   G5  root filesystem is read-only (touch / -> EROFS, non-zero)
#   G6  the /workspace volume is writable and readable
#   G7  sandbox attaches ONLY to wbox-isolated
#   G8  external egress is blocked (internal network)
#   G9  two sandboxes cannot reach each other
#   G10 docker drops ALL caps, no-new-privileges, read-only rootfs
#   G11 DORMANT -> cold-start retains the workspace volume
#
# Output: a JSON evidence report under
#   tooling/acceptance/reports/task-workbench/we-s7-isolation-gates.json
#
# Usage:  bash tooling/acceptance/closures/we-s7/isolation-gates.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
NET="wbox-isolated"
MGMT="wbox-mgmt"
PROV="we-s7-provisioner"
REF_A="we-s7-a"
REF_B="we-s7-b"
BASE_TAG="peers/workspace-sandbox-base:24.04-1"
PROV_TAG="peers/workspace-sandbox-provisioner:dev"
REPORT_DIR="$ROOT/tooling/acceptance/reports/task-workbench"
REPORT="$REPORT_DIR/we-s7-isolation-gates.json"

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

c_b64() { base64 -d 2>/dev/null || true; }

log() { printf '\033[36m[we-s7]\033[0m %s\n' "$*"; }
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
  docker rm -f "$PROV" "wbox-$REF_A" "wbox-$REF_B" >/dev/null 2>&1 || true
  docker volume rm "wbox-vol-$REF_A" "wbox-vol-$REF_B" >/dev/null 2>&1 || true
  docker network rm "$MGMT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── Images ──────────────────────────────────────────────────────────────
log "building base + provisioner images (this is a content-id-pinned build)"
docker build -q -t "$BASE_TAG" \
  -f "$ROOT/tooling/docker/sandbox/sandbox-base.Dockerfile" \
  --build-arg APT_MIRROR=mirrors.aliyun.com "$ROOT" >/dev/null
IMAGE_ID="$(docker inspect -f '{{.Id}}' "$BASE_TAG")"
log "base image pinned id: $IMAGE_ID"
docker build -q -t "$PROV_TAG" \
  -f "$ROOT/tooling/docker/sandbox/provisioner.Dockerfile" "$ROOT" >/dev/null

# ── Networks + provisioner ────────────────────────────────────────────────
# Workloads attach only to the INTERNAL wbox-isolated network. The provisioner
# lives on a separate management network and is deliberately NOT a member of
# wbox-isolated, so a compromised sandbox cannot reach its control API. It
# places containers via the daemon socket, which does not require membership.
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
# Recreate the internal workload network if an earlier (pre-fix) run left the
# provisioner attached; a fresh dedicated network guarantees clean topology.

# req <json> <path> ; prints raw body (works for non-2xx via --content-on-error)
req() { docker exec "$PROV" wget -q --content-on-error -O- \
  --post-data="$1" --header='Content-Type: application/json' \
  "http://127.0.0.1:8090$2"; }
alloc() { req "{\"sandbox_ref\":\"$1\",\"image_ref\":\"$IMAGE_ID\"}" /v1/sandboxes/allocate; }
exec_raw() { req "$2" "/v1/sandboxes/exec"; } # exec_raw <ref> <full-json>
stdout_of() { printf '%s' "$1" | sed -n 's/.*"stdout":"\([^"]*\)".*/\1/p' | c_b64; }
errno_of()  { printf '%s' "$1" | sed -n 's/.*"os_errno":"\([^"]*\)".*/\1/p'; }
exit_of()   { printf '%s' "$1" | sed -n 's/.*"exit_code":\([0-9-]*\).*/\1/p'; }

# G1
HEALTH="$(docker exec "$PROV" wget -qO- http://127.0.0.1:8090/healthz)"
if printf '%s' "$HEALTH" | grep -q '"available":true'; then
  record G1 1 "$HEALTH"
else
  record G1 0 "$HEALTH"
fi

# G2 — mutable tag must be rejected without a container appearing.
MUTABLE="$(req "{\"sandbox_ref\":\"we-s7-badtag\",\"image_ref\":\"$BASE_TAG\"}" /v1/sandboxes/allocate)"
if printf '%s' "$MUTABLE" | grep -qi 'policy rejected' && \
   ! docker inspect "wbox-we-s7-badtag" >/dev/null 2>&1; then
  record G2 1 "mutable tag rejected, no container created"
else
  record G2 0 "$MUTABLE"
fi

# G3
ALLOC_A="$(alloc "$REF_A")"
sleep 1
RUN_A="$(docker inspect -f '{{.State.Running}}' "wbox-$REF_A" 2>/dev/null || echo false)"
if printf '%s' "$ALLOC_A" | grep -q "\"Container\":\"wbox-$REF_A\"" && [[ "$RUN_A" == "true" ]]; then
  record G3 1 "allocated and running"
else
  record G3 0 "$ALLOC_A (running=$RUN_A)"
fi

# G4 — non-root uid
ID_OUT="$(exec_raw "$REF_A" "{\"sandbox_ref\":\"$REF_A\",\"command\":\"id\",\"args\":[\"-u\"]}")"
UID_VAL="$(stdout_of "$ID_OUT" | tr -d '[:space:]')"
[[ "$UID_VAL" == "10001" ]] && record G4 1 "uid=$UID_VAL" || record G4 0 "uid=$UID_VAL ($ID_OUT)"

# G5 — read-only rootfs
RO_OUT="$(exec_raw "$REF_A" "{\"sandbox_ref\":\"$REF_A\",\"command\":\"touch\",\"args\":[\"/should-fail\"]}")"
if [[ "$(exit_of "$RO_OUT")" != "0" ]] && [[ "$(errno_of "$RO_OUT")" == "EROFS" ]]; then
  record G5 1 "exit=$(exit_of "$RO_OUT") errno=EROFS"
else
  record G5 0 "$RO_OUT"
fi

# G6 — workspace volume writable + readable
WS_OUT="$(exec_raw "$REF_A" "{\"sandbox_ref\":\"$REF_A\",\"command\":\"sh\",\"args\":[\"-c\",\"echo we-s7-persist > /workspace/p.txt && cat /workspace/p.txt\"]}")"
WS_TXT="$(stdout_of "$WS_OUT" | tr -d '[:space:]')"
[[ "$WS_TXT" == "we-s7-persist" ]] && record G6 1 "wrote+read /workspace/p.txt" || record G6 0 "$WS_TXT ($WS_OUT)"

# G7 — only wbox-isolated attached
NETS="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "wbox-$REF_A" | xargs)"
[[ "$NETS" == "$NET" ]] && record G7 1 "networks=[$NETS]" || record G7 0 "networks=[$NETS]"

# G8 — external egress blocked (internal network)
EG_OUT="$(exec_raw "$REF_A" "{\"sandbox_ref\":\"$REF_A\",\"command\":\"bash\",\"args\":[\"-c\",\"echo > /dev/tcp/1.1.1.1/53 && echo OPEN || echo BLOCKED\"]}")"
EG_TXT="$(stdout_of "$EG_OUT" | tr -d '[:space:]')"
[[ "$EG_TXT" == "BLOCKED" ]] && record G8 1 "external egress blocked" || record G8 0 "result=$EG_TXT"

# G9 — cross-sandbox traffic refused
alloc "$REF_B" >/dev/null; sleep 1
IP_A="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "wbox-$REF_A")"
X_OUT="$(exec_raw "$REF_B" "{\"sandbox_ref\":\"$REF_B\",\"command\":\"bash\",\"args\":[\"-c\",\"echo > /dev/tcp/$IP_A/80 && echo REACHABLE || echo ISOLATED\"]}")"
X_TXT="$(stdout_of "$X_OUT" | tr -d '[:space:]')"
[[ "$X_TXT" == "ISOLATED" ]] && record G9 1 "peer $IP_A unreachable" || record G9 0 "result=$X_TXT"

# G10 — native primitives on the container host config
CAPDROP="$(docker inspect -f '{{.HostConfig.CapDrop}}' "wbox-$REF_A")"
READONLY="$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "wbox-$REF_A")"
NNP="$(docker inspect -f '{{join .HostConfig.SecurityOpt ","}}' "wbox-$REF_A")"
if [[ "$CAPDROP" == "[all]" || "$CAPDROP" == "[ALL]" ]] && \
   [[ "$READONLY" == "true" ]] && grep -q no-new-privileges <<<"$NNP"; then
  record G10 1 "CapDrop=$CAPDROP Readonly=$READONLY SecOpt=$NNP"
else
  record G10 0 "CapDrop=$CAPDROP Readonly=$READONLY SecOpt=$NNP"
fi

# G11 — DORMANT then cold-start retains volume contents
req "{\"sandbox_ref\":\"$REF_A\"}" /v1/sandboxes/dormant >/dev/null
sleep 1
PARKED="$(docker inspect -f '{{.State.Running}}' "wbox-$REF_A")"
alloc "$REF_A" >/dev/null  # cold-start path (docker start, volume retained)
sleep 1
RESTARTED="$(docker inspect -f '{{.State.Running}}' "wbox-$REF_A")"
PERSIST="$(exec_raw "$REF_A" "{\"sandbox_ref\":\"$REF_A\",\"command\":\"cat\",\"args\":[\"/workspace/p.txt\"]}")"
PERSIST_TXT="$(stdout_of "$PERSIST" | tr -d '[:space:]')"
if [[ "$PARKED" == "false" && "$RESTARTED" == "true" && "$PERSIST_TXT" == "we-s7-persist" ]]; then
  record G11 1 "stopped->cold-started, file survived"
else
  record G11 0 "parked=$PARKED restarted=$RESTARTED file=$PERSIST_TXT"
fi

# G12 — control-plane isolation: a workload on wbox-isolated must NOT be able
# to reach the provisioner API (which lives on the management network), while
# a peer on the management network CAN (proving the denial is network
# placement, not a dead API).
PROV_MGMT_IP="$(docker inspect -f '{{(index .NetworkSettings.Networks "wbox-mgmt").IPAddress}}' "$PROV")"
if [[ -z "$PROV_MGMT_IP" ]]; then
  record G12 0 "could not resolve provisioner mgmt IP"
else
  CP_OUT="$(exec_raw "$REF_A" "{\"sandbox_ref\":\"$REF_A\",\"command\":\"curl\",\"args\":[\"-sS\",\"-m\",\"3\",\"-o\",\"/dev/null\",\"-w\",\"%{http_code}\",\"http://$PROV_MGMT_IP:8090/healthz\"]}")"
  CP_CODE="$(stdout_of "$CP_OUT" | tr -d '[:space:]')"
  CP_EXIT="$(exit_of "$CP_OUT")"
  POSITIVE="$(docker run --rm --network "$MGMT" --entrypoint wget "$PROV_TAG" -qO- -T4 "http://$PROV:8090/healthz" 2>/dev/null)"
  if [[ "$CP_CODE" == "000" || -z "$CP_CODE" ]] && [[ "$CP_EXIT" != "0" ]] && grep -q '"available":true' <<<"$POSITIVE"; then
    record G12 1 "mgmt reachable, sandbox blocked (curl exit=$CP_EXIT)"
  else
    record G12 0 "sandbox code=$CP_CODE exit=$CP_EXIT mgmt-positive=${POSITIVE:-none}"
  fi
fi

# ── Report ────────────────────────────────────────────────────────────────
mkdir -p "$REPORT_DIR"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_REV="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
{
  printf '{\n'
  printf '  "plan": "WE-20261104",\n'
  printf '  "slice": "WE-S7",\n'
  printf '  "gate": "workspace-sandbox-isolation",\n'
  printf '  "ran_at": "%s",\n' "$TS"
  printf '  "source_commit": "%s",\n' "$GIT_REV"
  printf '  "image_id": "%s",\n' "$IMAGE_ID"
  printf '  "network": "%s",\n' "$NET"
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
