#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${PT_C6_TOPOLOGY_PATH:?PT_C6_TOPOLOGY_PATH is required}"
: "${PT_C6_REPORT_DRAFT_PATH:?PT_C6_REPORT_DRAFT_PATH is required}"
BASE_PORT="${PT_C6_GATEWAY_BASE_PORT:-3340}"
DEPLOYED_COMMIT="${PT_C6_DEPLOYED_COMMIT:-be75f3789bf0}"
RUN_ID="$(date +%s)"
ARTIFACT="$ROOT/apps/desktop/src-tauri/target/debug/peers-touch-desktop"
CONTROL_DIR="${TMPDIR:-/tmp}/pt-c6-control-${RUN_ID}"
SUPERVISOR_PIDS=()

cleanup() {
  touch "$CONTROL_DIR/shutdown" >/dev/null 2>&1 || true
  for pid in "${SUPERVISOR_PIDS[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  for pid in "${SUPERVISOR_PIDS[@]:-}"; do
    wait "$pid" >/dev/null 2>&1 || true
  done
  if [[ "${PT_C6_KEEP_CONTROL_DIR:-0}" == "1" ]]; then
    echo "C6 control directory preserved at $CONTROL_DIR" >&2
  else
    rm -rf "$CONTROL_DIR"
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$CONTROL_DIR"

verify_station_commit() {
  local name="$1"
  local station="$2"
  local actual
  actual="$(
    curl -fsS "${station}/app-meta/version" |
      jq -er '.build_commit'
  )"
  if [[ "$actual" != "$DEPLOYED_COMMIT"* ]]; then
    echo \
      "C6 Station ${name} runs ${actual}, expected ${DEPLOYED_COMMIT}" \
      >&2
    exit 1
  fi
}

verify_station_commit one "http://10.37.246.80:18080"
verify_station_commit two "http://10.37.118.48:18080"
verify_station_commit three "http://10.37.94.156:18080"

for offset in 0 1 2 3; do
  port=$((BASE_PORT + offset))
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "C6 gateway port $port is already in use" >&2
    exit 1
  fi
done

(
  cd "$ROOT/apps/desktop/src-tauri"
  cargo build --bin peers-touch-desktop
)

gateway_supervisor() {
  local port="$1"
  local profile="$2"
  local station="$3"
  local name="$4"
  local child=""

  stop_child() {
    if [[ -n "$child" ]] && kill -0 "$child" >/dev/null 2>&1; then
      kill "$child" >/dev/null 2>&1 || true
      wait "$child" >/dev/null 2>&1 || true
    fi
    child=""
    rm -f "$CONTROL_DIR/${name}.pid"
  }
  start_child() {
    PT_GATEWAY_PORT="$port" \
    PT_PROFILE="$profile" \
    PEERS_STATION_URL="$station" \
    PEERS_STORAGE_ROOT="$CONTROL_DIR/storage-${name}" \
      "$ARTIFACT" >"/tmp/${profile}.log" 2>&1 &
    child="$!"
    printf '%s\n' "$child" >"$CONTROL_DIR/${name}.pid"
    for _ in $(seq 1 60); do
      if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        return 0
      fi
      if ! kill -0 "$child" >/dev/null 2>&1; then
        return 1
      fi
      sleep 0.25
    done
    return 1
  }

  trap stop_child EXIT INT TERM
  start_child
  while [[ ! -f "$CONTROL_DIR/shutdown" ]]; do
    if [[ -f "$CONTROL_DIR/${name}.stop.request" ]]; then
      stop_child
      rm -f "$CONTROL_DIR/${name}.stop.request"
      touch "$CONTROL_DIR/${name}.stop.done"
    fi
    if [[ -f "$CONTROL_DIR/${name}.start.request" ]]; then
      if [[ -z "$child" ]]; then
        start_child
      fi
      rm -f "$CONTROL_DIR/${name}.start.request"
      touch "$CONTROL_DIR/${name}.start.done"
    fi
    if [[ -f "$CONTROL_DIR/${name}.restart.request" ]]; then
      stop_child
      start_child
      rm -f "$CONTROL_DIR/${name}.restart.request"
      touch "$CONTROL_DIR/${name}.restart.done"
    fi
    if [[ -n "$child" ]] && ! kill -0 "$child" >/dev/null 2>&1; then
      echo "C6 gateway ${name} exited unexpectedly" >&2
      exit 1
    fi
    sleep 0.2
  done
}

