#!/usr/bin/env python3
"""Reset disposable native Chat acceptance state while preserving actor identities."""

from __future__ import annotations

import argparse
from contextlib import closing
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sqlite3
import subprocess
import threading
import time
import urllib.parse
import urllib.request

from tooling.acceptance.transports.ssh import SshTarget, SshTransport


REPO_ROOT = Path(__file__).resolve().parents[3]
SAFE_RUNTIME_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")
APPROVED_DISPOSABLE_STATION_PORT = 18132
PROTECTED_CLEANUP_PORTS = frozenset({4445, 18080})
LOCAL_SOURCE_RUNTIME = "local-source"
SOCIAL_RELATIONSHIP_PROTO = "domain/social/relationship.proto"
SOCIAL_PROTO_ROOT = REPO_ROOT / "model"
FIXTURE_FRIENDSHIP_CREATED_AT_UNIX = 1788739200
CHAT_TABLES = (
    "actor_devices",
    "actor_endpoint_directory_versions",
    "actor_identity_keys",
    "actor_sessions",
    "conversation_attachment_audits",
    "conversation_attachment_grants",
    "conversation_attachment_objects",
    "conversation_attachment_upload_parts",
    "conversation_attachment_uploads",
    "conversation_authority_plans",
    "conversation_command_receipts",
    "conversation_delivery_commitments",
    "conversation_delivery_receipts",
    "conversation_event_projection_grants",
    "conversation_events",
    "conversation_follower_heads",
    "conversation_follower_members",
    "conversation_follower_pending_events",
    "conversation_follower_states",
    "conversation_member_devices",
    "conversation_member_settings",
    "conversation_members",
    "conversation_mls_leave_intents",
    "conversation_read_cursors",
    "conversations",
    "device_queue_items",
    "device_queue_lanes",
    "federated_mls_key_package_claims",
    "federation_delivery_inbox",
    "federation_delivery_outbox",
    "friend_chat_friendships",
    "key_exchange_direct_fetch_receipts",
    "key_exchange_identity_keys",
    "key_exchange_mls_fetch_receipts",
    "key_exchange_one_time_pre_keys",
    "key_exchange_signed_pre_keys",
    "mls_key_packages",
    "recovery_revisions",
    "social_friend_request_commands",
    "social_friend_request_effects",
    "social_friend_requests",
    "social_relationship_projections",
)
RETIRED_CHAT_TABLES = (
    "conversation_command_proposals",
    "conversation_follower_applied_events",
    "conversation_follower_buffer",
    "conversation_follower_member_devices",
    "conversation_follower_projection",
    "envelope_idempotency",
    "envelope_inbox",
    "envelope_outbox",
    "federated_endpoint_manifests",
    "friend_chat_friend_requests",
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
    "messaging_event_projection_targets",
    "messaging_events",
    "messaging_federation_inbox",
    "messaging_federation_outbox",
    "messaging_follower_conversations",
    "messaging_follower_event_receipts",
    "messaging_follower_members",
    "messaging_follower_pending_events",
    "messaging_read_cursors",
    "messaging_recovery_revisions",
)


@dataclass(frozen=True)
class FixtureActorRecord:
    ptid: str
    preferred_username: str
    name: str
    summary: str
    icon: str
    image: str
    url: str
    federated_handle: str
    home_station_peer_id: str
    home_station_domain: str
    visibility: int
    locator_seq: int


@dataclass(frozen=True)
class FixtureAcceptedFriendship:
    federation_id: str
    request_id: str
    sender: FixtureActorRecord
    receiver: FixtureActorRecord
    accepted_event_id: str
    accepted_event_hash: bytes
    accepted_event_bytes: bytes


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


def _local_source_environment(
    station_url: str,
    environment_name: str | None,
) -> dict[str, str] | None:
    try:
        profile = active_profile_environment()
    except RuntimeError:
        return None
    if profile.get("PT_STATION_MODE", "").strip() != "local":
        return None
    profile_name = profile.get("PT_DEV_PROFILE", "").strip()
    expected_url = profile.get("PT_STATION_URL", "").rstrip("/")
    if environment_name not in {None, "", "local", profile_name}:
        return None
    parsed_url = urllib.parse.urlparse(station_url)
    expected = urllib.parse.urlparse(expected_url)
    if (
        not profile_name
        or not expected_url
        or station_url.rstrip("/") != expected_url
        or parsed_url.scheme != "http"
        or parsed_url.hostname not in {"127.0.0.1", "localhost"}
        or parsed_url.port != expected.port
        or parsed_url.path not in {"", "/"}
        or parsed_url.params
        or parsed_url.query
        or parsed_url.fragment
    ):
        raise RuntimeError(
            "Local source Chat Acceptance target mismatch: "
            f"profile={profile_name or 'missing'} station_url={station_url} "
            f"expected_url={expected_url or 'missing'}"
        )
    data_root = (
        REPO_ROOT / ".local" / "dev" / "data" / profile_name
    ).resolve()
    pid_root = (
        REPO_ROOT / ".local" / "dev" / "pids" / profile_name
    ).resolve()
    environment = dict(profile)
    environment.update({
        "PT_ACCEPTANCE_RUNTIME_KIND": LOCAL_SOURCE_RUNTIME,
        "PT_ACCEPTANCE_ENVIRONMENT": profile_name,
        "PT_ACCEPTANCE_STATION_URL": expected_url,
        "PT_ACCEPTANCE_LOCAL_DATA_ROOT": str(data_root),
        "PT_ACCEPTANCE_LOCAL_DATABASE": str(data_root / "station.db"),
        "PT_ACCEPTANCE_LOCAL_PID_FILE": str(pid_root / "station.pid"),
        "PT_ACCEPTANCE_LOCAL_CONFIG": str(
            data_root / "station-conf" / "peers-sqlite.yml"
        ),
    })
    return environment


