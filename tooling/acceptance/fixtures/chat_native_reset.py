#!/usr/bin/env python3
"""Reset disposable native Chat acceptance state while preserving actor identities."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import urllib.parse
import urllib.request


REPO_ROOT = Path(__file__).resolve().parents[3]
PROFILE_THREE_ENVIRONMENT = "station-three"
PROFILE_THREE_STATION_CONTAINER = "pt-station-a-station-1"
CHAT_TABLES = (
    "actor_devices",
    "actor_identity_keys",
    "actor_sessions",
    "device_queue_items",
    "device_queue_lanes",
    "federated_endpoint_manifests",
    "messaging_attachment_audit",
    "messaging_attachment_grants",
    "messaging_attachment_objects",
    "messaging_attachment_upload_parts",
    "messaging_attachment_uploads",
    "messaging_authority_plans",
    "messaging_command_receipts",
    "messaging_conversation_member_devices",
    "messaging_conversation_members",
    "messaging_conversations",
    "messaging_endpoint_directory_versions",
    "messaging_events",
    "messaging_federation_inbox",
    "messaging_federation_outbox",
    "messaging_read_cursors",
    "messaging_recovery_revisions",
    "mls_key_packages",
    "federated_mls_key_package_claims",
)


def deploy_environment(name: str) -> dict[str, str]:
    path = REPO_ROOT / ".local" / "deploy" / "envs" / f"{name}.env"
    if not path.exists():
        raise RuntimeError(f"deployment environment not found: {path}")
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def profile_three_environment(station_url: str) -> dict[str, str]:
    environment = deploy_environment(PROFILE_THREE_ENVIRONMENT)
    host = environment.get("PT_DEPLOY_HOST", "").strip()
    parsed_url = urllib.parse.urlparse(station_url)
    if (
        parsed_url.scheme not in {"http", "https"}
        or parsed_url.hostname != host
        or parsed_url.port != 18080
        or parsed_url.path not in {"", "/"}
        or parsed_url.params
        or parsed_url.query
        or parsed_url.fragment
    ):
        raise RuntimeError(
            "Profile Three target mismatch: "
            f"station_url={station_url} deploy_host={host or 'missing'}"
        )
    return environment


def _commits_match(left: str, right: str) -> bool:
    return bool(left and right) and (left.startswith(right) or right.startswith(left))


def _station_version(station_url: str) -> dict[str, object]:
    with urllib.request.urlopen(
        f"{station_url.rstrip('/')}/app-meta/version",
        timeout=5,
    ) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError("Profile Three Station version response is invalid")
    return value


def _remote_command(environment: dict[str, str], command: str) -> str:
    host = environment.get("PT_DEPLOY_HOST", "").strip()
    user = environment.get("PT_DEPLOY_USER", "").strip()
    if not host or not user:
        raise RuntimeError(
            "station-three must define PT_DEPLOY_HOST and PT_DEPLOY_USER"
        )
    result = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "StrictHostKeyChecking=no",
            f"{user}@{host}",
            command,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _remote_psql(environment: dict[str, str], sql: str) -> str:
    container = os.environ.get(
        "CHAT_ACCEPTANCE_POSTGRES_CONTAINER",
        "pt-station-a-postgres-1",
    ).strip()
    if container != "pt-station-a-postgres-1":
        raise RuntimeError(
            "Profile Three PostgreSQL container must be pt-station-a-postgres-1"
        )
    remote = (
        f"docker exec -i {container} sh -lc "
        "'psql -At -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" "
        "-d \"$POSTGRES_DB\"'"
    )
    host = environment.get("PT_DEPLOY_HOST", "").strip()
    user = environment.get("PT_DEPLOY_USER", "").strip()
    if not host or not user:
        raise RuntimeError(
            "station-three must define PT_DEPLOY_HOST and PT_DEPLOY_USER"
        )
    result = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "StrictHostKeyChecking=no",
            f"{user}@{host}",
            remote,
        ],
        input=sql,
        text=True,
        check=True,
        capture_output=True,
    )
    return result.stdout.strip()


def duplicate_profile_three_queue_delivery(
    station_url: str,
    source_item_id: str,
    recipient_ptid: str,
    recipient_device_id: str,
) -> dict[str, object]:
    if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
        raise RuntimeError(
            "CHAT_ACCEPTANCE_RESET=1 is required for queue replay fault injection"
        )
    if not source_item_id or not recipient_ptid or not recipient_device_id:
        raise RuntimeError("queue replay requires source item and recipient endpoint")

    environment = profile_three_environment(station_url)
    source = _sql_literal(source_item_id)
    ptid = _sql_literal(recipient_ptid)
    device = _sql_literal(recipient_device_id)
    sql = f"""