station_three_supervisor() {
  while [[ ! -f "$CONTROL_DIR/shutdown" ]]; do
    if [[ -f "$CONTROL_DIR/station-three.restart.request" ]]; then
      ssh \
        -o BatchMode=yes \
        -o ConnectTimeout=10 \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        shuxian@10.37.94.156 \
        "docker restart pt-station-a-station-1" >/dev/null
      for _ in $(seq 1 120); do
        actual="$(
          curl -fsS "http://10.37.94.156:18080/app-meta/version" 2>/dev/null |
            jq -er '.build_commit' 2>/dev/null ||
            true
        )"
        if [[ "$actual" == "$DEPLOYED_COMMIT"* ]]; then
          rm -f "$CONTROL_DIR/station-three.restart.request"
          touch "$CONTROL_DIR/station-three.restart.done"
          break
        fi
        sleep 0.5
      done
    fi
    sleep 0.2
  done
}

gateway_supervisor \
  "$BASE_PORT" \
  "c6-${RUN_ID}-one" \
  "http://10.37.246.80:18080" \
  "alice" &
SUPERVISOR_PIDS+=("$!")
gateway_supervisor \
  "$((BASE_PORT + 1))" \
  "c6-${RUN_ID}-two" \
  "http://10.37.118.48:18080" \
  "bob" &
SUPERVISOR_PIDS+=("$!")
gateway_supervisor \
  "$((BASE_PORT + 2))" \
  "c6-${RUN_ID}-three" \
  "http://10.37.94.156:18080" \
  "charlie" &
SUPERVISOR_PIDS+=("$!")
gateway_supervisor \
  "$((BASE_PORT + 3))" \
  "c6-${RUN_ID}-two-bob2" \
  "http://10.37.118.48:18080" \
  "bob2" &
SUPERVISOR_PIDS+=("$!")
station_three_supervisor &
SUPERVISOR_PIDS+=("$!")

for offset in 0 1 2 3; do
  port=$((BASE_PORT + offset))
  ready=false
  for _ in $(seq 1 30); do
    if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    echo "C6 gateway on port $port did not start" >&2
    exit 1
  fi
done

(
  cd "$ROOT/apps/desktop"
  PT_C6_MLS_E2E=1 \
  PT_C6_DEPLOYED_COMMIT="$DEPLOYED_COMMIT" \
  PT_C6_GATEWAY_ONE="http://127.0.0.1:${BASE_PORT}" \
  PT_C6_GATEWAY_TWO="http://127.0.0.1:$((BASE_PORT + 1))" \
  PT_C6_GATEWAY_THREE="http://127.0.0.1:$((BASE_PORT + 2))" \
  PT_C6_GATEWAY_BOB2="http://127.0.0.1:$((BASE_PORT + 3))" \
  PT_C6_CONTROL_DIR="$CONTROL_DIR" \
  PT_C6_TOPOLOGY_PATH="$PT_C6_TOPOLOGY_PATH" \
  PT_C6_REPORT_DRAFT_PATH="$PT_C6_REPORT_DRAFT_PATH" \
    pnpm exec vitest run \
      src/services/im-service.three-station.e2e.test.ts \
      --reporter=verbose
)

REPORT="$PT_C6_REPORT_DRAFT_PATH"
CONVERSATION_ID="$(jq -er '.conversation_id' "$REPORT")"

