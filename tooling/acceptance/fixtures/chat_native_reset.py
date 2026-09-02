#!/usr/bin/env python3
"""Reset disposable native Chat acceptance state while preserving actor identities."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import threading
import time
import urllib.parse
import urllib.request

from tooling.acceptance.transports.ssh import SshTarget, SshTransport


REPO_ROOT = Path(__file__).resolve().parents[3]
SAFE_RUNTIME_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")
APPROVED_DISPOSABLE_STATION_PORT = 18132
PROTECTED_CLEANUP_PORTS = frozenset({4445, 18080})
CHAT_TABLES = (
    "actor_devices",
    "actor_identity_keys",
    "actor_sessions",
    "device_queue_items",
    "device_queue_lanes",
    "federated_endpoint_manifests",
    "friend_chat_friend_requests",
    "friend_chat_friendships",
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


def load_environment_file(path: Path) -> dict[str, str]:
    if not path.exists():
        raise RuntimeError(f"environment file not found: {path}")
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def deploy_environment(name: str) -> dict[str, str]:
    return load_environment_file(
        REPO_ROOT / ".local" / "deploy" / "envs" / f"{name}.env"
    )


def active_profile_environment() -> dict[str, str]:
    active_profile = (
        REPO_ROOT
        / ".local"
        / "dev"
        / "active"
        / f"{REPO_ROOT.name}.env"
    )
    return load_environment_file(active_profile)


def active_deployment_environment() -> str:
    profile = active_profile_environment()
    environment_name = profile.get("PT_STATION_DEPLOY_ENV", "").strip()
    if not environment_name:
        raise RuntimeError(
            "active profile must define PT_STATION_DEPLOY_ENV for destructive "
            "Chat Acceptance"
        )
    return environment_name


def active_station_url() -> str:
    station_url = active_profile_environment().get(
        "PT_STATION_URL",
        "",
    ).rstrip("/")
    if not station_url:
        raise RuntimeError(
            "active profile must define PT_STATION_URL for Chat Acceptance"
        )
    return station_url


def acceptance_station_environment(
    station_url: str,
    environment_name: str | None = None,
) -> dict[str, str]:
    selected_environment = environment_name or active_deployment_environment()
    environment = deploy_environment(selected_environment)
    host = environment.get("PT_DEPLOY_HOST", "").strip()
    user = environment.get("PT_DEPLOY_USER", "").strip()
    expected_url = environment.get("PT_ACCEPTANCE_STATION_URL", "").rstrip("/")
    parsed_url = urllib.parse.urlparse(station_url)
    expected = urllib.parse.urlparse(expected_url)
    if parsed_url.port in PROTECTED_CLEANUP_PORTS:
        raise RuntimeError(
            "Disposable Chat Acceptance refuses protected cleanup target port: "
            f"{parsed_url.port}"
        )
    if (
        environment.get("PT_ACCEPTANCE_DISPOSABLE", "").strip() != "1"
        or not host
        or not user
        or not expected_url
        or station_url.rstrip("/") != expected_url
        or parsed_url.scheme not in {"http", "https"}
        or parsed_url.scheme != expected.scheme
        or parsed_url.hostname != host
        or parsed_url.hostname != expected.hostname
        or parsed_url.port != APPROVED_DISPOSABLE_STATION_PORT
        or expected.port != APPROVED_DISPOSABLE_STATION_PORT
        or parsed_url.port != expected.port
        or parsed_url.path not in {"", "/"}
        or parsed_url.params
        or parsed_url.query
        or parsed_url.fragment
        or expected.path not in {"", "/"}
        or expected.params
        or expected.query
        or expected.fragment
    ):
        raise RuntimeError(
            "Disposable Chat Acceptance target mismatch: "
            f"environment={selected_environment} station_url={station_url} "
            f"expected_url={expected_url or 'missing'}"
        )
    for key in (
        "PT_ACCEPTANCE_COMPOSE_PROJECT",
        "PT_ACCEPTANCE_STATION_CONTAINER",
        "PT_ACCEPTANCE_POSTGRES_CONTAINER",
        "PT_ACCEPTANCE_POSTGRES_VOLUME",
    ):
        value = environment.get(key, "").strip()
        if not value or not SAFE_RUNTIME_NAME.fullmatch(value):
            raise RuntimeError(
                f"Disposable Chat Acceptance target requires safe {key}"
            )
    environment["PT_ACCEPTANCE_ENVIRONMENT"] = selected_environment
    return environment


def verify_disposable_station_runtime(
    environment: dict[str, str],
) -> dict[str, str]:
    expected_project = environment["PT_ACCEPTANCE_COMPOSE_PROJECT"]
    expected_volume = environment["PT_ACCEPTANCE_POSTGRES_VOLUME"]
    containers = {
        "station": environment["PT_ACCEPTANCE_STATION_CONTAINER"],
        "postgres": environment["PT_ACCEPTANCE_POSTGRES_CONTAINER"],
    }
    observed: dict[str, str] = {}
    for service, container in containers.items():
        output = _remote_command(
            environment,
            "docker inspect "
            "--format '{{json .}}' "
            f"{shlex.quote(container)}",
        )
        try:
            inspection = json.loads(output)
        except json.JSONDecodeError as error:
            raise RuntimeError(
                f"Disposable Chat Acceptance {service} inspect is invalid"
            ) from error
        labels = (
            inspection.get("Config", {}).get("Labels", {})
            if isinstance(inspection, dict)
            else {}
        )
        state = inspection.get("State", {}) if isinstance(inspection, dict) else {}
        if (
            labels.get("com.docker.compose.project") != expected_project
            or labels.get("com.docker.compose.service") != service
            or state.get("Running") is not True
        ):
            raise RuntimeError(
                "Disposable Chat Acceptance runtime identity mismatch: "
                f"service={service} container={container}"
            )
        observed[f"{service}Container"] = container

        if service == "postgres":
            volumes = {
                str(mount.get("Name") or "")
                for mount in inspection.get("Mounts", [])
                if isinstance(mount, dict)
                and mount.get("Destination") == "/var/lib/postgresql/data"
            }
            if volumes != {expected_volume}:
                raise RuntimeError(
                    "Disposable Chat Acceptance PostgreSQL volume mismatch: "
                    f"expected={expected_volume} actual={sorted(volumes)}"
                )
            observed["postgresVolume"] = expected_volume
    observed["composeProject"] = expected_project
    observed["environment"] = environment["PT_ACCEPTANCE_ENVIRONMENT"]
    return observed


def _commits_match(left: str, right: str) -> bool:
    return bool(left and right) and (left.startswith(right) or right.startswith(left))


def _station_version(station_url: str) -> dict[str, object]:
    with urllib.request.urlopen(
        f"{station_url.rstrip('/')}/app-meta/version",
        timeout=5,
    ) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError("Chat Acceptance Station version response is invalid")
    return value


def _remote_transport(environment: dict[str, str]) -> SshTransport:
    host = environment.get("PT_DEPLOY_HOST", "").strip()
    user = environment.get("PT_DEPLOY_USER", "").strip()
    if not host or not user:
        raise RuntimeError(
            "Chat Acceptance deployment must define PT_DEPLOY_HOST and "
            "PT_DEPLOY_USER"
        )
    try:
        port = int(environment.get("PT_DEPLOY_PORT", "22"))
    except ValueError as error:
        raise RuntimeError("PT_DEPLOY_PORT must be a valid SSH port") from error
    return SshTransport(
        SshTarget(
            host=host,
            user=user,
            port=port,
            known_hosts_file=environment.get(
                "PT_DEPLOY_KNOWN_HOSTS_FILE",
                "",
            ).strip(),
        ),
    )


def _remote_command(environment: dict[str, str], command: str) -> str:
    result = _remote_transport(environment).run_argv(
        ["sh", "-lc", command],
        timeout=30,
        check=True,
    )
    return result.stdout.strip()


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _remote_psql(environment: dict[str, str], sql: str) -> str:
    container = environment["PT_ACCEPTANCE_POSTGRES_CONTAINER"]
    remote = (
        f"docker exec -i {container} sh -lc "
        "'psql -At -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" "
        "-d \"$POSTGRES_DB\"'"
    )
    result = _remote_transport(environment).run_argv(
        ["sh", "-lc", remote],
        timeout=30,
        check=True,
        input_text=sql,
    )
    return result.stdout.strip()


def duplicate_acceptance_queue_delivery(
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

    environment = acceptance_station_environment(station_url)
    verify_disposable_station_runtime(environment)
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


def restart_acceptance_station(
    station_url: str,
    expected_commit: str,
) -> dict[str, object]:
    if os.environ.get("CHAT_ACCEPTANCE_ALLOW_STATION_RESTART") != "1":
        raise RuntimeError(
            "CHAT_ACCEPTANCE_ALLOW_STATION_RESTART=1 is required for the "
            "authorized disposable Station restart scenario"
        )

    environment = acceptance_station_environment(station_url)
    runtime_identity = verify_disposable_station_runtime(environment)
    host = environment.get("PT_DEPLOY_HOST", "").strip()

    container = environment["PT_ACCEPTANCE_STATION_CONTAINER"]

    before_version = _station_version(station_url)
    before_commit = str(before_version.get("build_commit") or "")
    if not _commits_match(before_commit, expected_commit):
        raise RuntimeError(
            "Chat Acceptance Station commit mismatch before restart: "
            f"station={before_commit or 'missing'} expected={expected_commit}"
        )
    inspect = f"docker inspect -f '{{{{.State.StartedAt}}}}' {container}"
    before_started_at = _remote_command(environment, inspect)
    if not before_started_at:
        raise RuntimeError(
            "Chat Acceptance Station start timestamp is unavailable"
        )

    restarted_container = _remote_command(environment, f"docker restart {container}")
    if restarted_container != container:
        raise RuntimeError(
            "Chat Acceptance Station restart returned an unexpected container: "
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
                "Chat Acceptance Station returned a different commit after restart: "
                f"{candidate_commit or 'missing'}"
            )
        except Exception as error:
            last_error = str(error)
        threading.Event().wait(1)
    if after_version is None:
        raise RuntimeError(
            "Chat Acceptance Station did not recover after restart"
            + (f": {last_error}" if last_error else "")
        )

    after_started_at = _remote_command(environment, inspect)
    if not after_started_at or after_started_at == before_started_at:
        raise RuntimeError(
            "Chat Acceptance Station container start timestamp did not change"
        )
    after_commit = str(after_version.get("build_commit") or "")
    return {
        "environment": environment["PT_ACCEPTANCE_ENVIRONMENT"],
        "runtimeIdentity": runtime_identity,
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
    environment = deploy_environment(environment_name)
    station_url = environment.get("PT_ACCEPTANCE_STATION_URL", "").strip()
    environment = acceptance_station_environment(
        station_url,
        environment_name,
    )
    verify_disposable_station_runtime(environment)
    container = environment["PT_ACCEPTANCE_POSTGRES_CONTAINER"]
    sql = f"""
