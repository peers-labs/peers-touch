#!/usr/bin/env bash
#
# WE-20261104 / WE-S6 — real-container interactive PTY gates.
#
# Drives the provisioner PTY HTTP API against a REAL sandbox container and
# asserts the same contract the Desktop Rust worker honors (TW-D5), but with
# Station/provisioner owning the process:
#
#   P1 open a TTY shell (hijacked Docker Engine stream) -> running
#   P2 keystrokes round-trip: echo output appears in bounded scrollback
#   P3 cursor replay is monotonic (next_cursor advances)
#   P4 resize accepted
#   P5 `exit` -> honest EXITED status
#   P6 a long-running PTY gets SIGKILLed via its process group -> KILLED
#   P7 a second PTY in the same container survives the first being killed
#
# Report: tooling/acceptance/reports/task-workbench/we-s6-pty-gates.json
# Usage:  bash tooling/acceptance/closures/we-s6/pty-gates.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
NET="wbox-isolated"
PROV="we-s6-provisioner"
REF="we-s6-box"
BASE_TAG="peers/workspace-sandbox-base:24.04-1"
PROV_TAG="peers/workspace-sandbox-provisioner:dev"
REPORT_DIR="$ROOT/tooling/acceptance/reports/task-workbench"
REPORT="$REPORT_DIR/we-s6-pty-gates.json"

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()
log() { printf '\033[36m[we-s6]\033[0m %s\n' "$*"; }
record() {
  local id="$1" pass="$2" evidence="$3"
  RESULTS+=("$id|$pass|$evidence")
  if [[ "$pass" == 1 ]]; then PASS_COUNT=$((PASS_COUNT+1)); printf '\033[32mPASS\033[0m %s — %s\n' "$id" "$evidence"
  else FAIL_COUNT=$((FAIL_COUNT+1)); printf '\033[31mFAIL\033[0m %s — %s\n' "$id" "$evidence"; fi
}
cleanup() {
  docker rm -f "$PROV" "wbox-$REF" >/dev/null 2>&1 || true
  docker volume rm "wbox-vol-$REF" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "building images"
docker build -q -t "$BASE_TAG" -f "$ROOT/tooling/docker/sandbox/sandbox-base.Dockerfile" \
  --build-arg APT_MIRROR=mirrors.aliyun.com "$ROOT" >/dev/null
IMAGE_ID="$(docker inspect -f '{{.Id}}' "$BASE_TAG")"
docker build -q -t "$PROV_TAG" -f "$ROOT/tooling/docker/sandbox/provisioner.Dockerfile" "$ROOT" >/dev/null
docker network inspect "$NET" >/dev/null 2>&1 || docker network create --internal "$NET" >/dev/null
cleanup
docker run -d --name "$PROV" -v /var/run/docker.sock:/var/run/docker.sock \
  -e "SANDBOX_ALLOWED_IMAGE_IDS=$IMAGE_ID" -e "SANDBOX_ISOLATED_NETWORK=$NET" \
  --network "$NET" "$PROV_TAG" >/dev/null
sleep 2

call() { docker exec "$PROV" wget -q --content-on-error -O- --post-data="$1" \
  --header='Content-Type: application/json' "http://127.0.0.1:8090$2"; }
jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
b64d() { python3 -c "import sys,base64;print(base64.b64decode(sys.stdin.read()).decode('utf-8','replace'))"; }

call "{\"sandbox_ref\":\"$REF\",\"image_ref\":\"$IMAGE_ID\"}" /v1/sandboxes/allocate >/dev/null

# P1 open
OPEN="$(call '{"sandbox_ref":"'$REF'","pty_id":"t1","command":"sh","args":[],"cols":80,"rows":24}' /v1/ptys/open)"
if grep -q pty_id <<<"$OPEN"; then record P1 1 "pty opened"; else record P1 0 "$OPEN"; fi

# P2 write echo and read
write_pty() { call "{\"sandbox_ref\":\"$REF\",\"pty_id\":\"$1\",\"data_b64\":\"$2\"}" /v1/ptys/write >/dev/null; }
write_pty t1 "$(printf 'echo PTY-$((2*21))\n' | base64)"
sleep 1
READ="$(call '{"sandbox_ref":"'$REF'","pty_id":"t1","cursor":0,"max_bytes":8192}' /v1/ptys/read)"
SCREEN="$(printf '%s' "$READ" | jget "['data_b64']" | base64 -d 2>/dev/null)"
if grep -q "PTY-42" <<<"$SCREEN"; then record P2 1 "interactive echo rendered"; else record P2 0 "$SCREEN"; fi

# P3 monotonic cursor
CUR="$(printf '%s' "$READ" | jget "['next_cursor']")"
if [[ "$CUR" =~ ^[0-9]+$ ]] && [ "$CUR" -gt 0 ]; then record P3 1 "next_cursor=$CUR"; else record P3 0 "cursor=$CUR"; fi

# P4 resize
RSZ="$(call '{"sandbox_ref":"'$REF'","pty_id":"t1","cols":120,"rows":40}' /v1/ptys/resize)"
grep -q resized <<<"$RSZ" && record P4 1 "resized 120x40" || record P4 0 "$RSZ"

# P5 exit -> exited
write_pty t1 "$(printf 'exit\n' | base64)"
sleep 1
EXIT_READ="$(call '{"sandbox_ref":"'$REF'","pty_id":"t1","cursor":'$CUR',"max_bytes":8192}' /v1/ptys/read)"
STATE="$(printf '%s' "$EXIT_READ" | jget "['state']")"
[ "$STATE" = "exited" ] && record P5 1 "state=exited" || record P5 0 "state=$STATE"

# P6 SIGKILL a long-running pty
call '{"sandbox_ref":"'$REF'","pty_id":"t2","command":"sleep","args":["600"],"cols":80,"rows":24}' /v1/ptys/open >/dev/null
sleep 1
call '{"sandbox_ref":"'$REF'","pty_id":"t2","signal":9}' /v1/ptys/signal >/dev/null
sleep 1
KILL_READ="$(call '{"sandbox_ref":"'$REF'","pty_id":"t2","cursor":0,"max_bytes":256}' /v1/ptys/read)"
KSTATE="$(printf '%s' "$KILL_READ" | jget "['state']")"
[ "$KSTATE" = "killed" ] && record P6 1 "state=killed" || record P6 0 "state=$KSTATE"

# P7 independent pty still usable after killing t2
call '{"sandbox_ref":"'$REF'","pty_id":"t3","command":"sh","args":[]}' /v1/ptys/open >/dev/null
write_pty t3 "$(printf 'echo ALIVE\n' | base64)"
sleep 1
T3="$(call '{"sandbox_ref":"'$REF'","pty_id":"t3","cursor":0,"max_bytes":8192}' /v1/ptys/read)"
T3SCREEN="$(printf '%s' "$T3" | jget "['data_b64']" | base64 -d 2>/dev/null)"
grep -q ALIVE <<<"$T3SCREEN" && record P7 1 "peer pty unaffected" || record P7 0 "$T3SCREEN"

mkdir -p "$REPORT_DIR"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_REV="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
{
  printf '{\n  "plan": "WE-20261104",\n  "slice": "WE-S6",\n'
  printf '  "gate": "workspace-sandbox-pty",\n  "ran_at": "%s",\n  "source_commit": "%s",\n' "$TS" "$GIT_REV"
  printf '  "image_id": "%s",\n  "pass": %d,\n  "fail": %d,\n  "results": [\n' "$IMAGE_ID" "$PASS_COUNT" "$FAIL_COUNT"
  total=${#RESULTS[@]}
  for i in "${!RESULTS[@]}"; do
    IFS='|' read -r id pass evidence <<<"${RESULTS[$i]}"
    [[ $pass == 1 ]] && ok=true || ok=false
    esc="$(printf '%s' "$evidence" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')"
    comma=","; [[ $i -eq $((total-1)) ]] && comma=""
    printf '    {"id":"%s","pass":%s,"evidence":"%s"}%s\n' "$id" "$ok" "$esc" "$comma"
  done
  printf '  ]\n}\n'
} > "$REPORT"
log "report: $REPORT"
printf 'PASS=%d FAIL=%d\n' "$PASS_COUNT" "$FAIL_COUNT"
[[ "$FAIL_COUNT" -eq 0 ]]