collect_station_head() {
  local host="$1"
  local db_container="$2"
  local source="$3"
  local sql
  if [[ "$source" == "authority" ]]; then
    sql="SELECT json_build_object(
      'source','authority',
      'conversation_id',c.conversation_id,
      'federation_id',c.federation_id,
      'authority_station_peer_id',c.authority_station_peer_id,
      'authority_epoch',c.authority_epoch,
      'group_seq',e.group_seq,
      'event_hash',encode(e.event_hash,'hex'),
      'membership_epoch',e.membership_epoch,
      'mls_epoch',e.mls_epoch,
      'transition_id',COALESCE(e.transition_id,''),
      'commit_sha256',encode(e.commit_sha256,'hex'),
      'status','active'
    )::text
    FROM conversations c
    JOIN LATERAL (
      SELECT *
      FROM conversation_events
      WHERE conversation_id=c.conversation_id
      ORDER BY group_seq DESC
      LIMIT 1
    ) e ON true
    WHERE c.conversation_id='${CONVERSATION_ID}';"
  else
    sql="SELECT json_build_object(
      'source','follower',
      'conversation_id',conversation_id,
      'federation_id',federation_id,
      'authority_station_peer_id',authority_station_peer_id,
      'authority_epoch',authority_epoch,
      'group_seq',group_seq,
      'event_hash',encode(event_hash,'hex'),
      'membership_epoch',membership_epoch,
      'mls_epoch',mls_epoch,
      'transition_id',transition_id,
      'commit_sha256',encode(commit_sha256,'hex'),
      'status',status
    )::text
    FROM conversation_follower_heads
    WHERE conversation_id='${CONVERSATION_ID}';"
  fi
  ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "shuxian@${host}" \
    "db=\$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' '${db_container}' | sed -n 's/^POSTGRES_DB=//p'); \
     user=\$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' '${db_container}' | sed -n 's/^POSTGRES_USER=//p'); \
     docker exec '${db_container}' psql -U \"\$user\" -d \"\$db\" -Atc \"${sql}\""
}

ONE_HEAD="$(
  collect_station_head \
    "10.37.246.80" \
    "pt-station-c-postgres-1" \
    "authority"
)"
TWO_HEAD="$(
  collect_station_head \
    "10.37.118.48" \
    "pt-station-two-postgres-1" \
    "follower"
)"
THREE_HEAD="$(
  collect_station_head \
    "10.37.94.156" \
    "pt-station-a-postgres-1" \
    "follower"
)"

STATION_HEADS="$(
  jq -n \
    --argjson one "$ONE_HEAD" \
    --argjson two "$TWO_HEAD" \
    --argjson three "$THREE_HEAD" \
    '{one:$one,two:$two,three:$three}'
)"
jq -e '
  .one.group_seq == .two.group_seq and
  .one.group_seq == .three.group_seq and
  .one.event_hash == .two.event_hash and
  .one.event_hash == .three.event_hash and
  .one.membership_epoch == .two.membership_epoch and
  .one.membership_epoch == .three.membership_epoch and
  .one.mls_epoch == .two.mls_epoch and
  .one.mls_epoch == .three.mls_epoch and
  .one.transition_id == .two.transition_id and
  .one.transition_id == .three.transition_id and
  .one.commit_sha256 == .two.commit_sha256 and
  .one.commit_sha256 == .three.commit_sha256
' <<<"$STATION_HEADS" >/dev/null

REPORT_TMP="$(mktemp "${TMPDIR:-/tmp}/pt-c6-report.XXXXXX")"
jq \
  --argjson station_heads "$STATION_HEADS" \
  '.station_public_heads = $station_heads' \
  "$REPORT" >"$REPORT_TMP"
mv "$REPORT_TMP" "$REPORT"

jq -e \
  --arg deployed_commit "$DEPLOYED_COMMIT" '
  .status == "pass" and
  (.deployed_commit | startswith($deployed_commit)) and
  .access_tokens_present == false and
  .remote_ordinary_send.status == "pass" and
  .remote_ordinary_send.recipient_decrypt == true and
  .fault_schedule.disconnected_recipient_before_add == true and
  .fault_schedule.durable_inbox_reconnect == true and
  .fault_schedule.recipient_delivery_reordered == true and
  .fault_schedule.partial_ack_replayed == true and
  .fault_schedule.duplicate_delivery_noop == true and
  .fault_schedule.duplicate_remote_proposal_exact_replay == true and
  .fault_schedule.desktop_gateway_restart_epoch == 3 and
  .fault_schedule.follower_station_restart_before_epoch == 4 and
  .fault_schedule.follower_post_restart_epoch == 4
' "$REPORT" >/dev/null

if rg -ni \
  'Bearer |eyJ[a-zA-Z0-9_-]{20,}|password|private[_-]?key|opaque_mls|session_state|provider_pool' \
  "$REPORT"; then
  echo "C6 report contains a forbidden secret/private-state marker" >&2
  exit 1
fi