BEGIN;
TRUNCATE TABLE {', '.join(CHAT_TABLES)} CASCADE;
DO $acceptance$
DECLARE
  preset_hash text;
  updated_count integer;
  alice_actor_id bigint;
  bob_actor_id bigint;
  carol_actor_id bigint;
  alice_actor_ptid text;
  bob_actor_ptid text;
  carol_actor_ptid text;
  mutual_follow_count integer;
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

  SELECT id, ptid INTO STRICT alice_actor_id, alice_actor_ptid
  FROM touch_actor
  WHERE email = 'alice@p.t';
  SELECT id, ptid INTO STRICT bob_actor_id, bob_actor_ptid
  FROM touch_actor
  WHERE email = 'bob@p.t';
  SELECT id, ptid INTO STRICT carol_actor_id, carol_actor_ptid
  FROM touch_actor
  WHERE email = 'carol@p.t';

  IF NOT (
    coalesce(alice_actor_ptid, '') ~ '^ptid:.+$'
    AND coalesce(bob_actor_ptid, '') ~ '^ptid:.+$'
    AND coalesce(carol_actor_ptid, '') ~ '^ptid:.+$'
  ) THEN
    RAISE EXCEPTION 'native Chat preset actor PTIDs are invalid';
  END IF;

  SELECT count(*) INTO mutual_follow_count
  FROM follows
  WHERE (follower_id, following_id) IN (
    (alice_actor_id, bob_actor_id),
    (bob_actor_id, alice_actor_id),
    (alice_actor_id, carol_actor_id),
    (carol_actor_id, alice_actor_id),
    (bob_actor_id, carol_actor_id),
    (carol_actor_id, bob_actor_id)
  );
  IF mutual_follow_count <> 6 THEN
    RAISE EXCEPTION 'native Chat preset mutual follows are incomplete';
  END IF;

  INSERT INTO friend_chat_friend_requests (
    request_id,
    pair_key,
    sender_ptid,
    receiver_ptid,
    status,
    message,
    created_at,
    updated_at
  ) VALUES
    (
      'acceptance-alice-bob',
      LEAST(alice_actor_ptid, bob_actor_ptid) || '|' ||
        GREATEST(alice_actor_ptid, bob_actor_ptid),
      alice_actor_ptid,
      bob_actor_ptid,
      2,
      '',
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      'acceptance-alice-carol',
      LEAST(alice_actor_ptid, carol_actor_ptid) || '|' ||
        GREATEST(alice_actor_ptid, carol_actor_ptid),
      alice_actor_ptid,
      carol_actor_ptid,
      2,
      '',
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      'acceptance-bob-carol',
      LEAST(bob_actor_ptid, carol_actor_ptid) || '|' ||
        GREATEST(bob_actor_ptid, carol_actor_ptid),
      bob_actor_ptid,
      carol_actor_ptid,
      2,
      '',
      clock_timestamp(),
      clock_timestamp()
    );
END
$acceptance$;
COMMIT;
"""
    remote = (
        f"docker exec -i {container} sh -lc "
        "'psql -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\"'"
    )
    _remote_transport(environment).run_argv(
        ["sh", "-lc", remote],
        timeout=30,
        check=True,
        input_text=sql,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", required=True)
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