BEGIN;
DO $acceptance$
DECLARE
  source_row device_queue_items%ROWTYPE;
  lane_row device_queue_lanes%ROWTYPE;
  duplicate_item_id text;
BEGIN
  SELECT * INTO STRICT source_row
  FROM device_queue_items
  WHERE item_id = {source}
    AND recipient_ptid = {ptid}
    AND recipient_device_id = {device}
  FOR UPDATE;
  IF source_row.state <> 5 THEN
    RAISE EXCEPTION 'source queue item is not ACKED';
  END IF;

  SELECT * INTO STRICT lane_row
  FROM device_queue_lanes
  WHERE recipient_ptid = {ptid}
    AND recipient_device_id = {device}
  FOR UPDATE;

  duplicate_item_id := md5(
    source_row.item_id || ':' || clock_timestamp()::text
  );
  INSERT INTO device_queue_items (
    item_id, recipient_ptid, recipient_device_id, lane_sequence,
    idempotency_key, event_id, conversation_id, payload_type,
    opaque_payload, payload_sha256, state, attempt_count,
    lease_consumer_id, lease_consumer_epoch, lease_expires_at,
    first_queued_at, next_attempt_at, expires_at, consumed_at,
    acked_at, last_error_code
  ) VALUES (
    duplicate_item_id, source_row.recipient_ptid,
    source_row.recipient_device_id, lane_row.next_sequence + 1,
    duplicate_item_id, source_row.event_id, source_row.conversation_id,
    source_row.payload_type, source_row.opaque_payload,
    source_row.payload_sha256, 1, 0, '', 0, NULL,
    clock_timestamp(), clock_timestamp(), source_row.expires_at,
    NULL, NULL, 'acceptance_duplicate_delivery'
  );
  UPDATE device_queue_lanes
  SET next_sequence = next_sequence + 1
  WHERE recipient_ptid = {ptid}
    AND recipient_device_id = {device};
END
$acceptance$;
SELECT json_build_object(
  'sourceItemId', source.item_id,
  'duplicateItemId', duplicate.item_id,
  'eventId', duplicate.event_id,
  'laneSequence', duplicate.lane_sequence,
  'payloadSha256', encode(duplicate.payload_sha256, 'hex'),
  'state', duplicate.state
)
FROM device_queue_items source
JOIN device_queue_items duplicate
  ON duplicate.event_id = source.event_id
 AND duplicate.recipient_ptid = source.recipient_ptid
 AND duplicate.recipient_device_id = source.recipient_device_id
 AND duplicate.item_id <> source.item_id