def acceptance_station_environment(
    station_url: str,
    environment_name: str | None = None,
) -> dict[str, str]:
    local_environment = _local_source_environment(
        station_url,
        environment_name,
    )
    if local_environment is not None:
        return local_environment
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
    *,
    deadline_monotonic: float | None = None,
    cancellation: threading.Event | None = None,
) -> dict[str, str]:
    if environment.get("PT_ACCEPTANCE_RUNTIME_KIND") == LOCAL_SOURCE_RUNTIME:
        return _verify_local_source_station(environment)
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
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
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


def _verify_local_source_station(
    environment: dict[str, str],
) -> dict[str, str]:
    profile_name = environment["PT_ACCEPTANCE_ENVIRONMENT"]
    data_root = Path(environment["PT_ACCEPTANCE_LOCAL_DATA_ROOT"]).resolve()
    database = Path(environment["PT_ACCEPTANCE_LOCAL_DATABASE"]).resolve()
    config = Path(environment["PT_ACCEPTANCE_LOCAL_CONFIG"]).resolve()
    pid_file = Path(environment["PT_ACCEPTANCE_LOCAL_PID_FILE"]).resolve()
    expected_root = (
        REPO_ROOT / ".local" / "dev" / "data" / profile_name
    ).resolve()
    if (
        data_root != expected_root
        or database.parent != expected_root
        or config.parent.parent != expected_root
        or pid_file.parent
        != (REPO_ROOT / ".local" / "dev" / "pids" / profile_name).resolve()
    ):
        raise RuntimeError(
            "Local source Chat Acceptance paths escape the active profile"
        )
    if not database.is_file() or not config.is_file() or not pid_file.is_file():
        raise RuntimeError(
            "Local source Chat Acceptance runtime files are incomplete"
        )
    pid = pid_file.read_text(encoding="utf-8").strip()
    if not pid.isdigit():
        raise RuntimeError("Local source Chat Acceptance PID is invalid")
    if os.name == "nt":
        powershell = (
            Path(os.environ.get("SystemRoot", r"C:\Windows"))
            / "System32"
            / "WindowsPowerShell"
            / "v1.0"
            / "powershell.exe"
        )
        script = (
            f"$p=Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\";"
            f"$listener=Get-NetTCPConnection -State Listen -LocalPort "
            f"{urllib.parse.urlparse(environment['PT_ACCEPTANCE_STATION_URL']).port} "
            f"| Where-Object {{$_.OwningProcess -eq {pid}}};"
            "if($null -eq $p -or $null -eq $listener){exit 3};"
            "$p.CommandLine"
        )
        process = subprocess.run(
            [str(powershell), "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        command_line = process.stdout.strip()
        if process.returncode != 0 or "peers-sqlite.yml" not in command_line:
            raise RuntimeError(
                "Local source Chat Acceptance process ownership mismatch"
            )
    else:
        command_line = (
            Path("/proc") / pid / "cmdline"
        ).read_bytes().replace(b"\0", b" ").decode("utf-8")
        if "peers-sqlite.yml" not in command_line:
            raise RuntimeError(
                "Local source Chat Acceptance process ownership mismatch"
            )
    version = _station_version(environment["PT_ACCEPTANCE_STATION_URL"])
    live_commit = str(version.get("build_commit") or "")
    source_commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=15,
        check=True,
    ).stdout.strip()
    if not _commits_match(live_commit, source_commit):
        raise RuntimeError(
            "Local source Chat Acceptance commit mismatch: "
            f"station={live_commit or 'missing'} source={source_commit}"
        )
    return {
        "environment": profile_name,
        "runtimeKind": LOCAL_SOURCE_RUNTIME,
        "database": str(database),
        "pid": pid,
        "commandLine": command_line,
        "commit": live_commit,
    }


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


def _remaining_command_timeout(
    configured_timeout: float,
    deadline_monotonic: float | None,
    cancellation: threading.Event | None,
) -> float:
    if cancellation is not None and cancellation.is_set():
        raise TimeoutError("Chat native reset command was cancelled")
    if deadline_monotonic is None:
        return configured_timeout
    remaining = deadline_monotonic - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Chat native reset command exceeded its deadline")
    return min(configured_timeout, remaining)


def _remote_command(
    environment: dict[str, str],
    command: str,
    *,
    deadline_monotonic: float | None = None,
    cancellation: threading.Event | None = None,
) -> str:
    result = _remote_transport(environment).run_argv(
        ["sh", "-lc", command],
        timeout=_remaining_command_timeout(
            30,
            deadline_monotonic,
            cancellation,
        ),
        check=True,
    )
    _remaining_command_timeout(
        30,
        deadline_monotonic,
        cancellation,
    )
    return result.stdout.strip()


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _sql_bytes(value: bytes) -> str:
    return f"decode('{value.hex()}', 'hex')"


def _textproto_string(value: str) -> str:
    return json.dumps(value)


def _textproto_bytes(value: bytes) -> str:
    return '"' + "".join(f"\\x{byte:02x}" for byte in value) + '"'


def _actor_ref_text(actor: FixtureActorRecord) -> str:
    account = actor.federated_handle.removeprefix("@")
    return "\n".join(
        (
            f"ptid: {_textproto_string(actor.ptid)}",
            f"acct: {_textproto_string(account)}",
            "kind: ACTOR_KIND_PERSON",
        )
    )


def _encode_social_proto(message_name: str, text: str) -> bytes:
    protoc = shutil.which("protoc")
    if protoc is None:
        raise RuntimeError(
            "canonical Social fixture generation requires protoc"
        )
    result = subprocess.run(
        [
            protoc,
            "--proto_path=.",
            f"--encode={message_name}",
            SOCIAL_RELATIONSHIP_PROTO,
        ],
        cwd=SOCIAL_PROTO_ROOT,
        input=text.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=15,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(
            "canonical Social fixture protobuf encoding failed"
            + (f": {detail}" if detail else "")
        )
    return result.stdout


def _friend_request_event_text(
    *,
    event_id: str,
    request_id: str,
    command_id: str,
    authority_station_peer_id: str,
    state: str,
    sender: FixtureActorRecord,
    receiver: FixtureActorRecord,
    sequence: int,
    committed_at_unix: int,
    federation_id: str,
    previous_hash: bytes = b"",
    event_hash: bytes = b"",
) -> str:
    fields = [
        f"event_id: {_textproto_string(event_id)}",
        f"request_id: {_textproto_string(request_id)}",
        f"command_id: {_textproto_string(command_id)}",
        (
            "authority_station_peer_id: "
            f"{_textproto_string(authority_station_peer_id)}"
        ),
        f"state: {state}",
        "sender {\n" + _actor_ref_text(sender) + "\n}",
        "receiver {\n" + _actor_ref_text(receiver) + "\n}",
        (
            "sender_home_station_peer_id: "
            f"{_textproto_string(sender.home_station_peer_id)}"
        ),
        (
            "receiver_home_station_peer_id: "
            f"{_textproto_string(receiver.home_station_peer_id)}"
        ),
        f"sequence: {sequence}",
        f"committed_at {{ seconds: {committed_at_unix} }}",
    ]
    if previous_hash:
        fields.append(f"previous_hash: {_textproto_bytes(previous_hash)}")
    if event_hash:
        fields.append(f"event_hash: {_textproto_bytes(event_hash)}")
    fields.append(f"federation_id: {_textproto_string(federation_id)}")
    return "\n".join(fields) + "\n"


def fixture_friendship_federation_id(
    first_ptid: str,
    second_ptid: str,
) -> str:
    participants = sorted((first_ptid.strip(), second_ptid.strip()))
    if not participants[0] or participants[0] == participants[1]:
        raise ValueError("fixture Federation requires two distinct actor PTIDs")
    identity = hashlib.sha256(
        (participants[0] + "\x00" + participants[1]).encode("utf-8")
    ).hexdigest()
    return f"fed_chat_{identity[:20]}"


def _accepted_friendship(
    actor: FixtureActorRecord,
    peer: FixtureActorRecord,
) -> FixtureAcceptedFriendship:
    sender, receiver = sorted((actor, peer), key=lambda item: item.ptid)
    identity = hashlib.sha256(
        (sender.ptid + "\x00" + receiver.ptid).encode("utf-8")
    ).hexdigest()
    federation_id = fixture_friendship_federation_id(
        sender.ptid,
        receiver.ptid,
    )
    request_id = f"acceptance-cross-{identity[:24]}"
    pending_event_id = f"friend-request-event:{request_id}:1"
    accepted_event_id = f"friend-request-event:{request_id}:2"

    pending_without_hash = _encode_social_proto(
        "peers_touch.model.social.v1.FriendRequestEvent",
        _friend_request_event_text(
            event_id=pending_event_id,
            request_id=request_id,
            command_id=f"acceptance-cross-send-{identity[:24]}",
            authority_station_peer_id=receiver.home_station_peer_id,
            state="FRIEND_REQUEST_STATE_PENDING",
            sender=sender,
            receiver=receiver,
            sequence=1,
            committed_at_unix=FIXTURE_FRIENDSHIP_CREATED_AT_UNIX,
            federation_id=federation_id,
        ),
    )
    pending_hash = hashlib.sha256(pending_without_hash).digest()
    accepted_without_hash = _encode_social_proto(
        "peers_touch.model.social.v1.FriendRequestEvent",
        _friend_request_event_text(
            event_id=accepted_event_id,
            request_id=request_id,
            command_id=f"acceptance-cross-accept-{identity[:24]}",
            authority_station_peer_id=receiver.home_station_peer_id,
            state="FRIEND_REQUEST_STATE_ACCEPTED",
            sender=sender,
            receiver=receiver,
            sequence=2,
            committed_at_unix=FIXTURE_FRIENDSHIP_CREATED_AT_UNIX + 1,
            federation_id=federation_id,
            previous_hash=pending_hash,
        ),
    )
    accepted_hash = hashlib.sha256(accepted_without_hash).digest()
    accepted_event = _encode_social_proto(
        "peers_touch.model.social.v1.FriendRequestEvent",
        _friend_request_event_text(
            event_id=accepted_event_id,
            request_id=request_id,
            command_id=f"acceptance-cross-accept-{identity[:24]}",
            authority_station_peer_id=receiver.home_station_peer_id,
            state="FRIEND_REQUEST_STATE_ACCEPTED",
            sender=sender,
            receiver=receiver,
            sequence=2,
            committed_at_unix=FIXTURE_FRIENDSHIP_CREATED_AT_UNIX + 1,
            federation_id=federation_id,
            previous_hash=pending_hash,
            event_hash=accepted_hash,
        ),
    )
    return FixtureAcceptedFriendship(
        federation_id=federation_id,
        request_id=request_id,
        sender=sender,
        receiver=receiver,
        accepted_event_id=accepted_event_id,
        accepted_event_hash=accepted_hash,
        accepted_event_bytes=accepted_event,
    )


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
    if environment.get("PT_ACCEPTANCE_RUNTIME_KIND") == LOCAL_SOURCE_RUNTIME:
        database = environment["PT_ACCEPTANCE_LOCAL_DATABASE"]
        duplicate_item_id = hashlib.sha256(
            f"{source_item_id}:{time.time_ns()}".encode("utf-8")
        ).hexdigest()[:32]
        with closing(sqlite3.connect(database, timeout=10)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("BEGIN IMMEDIATE")
            source_row = connection.execute(
                """
SELECT event_id, event_sequence, conversation_id, payload_type,
       opaque_payload, payload_sha256, state, expires_at
FROM device_queue_items
WHERE item_id = ? AND recipient_ptid = ? AND recipient_device_id = ?
""",
                (source_item_id, recipient_ptid, recipient_device_id),
            ).fetchone()
            if source_row is None:
                raise RuntimeError("queue replay source item is unavailable")
            if source_row["state"] != 5:
                raise RuntimeError("queue replay source item is not ACKED")
            lane_row = connection.execute(
                """
SELECT next_sequence
FROM device_queue_lanes
WHERE recipient_ptid = ? AND recipient_device_id = ?
""",
                (recipient_ptid, recipient_device_id),
            ).fetchone()
            if lane_row is None:
                raise RuntimeError("queue replay recipient lane is unavailable")
            lane_sequence = int(lane_row["next_sequence"]) + 1
            connection.execute(
                """
INSERT INTO device_queue_items (
  item_id, recipient_ptid, recipient_device_id, lane_sequence,
  idempotency_key, event_id, event_sequence, conversation_id,
  payload_type, opaque_payload, payload_sha256, state, attempt_count,
  lease_consumer_id, lease_consumer_epoch, lease_expires_at,
  first_queued_at, next_attempt_at, expires_at, consumed_at, acked_at,
  consumption_receipt_id, last_error_code, last_reject_consumer_epoch
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, '', 0, NULL,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, NULL, NULL, '',
  '', 0
)
""",
                (
                    duplicate_item_id,
                    recipient_ptid,
                    recipient_device_id,
                    lane_sequence,
                    duplicate_item_id,
                    source_row["event_id"],
                    source_row["event_sequence"],
                    source_row["conversation_id"],
                    source_row["payload_type"],
                    source_row["opaque_payload"],
                    source_row["payload_sha256"],
                    source_row["expires_at"],
                ),
            )
            updated = connection.execute(
                """
UPDATE device_queue_lanes
SET next_sequence = ?
WHERE recipient_ptid = ? AND recipient_device_id = ?
""",
                (lane_sequence, recipient_ptid, recipient_device_id),
            ).rowcount
            if updated != 1:
                raise RuntimeError("queue replay recipient lane update failed")
            connection.commit()
        return {
            "sourceItemId": source_item_id,
            "duplicateItemId": duplicate_item_id,
            "eventId": source_row["event_id"],
            "laneSequence": lane_sequence,
            "payloadSha256": bytes(
                source_row["payload_sha256"] or b""
            ).hex(),
            "state": 1,
        }
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


def read_fixture_actor(
    station_url: str,
    environment_name: str,
    account_email: str,
) -> FixtureActorRecord:
    environment = acceptance_station_environment(
        station_url,
        environment_name,
    )
    verify_disposable_station_runtime(environment)
    if environment.get("PT_ACCEPTANCE_RUNTIME_KIND") == LOCAL_SOURCE_RUNTIME:
        with closing(sqlite3.connect(
            environment["PT_ACCEPTANCE_LOCAL_DATABASE"],
            timeout=10,
        )) as connection:
            connection.row_factory = sqlite3.Row
            rows = connection.execute(
                """
SELECT
  ptid,
  preferred_username,
  name,
  summary,
  icon,
  image,
  url,
  federated_handle,
  home_station_peer_id,
  home_station_domain,
  visibility,
  locator_seq
FROM touch_actor
WHERE email = ?
  AND origin = 'local'
""",
                (account_email,),
            ).fetchall()
        if len(rows) != 1:
            raise RuntimeError(
                "Chat fixture requires exactly one local actor for "
                f"account={account_email}"
            )
        row = rows[0]
        value = {
            "ptid": row["ptid"],
            "preferredUsername": row["preferred_username"],
            "name": row["name"],
            "summary": row["summary"],
            "icon": row["icon"],
            "image": row["image"],
            "url": row["url"],
            "federatedHandle": row["federated_handle"],
            "homeStationPeerId": row["home_station_peer_id"],
            "homeStationDomain": row["home_station_domain"],
            "visibility": row["visibility"],
            "locatorSeq": row["locator_seq"],
        }
    else:
        output = _remote_psql(
            environment,
            f"""
SELECT json_build_object(
  'ptid', ptid,
  'preferredUsername', preferred_username,
  'name', name,
  'summary', summary,
  'icon', icon,
  'image', image,
  'url', url,
  'federatedHandle', federated_handle,
  'homeStationPeerId', home_station_peer_id,
  'homeStationDomain', home_station_domain,
  'visibility', visibility,
  'locatorSeq', locator_seq
)
FROM touch_actor
WHERE email = {_sql_literal(account_email)}
  AND origin = 'local';
""",
        )
        lines = [
            line for line in output.splitlines()
            if line.strip().startswith("{")
        ]
        if len(lines) != 1:
            raise RuntimeError(
                "Chat fixture requires exactly one local actor for "
                f"account={account_email}"
            )
        value = json.loads(lines[0])
    if not isinstance(value, dict):
        raise RuntimeError(
            f"Chat fixture actor projection is invalid for account={account_email}"
        )
    record = FixtureActorRecord(
        ptid=str(value.get("ptid") or ""),
        preferred_username=str(value.get("preferredUsername") or ""),
        name=str(value.get("name") or ""),
        summary=str(value.get("summary") or ""),
        icon=str(value.get("icon") or ""),
        image=str(value.get("image") or ""),
        url=str(value.get("url") or ""),
        federated_handle=str(value.get("federatedHandle") or ""),
        home_station_peer_id=str(value.get("homeStationPeerId") or ""),
        home_station_domain=str(value.get("homeStationDomain") or ""),
        visibility=int(value.get("visibility") or 0),
        locator_seq=int(value.get("locatorSeq") or 0),
    )
    if (
        not record.ptid.startswith("ptid:")
        or not record.preferred_username
        or not record.federated_handle.startswith("@")
        or not record.home_station_peer_id
        or not record.home_station_domain
    ):
        raise RuntimeError(
            f"Chat fixture actor identity is incomplete for account={account_email}"
        )
    return record


def seed_cross_station_contact(
    station_url: str,
    environment_name: str,
    actor: FixtureActorRecord,
    peer: FixtureActorRecord,
) -> None:
    environment = acceptance_station_environment(station_url, environment_name)
    verify_disposable_station_runtime(environment)
    friendship = _accepted_friendship(actor, peer)
    sender_ref = _encode_social_proto(
        "peers_touch.model.actor.v1.ActorRef",
        _actor_ref_text(friendship.sender),
    )
    receiver_ref = _encode_social_proto(
        "peers_touch.model.actor.v1.ActorRef",
        _actor_ref_text(friendship.receiver),
    )
    local_scheme = urllib.parse.urlparse(station_url).scheme
    station_urls = {
        actor.home_station_peer_id: station_url.rstrip("/"),
        peer.home_station_peer_id: (
            f"{local_scheme}://{peer.home_station_domain}"
        ),
    }
    memberships = ",\n".join(
        f"""(
    {_sql_literal(friendship.federation_id)},
    {_sql_literal(member.home_station_peer_id)},
    {_sql_literal(member.home_station_domain)},
    {_sql_literal(station_urls[member.home_station_peer_id])},
    {_sql_literal(
        "founder"
        if member.home_station_peer_id
        == friendship.sender.home_station_peer_id
        else "member_station"
    )},
    'active',
    to_timestamp({FIXTURE_FRIENDSHIP_CREATED_AT_UNIX}),
    ''
  )"""
        for member in (friendship.sender, friendship.receiver)
    )
    sql = f"""
BEGIN;
INSERT INTO federation (
  federation_id,
  name,
  description,
  status,
  policy_type,
  sequencer_station_peer_id,
  genesis_hash,
  head_hash,
  head_seq,
  created_by_actor_ptid,
  created_by_station_peer_id,
  created_at,
  updated_at
) VALUES (
  {_sql_literal(friendship.federation_id)},
  'chat-native-acceptance',
  '',
  'active',
  'single_admin',
  {_sql_literal(friendship.sender.home_station_peer_id)},
  {_sql_bytes(bytes(32))},
  {_sql_bytes(bytes(32))},
  0,
  {_sql_literal(friendship.sender.ptid)},
  {_sql_literal(friendship.sender.home_station_peer_id)},
  to_timestamp({FIXTURE_FRIENDSHIP_CREATED_AT_UNIX}),
  to_timestamp({FIXTURE_FRIENDSHIP_CREATED_AT_UNIX})
)
ON CONFLICT (federation_id) DO UPDATE SET
  status = EXCLUDED.status,
  sequencer_station_peer_id = EXCLUDED.sequencer_station_peer_id,
  created_by_actor_ptid = EXCLUDED.created_by_actor_ptid,
  created_by_station_peer_id = EXCLUDED.created_by_station_peer_id,
  updated_at = EXCLUDED.updated_at;
INSERT INTO federation_station_membership (
  federation_id,
  station_peer_id,
  station_name,
  station_url,
  role,
  status,
  joined_at,
  approved_by_event_id
) VALUES
  {memberships}
ON CONFLICT (federation_id, station_peer_id) DO UPDATE SET
  station_name = EXCLUDED.station_name,
  station_url = EXCLUDED.station_url,
  role = EXCLUDED.role,
  status = EXCLUDED.status;
LOCK TABLE touch_actor IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE follows IN SHARE ROW EXCLUSIVE MODE;
DELETE FROM touch_actor
WHERE origin = 'remote_cached'
  AND (
    ptid = {_sql_literal(peer.ptid)}
    OR federated_handle = {_sql_literal(peer.federated_handle)}
  );
INSERT INTO touch_actor (
  id,
  ptid,
  namespace,
  preferred_username,
  name,
  type,
  summary,
  icon,
  image,
  email,
  password_hash,
  kind,
  url,
  federated_handle,
  home_station_peer_id,
  home_station_domain,
  origin,
  visibility,
  locator_seq,
  cached_until_unix_ms,
  created_at,
  updated_at
) VALUES (
  (SELECT coalesce(max(id), 0) + 1 FROM touch_actor),
  {_sql_literal(peer.ptid)},
  'peers',
  {_sql_literal(peer.federated_handle)},
  {_sql_literal(peer.name)},
  'Person',
  {_sql_literal(peer.summary)},
  {_sql_literal(peer.icon)},
  {_sql_literal(peer.image)},
  {_sql_literal("remote+" + peer.federated_handle)},
  'remote-cached',
  'p',
  {_sql_literal(peer.url)},
  {_sql_literal(peer.federated_handle)},
  {_sql_literal(peer.home_station_peer_id)},
  {_sql_literal(peer.home_station_domain)},
  'remote_cached',
  {peer.visibility},
  {peer.locator_seq},
  (extract(epoch FROM clock_timestamp() + interval '1 hour') * 1000)::bigint,
  clock_timestamp(),
  clock_timestamp()
);
WITH actor_pair AS (
  SELECT
    actor.id AS actor_id,
    peer.id AS peer_id
  FROM touch_actor AS actor
  JOIN touch_actor AS peer
    ON peer.ptid = {_sql_literal(peer.ptid)}
  WHERE actor.ptid = {_sql_literal(actor.ptid)}
),
next_follow_id AS (
  SELECT coalesce(max(id), 0) AS max_id
  FROM follows
),
relationship_edges AS (
  SELECT actor_id AS follower_id, peer_id AS following_id, 1 AS id_offset
  FROM actor_pair
  UNION ALL
  SELECT peer_id AS follower_id, actor_id AS following_id, 2 AS id_offset
  FROM actor_pair
)
INSERT INTO follows (
  id,
  follower_id,
  following_id,
  created_at
)
SELECT
  next_follow_id.max_id + relationship_edges.id_offset,
  relationship_edges.follower_id,
  relationship_edges.following_id,
  clock_timestamp()
FROM relationship_edges
CROSS JOIN next_follow_id
ON CONFLICT (follower_id, following_id) DO NOTHING;
INSERT INTO social_friend_requests (
  request_id,
  federation_id,
  authority_station_peer_id,
  sender_ptid,
  receiver_ptid,
  sender_actor_ref_bytes,
  receiver_actor_ref_bytes,
  sender_home_station_peer_id,
  receiver_home_station_peer_id,
  message,
  state,
  sequence,
  last_event_hash,
  last_event_bytes,
  authority_confirmed,
  created_at,
  responded_at
) VALUES (
  {_sql_literal(friendship.request_id)},
  {_sql_literal(friendship.federation_id)},
  {_sql_literal(friendship.receiver.home_station_peer_id)},
  {_sql_literal(friendship.sender.ptid)},
  {_sql_literal(friendship.receiver.ptid)},
  {_sql_bytes(sender_ref)},
  {_sql_bytes(receiver_ref)},
  {_sql_literal(friendship.sender.home_station_peer_id)},
  {_sql_literal(friendship.receiver.home_station_peer_id)},
  '',
  2,
  2,
  {_sql_bytes(friendship.accepted_event_hash)},
  {_sql_bytes(friendship.accepted_event_bytes)},
  TRUE,
  to_timestamp({FIXTURE_FRIENDSHIP_CREATED_AT_UNIX}),
  to_timestamp({FIXTURE_FRIENDSHIP_CREATED_AT_UNIX + 1})
)
ON CONFLICT (request_id) DO UPDATE SET
  federation_id = EXCLUDED.federation_id,
  authority_station_peer_id = EXCLUDED.authority_station_peer_id,
  sender_ptid = EXCLUDED.sender_ptid,
  receiver_ptid = EXCLUDED.receiver_ptid,
  sender_actor_ref_bytes = EXCLUDED.sender_actor_ref_bytes,
  receiver_actor_ref_bytes = EXCLUDED.receiver_actor_ref_bytes,
  sender_home_station_peer_id = EXCLUDED.sender_home_station_peer_id,
  receiver_home_station_peer_id = EXCLUDED.receiver_home_station_peer_id,
  state = EXCLUDED.state,
  sequence = EXCLUDED.sequence,
  last_event_hash = EXCLUDED.last_event_hash,
  last_event_bytes = EXCLUDED.last_event_bytes,
  authority_confirmed = EXCLUDED.authority_confirmed,
  created_at = EXCLUDED.created_at,
  responded_at = EXCLUDED.responded_at;
INSERT INTO social_relationship_projections (
  owner_ptid,
  peer_ptid,
  request_id,
  accepted_event_id,
  accepted_event_hash,
  accepted_at
) VALUES (
  {_sql_literal(actor.ptid)},
  {_sql_literal(peer.ptid)},
  {_sql_literal(friendship.request_id)},
  {_sql_literal(friendship.accepted_event_id)},
  {_sql_bytes(friendship.accepted_event_hash)},
  to_timestamp({FIXTURE_FRIENDSHIP_CREATED_AT_UNIX + 1})
)
ON CONFLICT (owner_ptid, peer_ptid) DO UPDATE SET
  request_id = EXCLUDED.request_id,
  accepted_event_id = EXCLUDED.accepted_event_id,
  accepted_event_hash = EXCLUDED.accepted_event_hash,
  accepted_at = EXCLUDED.accepted_at;
DO $acceptance$
DECLARE
  relationship_edge_count integer;
  accepted_request_count integer;
  federation_membership_count integer;
BEGIN
  SELECT count(*) INTO relationship_edge_count
  FROM follows
  WHERE (follower_id, following_id) IN (
    (
      (SELECT id FROM touch_actor WHERE ptid = {_sql_literal(actor.ptid)}),
      (SELECT id FROM touch_actor WHERE ptid = {_sql_literal(peer.ptid)})
    ),
    (
      (SELECT id FROM touch_actor WHERE ptid = {_sql_literal(peer.ptid)}),
      (SELECT id FROM touch_actor WHERE ptid = {_sql_literal(actor.ptid)})
    )
  );
  IF relationship_edge_count <> 2 THEN
    RAISE EXCEPTION 'cross-Station accepted relationship is incomplete';
  END IF;

  SELECT count(*) INTO accepted_request_count
  FROM social_friend_requests
  WHERE request_id = {_sql_literal(friendship.request_id)}
    AND state = 2
    AND sequence = 2
    AND authority_confirmed = TRUE;
  IF accepted_request_count <> 1 THEN
    RAISE EXCEPTION 'canonical accepted Friend Request projection is incomplete';
  END IF;

  SELECT count(*) INTO federation_membership_count
  FROM federation_station_membership
  WHERE federation_id = {_sql_literal(friendship.federation_id)}
    AND station_peer_id IN (
      {_sql_literal(friendship.sender.home_station_peer_id)},
      {_sql_literal(friendship.receiver.home_station_peer_id)}
    )
    AND status = 'active';
  IF federation_membership_count <> 2 THEN
    RAISE EXCEPTION 'Chat fixture Federation membership is incomplete';
  END IF;
END
$acceptance$;
COMMIT;
"""
    _remote_psql(environment, sql)


def seed_same_station_contact(
    station_url: str,
    environment_name: str,
    actor: FixtureActorRecord,
    peer: FixtureActorRecord,
) -> None:
    environment = acceptance_station_environment(station_url, environment_name)
    verify_disposable_station_runtime(environment)
    if environment.get("PT_ACCEPTANCE_RUNTIME_KIND") != LOCAL_SOURCE_RUNTIME:
        raise RuntimeError(
            "same-Station canonical contact seeding currently requires a "
            "local-source Station"
        )
    if (
        actor.home_station_peer_id != peer.home_station_peer_id
        or actor.home_station_peer_id == ""
    ):
        raise RuntimeError(
            "same-Station canonical contact actors must share one Station"
        )

    friendship = _accepted_friendship(actor, peer)
    sender_ref = _encode_social_proto(
        "peers_touch.model.actor.v1.ActorRef",
        _actor_ref_text(friendship.sender),
    )
    receiver_ref = _encode_social_proto(
        "peers_touch.model.actor.v1.ActorRef",
        _actor_ref_text(friendship.receiver),
    )
    created_at = time.strftime(
        "%Y-%m-%d %H:%M:%S+00:00",
        time.gmtime(FIXTURE_FRIENDSHIP_CREATED_AT_UNIX),
    )
    accepted_at = time.strftime(
        "%Y-%m-%d %H:%M:%S+00:00",
        time.gmtime(FIXTURE_FRIENDSHIP_CREATED_AT_UNIX + 1),
    )
    database = environment["PT_ACCEPTANCE_LOCAL_DATABASE"]
    with closing(sqlite3.connect(database, timeout=10)) as connection:
        connection.execute("PRAGMA busy_timeout = 10000")
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                """
INSERT INTO federation (
  federation_id, name, description, status, policy_type,
  sequencer_station_peer_id, genesis_hash, head_hash, head_seq,
  created_by_actor_ptid, created_by_station_peer_id, created_at, updated_at
) VALUES (?, ?, '', 'active', 'single_admin', ?, ?, ?, 0, ?, ?, ?, ?)
ON CONFLICT (federation_id) DO UPDATE SET
  status = excluded.status,
  sequencer_station_peer_id = excluded.sequencer_station_peer_id,
  created_by_actor_ptid = excluded.created_by_actor_ptid,
  created_by_station_peer_id = excluded.created_by_station_peer_id,
  updated_at = excluded.updated_at
""",
                (
                    friendship.federation_id,
                    "chat-native-acceptance",
                    friendship.sender.home_station_peer_id,
                    bytes(32),
                    bytes(32),
                    friendship.sender.ptid,
                    friendship.sender.home_station_peer_id,
                    created_at,
                    created_at,
                ),
            )
            connection.execute(
                """
INSERT INTO federation_station_membership (
  federation_id, station_peer_id, station_name, station_url, role,
  status, joined_at, approved_by_event_id
) VALUES (?, ?, ?, ?, 'founder', 'active', ?, '')
ON CONFLICT (federation_id, station_peer_id) DO UPDATE SET
  station_name = excluded.station_name,
  station_url = excluded.station_url,
  role = excluded.role,
  status = excluded.status
""",
                (
                    friendship.federation_id,
                    friendship.sender.home_station_peer_id,
                    friendship.sender.home_station_domain,
                    station_url.rstrip("/"),
                    created_at,
                ),
            )
            connection.execute(
                """
INSERT INTO social_friend_requests (
  request_id, federation_id, authority_station_peer_id,
  sender_ptid, receiver_ptid, sender_actor_ref_bytes,
  receiver_actor_ref_bytes, sender_home_station_peer_id,
  receiver_home_station_peer_id, message, state, sequence,
  last_event_hash, last_event_bytes, authority_confirmed,
  created_at, responded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 2, 2, ?, ?, 1, ?, ?)
ON CONFLICT (request_id) DO UPDATE SET
  federation_id = excluded.federation_id,
  authority_station_peer_id = excluded.authority_station_peer_id,
  sender_ptid = excluded.sender_ptid,
  receiver_ptid = excluded.receiver_ptid,
  sender_actor_ref_bytes = excluded.sender_actor_ref_bytes,
  receiver_actor_ref_bytes = excluded.receiver_actor_ref_bytes,
  sender_home_station_peer_id = excluded.sender_home_station_peer_id,
  receiver_home_station_peer_id = excluded.receiver_home_station_peer_id,
  state = excluded.state,
  sequence = excluded.sequence,
  last_event_hash = excluded.last_event_hash,
  last_event_bytes = excluded.last_event_bytes,
  authority_confirmed = excluded.authority_confirmed,
  created_at = excluded.created_at,
  responded_at = excluded.responded_at
""",
                (
                    friendship.request_id,
                    friendship.federation_id,
                    friendship.receiver.home_station_peer_id,
                    friendship.sender.ptid,
                    friendship.receiver.ptid,
                    sender_ref,
                    receiver_ref,
                    friendship.sender.home_station_peer_id,
                    friendship.receiver.home_station_peer_id,
                    friendship.accepted_event_hash,
                    friendship.accepted_event_bytes,
                    created_at,
                    accepted_at,
                ),
            )
            connection.executemany(
                """
INSERT INTO social_relationship_projections (
  owner_ptid, peer_ptid, request_id, accepted_event_id,
  accepted_event_hash, accepted_at
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (owner_ptid, peer_ptid) DO UPDATE SET
  request_id = excluded.request_id,
  accepted_event_id = excluded.accepted_event_id,
  accepted_event_hash = excluded.accepted_event_hash,
  accepted_at = excluded.accepted_at
""",
                (
                    (
                        actor.ptid,
                        peer.ptid,
                        friendship.request_id,
                        friendship.accepted_event_id,
                        friendship.accepted_event_hash,
                        accepted_at,
                    ),
                    (
                        peer.ptid,
                        actor.ptid,
                        friendship.request_id,
                        friendship.accepted_event_id,
                        friendship.accepted_event_hash,
                        accepted_at,
                    ),
                ),
            )
            accepted_count = connection.execute(
                """
SELECT count(*)
FROM social_friend_requests
WHERE request_id = ? AND state = 2 AND sequence = 2
  AND authority_confirmed = 1
""",
                (friendship.request_id,),
            ).fetchone()[0]
            relationship_count = connection.execute(
                """
SELECT count(*)
FROM social_relationship_projections
WHERE request_id = ?
  AND owner_ptid IN (?, ?)
""",
                (friendship.request_id, actor.ptid, peer.ptid),
            ).fetchone()[0]
            if accepted_count != 1 or relationship_count != 2:
                raise RuntimeError(
                    "same-Station canonical accepted relationship is incomplete"
                )
            connection.commit()
        except BaseException:
            connection.rollback()
            raise


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


def reset_station_chat_state(environment_name: str) -> None:
    if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
        raise RuntimeError(
            "CHAT_ACCEPTANCE_RESET=1 is required for destructive Chat reset"
        )
    profile = active_profile_environment()
    station_url = profile.get("PT_STATION_URL", "").strip()
    local_environment = _local_source_environment(
        station_url,
        environment_name,
    )
    if local_environment is not None:
        verify_disposable_station_runtime(local_environment)
        stop_script = REPO_ROOT / "tooling" / "scripts" / "local-dev" / "stop.sh"
        start_script = (
            REPO_ROOT / "tooling" / "scripts" / "local-dev" / "station-dev.sh"
        )
        stopped = subprocess.run(
            ["bash", str(stop_script), "station"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if stopped.returncode != 0:
            raise RuntimeError(
                "Local source Chat Acceptance Station stop failed: "
                f"{stopped.stderr.strip() or stopped.stdout.strip()}"
            )
        database = Path(
            local_environment["PT_ACCEPTANCE_LOCAL_DATABASE"]
        ).resolve()
        for path in (
            database,
            Path(f"{database}-wal"),
            Path(f"{database}-shm"),
        ):
            path.unlink(missing_ok=True)
        started = subprocess.run(
            ["bash", str(start_script)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=240,
            check=False,
        )
        if started.returncode != 0:
            raise RuntimeError(
                "Local source Chat Acceptance Station start failed: "
                f"{started.stderr.strip() or started.stdout.strip()}"
            )
        verify_disposable_station_runtime(local_environment)
        return
    environment = deploy_environment(environment_name)
    station_url = environment.get("PT_ACCEPTANCE_STATION_URL", "").strip()
    environment = acceptance_station_environment(
        station_url,
        environment_name,
    )
    verify_disposable_station_runtime(environment)
    container = environment["PT_ACCEPTANCE_POSTGRES_CONTAINER"]
    canonical_table_names = ", ".join(
        _sql_literal(table) for table in CHAT_TABLES
    )
    retired_table_names = ", ".join(RETIRED_CHAT_TABLES)
    sql = f"""
BEGIN;
DROP TABLE IF EXISTS {retired_table_names} CASCADE;
DO $acceptance_reset$
DECLARE
  existing_tables text;
BEGIN
  SELECT string_agg(
    format('%I.%I', schemaname, tablename),
    ', ' ORDER BY tablename
  )
  INTO existing_tables
  FROM pg_tables
  WHERE schemaname = current_schema()
    AND tablename = ANY (ARRAY[{canonical_table_names}]::text[]);

  IF existing_tables IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || existing_tables || ' CASCADE';
  END IF;
END
$acceptance_reset$;
DELETE FROM touch_actor WHERE origin = 'remote_cached';
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
    reset_station_chat_state(args.environment)
    print(
        f"native Chat fixture reset: environment={args.environment} "
        f"local_storage_roots={reset_roots}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