WHERE source.item_id = {source}
ORDER BY duplicate.lane_sequence DESC
LIMIT 1;
COMMIT;
"""
    output = _remote_psql(environment, sql)
    lines = [
        line
        for line in output.splitlines()
        if line.strip().startswith("{")
    ]
    if not lines:
        raise RuntimeError("queue replay fault injection returned no evidence")
    value = json.loads(lines[-1])
    if not isinstance(value, dict):
        raise RuntimeError("queue replay fault injection evidence is invalid")
    return value


def restart_profile_three_station(
    station_url: str,
    expected_commit: str,
) -> dict[str, str]:
    if os.environ.get("CHAT_ACCEPTANCE_ALLOW_STATION_RESTART") != "1":
        raise RuntimeError(
            "CHAT_ACCEPTANCE_ALLOW_STATION_RESTART=1 is required for the "
            "authorized Profile Three restart scenario"
        )

    environment = profile_three_environment(station_url)
    host = environment.get("PT_DEPLOY_HOST", "").strip()

    container = os.environ.get(
        "CHAT_ACCEPTANCE_STATION_CONTAINER",
        PROFILE_THREE_STATION_CONTAINER,
    ).strip()
    if container != PROFILE_THREE_STATION_CONTAINER:
        raise RuntimeError(
            "Profile Three restart container must be "
            f"{PROFILE_THREE_STATION_CONTAINER}"
        )

    before_version = _station_version(station_url)
    before_commit = str(before_version.get("build_commit") or "")
    if not _commits_match(before_commit, expected_commit):
        raise RuntimeError(
            "Profile Three commit mismatch before restart: "
            f"station={before_commit or 'missing'} expected={expected_commit}"
        )
    inspect = f"docker inspect -f '{{{{.State.StartedAt}}}}' {container}"
    before_started_at = _remote_command(environment, inspect)
    if not before_started_at:
        raise RuntimeError("Profile Three Station start timestamp is unavailable")

    restarted_container = _remote_command(environment, f"docker restart {container}")
    if restarted_container != container:
        raise RuntimeError(
            "Profile Three Station restart returned an unexpected container: "
            f"{restarted_container or 'missing'}"
        )

    deadline = time.monotonic() + 180
    last_error = ""
    after_version: dict[str, object] | None = None
    while time.monotonic() < deadline:
        try:
            candidate = _station_version(station_url)
            candidate_commit = str(candidate.get("build_commit") or "")
            if _commits_match(candidate_commit, expected_commit):
                after_version = candidate
                break
            last_error = (
                "Profile Three returned a different commit after restart: "
                f"{candidate_commit or 'missing'}"
            )
        except Exception as error:
            last_error = str(error)
        threading.Event().wait(1)
    if after_version is None:
        raise RuntimeError(
            "Profile Three Station did not recover after restart"
            + (f": {last_error}" if last_error else "")
        )

    after_started_at = _remote_command(environment, inspect)
    if not after_started_at or after_started_at == before_started_at:
        raise RuntimeError(
            "Profile Three Station container start timestamp did not change"
        )
    after_commit = str(after_version.get("build_commit") or "")
    return {
        "environment": PROFILE_THREE_ENVIRONMENT,
        "host": host,
        "container": container,
        "beforeStartedAt": before_started_at,
        "afterStartedAt": after_started_at,
        "beforeCommit": before_commit,
        "afterCommit": after_commit,
    }


def reset_local_client_storage(
    accounts: list[str],
    root: Path | None = None,
) -> int:
    reset = 0
    storage_root = root or (
        REPO_ROOT / ".local" / "acceptance" / "embedded-webdriver"
    )
    for account in accounts:
        if account not in {"alice", "bob", "charlie"}:
            raise RuntimeError(f"unsupported native Chat fixture account: {account}")
        storage = storage_root / account / "storage"
        if storage.exists():
            shutil.rmtree(storage)
            reset += 1
        storage.mkdir(parents=True, exist_ok=True)
    return reset


def reset_station_messaging_state(environment_name: str) -> None:
    if environment_name != PROFILE_THREE_ENVIRONMENT:
        raise RuntimeError(
            "native Chat fixture reset is restricted to station-three"
        )
    environment = deploy_environment(environment_name)
    host = environment.get("PT_DEPLOY_HOST", "").strip()
    user = environment.get("PT_DEPLOY_USER", "").strip()
    if not host or not user:
        raise RuntimeError(
            f"{environment_name} must define PT_DEPLOY_HOST and PT_DEPLOY_USER"
        )
    container = os.environ.get(
        "CHAT_ACCEPTANCE_POSTGRES_CONTAINER", "pt-station-a-postgres-1"
    )
    if container != "pt-station-a-postgres-1":
        raise RuntimeError(
            "Profile Three PostgreSQL container must be pt-station-a-postgres-1"
        )
    sql = f"""
BEGIN;
TRUNCATE TABLE {', '.join(CHAT_TABLES)} CASCADE;
DO $acceptance$
DECLARE
  preset_hash text;
  updated_count integer;
BEGIN
  SELECT password_hash INTO STRICT preset_hash
  FROM touch_actor
  WHERE email = 'alice@p.t';

  UPDATE touch_actor
  SET password_hash = preset_hash
  WHERE email IN ('alice@p.t', 'bob@p.t', 'carol@p.t');
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 3 THEN
    RAISE EXCEPTION 'native Chat preset actor set is incomplete';
  END IF;
END
$acceptance$;
COMMIT;
"""
    remote = (
        f"docker exec -i {container} sh -lc "
        "'psql -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\"'"
    )
    subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "StrictHostKeyChecking=no",
            f"{user}@{host}",
            remote,
        ],
        input=sql,
        text=True,
        check=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", default="station-three")
    parser.add_argument("--accounts", nargs="+", default=["alice", "bob", "charlie"])
    args = parser.parse_args()

    reset_roots = reset_local_client_storage(args.accounts)
    reset_station_messaging_state(args.environment)
    print(
        f"native Chat fixture reset: environment={args.environment} "
        f"local_storage_roots={reset_roots}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
