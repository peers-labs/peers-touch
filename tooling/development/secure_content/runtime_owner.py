#!/usr/bin/env python3
"""Own the live W7 Desktop and Browser runtimes and their immutable manifests."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from contextlib import ExitStack, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping, Sequence

from tooling.acceptance.core.attestation import (
    commits_match,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.launch_context import (
    EphemeralGateClient,
    EphemeralGateLaunchContext,
)
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.fixtures.secure_content_w7 import (
    W7FixtureBinding,
    W7FixtureOwner,
    canonical_digest as fixture_identity_digest,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientSpec,
    FoundationRuntimeClient,
    harness_ready,
    wait_until,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    open_reviewed_remote_tunnel,
    resolve_remote_source_identity,
)
from tooling.acceptance.transports.ssh import SshTunnel
from tooling.development.secure_content import runtime_manifest
from tooling.development.secure_content.activation_transport import (
    ActivationTransportError,
    ReviewedSchemaActivationTransport,
)
from tooling.development.secure_content.attached_client import (
    write_attached_runtime_manifest,
)
from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioBlocked,
    execute_scenario,
)
from tooling.development.secure_content.source_projection import (
    SourceProjectionError,
    resolve_runtime_source_identity,
)


OWNER_ID = runtime_manifest.RUNTIME_OWNER_ID
PROFILE = "four"
SLOT = 5
STATION_ID = "station-four"
SECONDARY_PROFILE = "fiveArm"
SECONDARY_STATION_ID = "station-five-arm"
DESKTOP_JOURNEY = "sc-dj-desktop-pilot"
BROWSER_JOURNEY = "sc-dj-browser-private-boundary"
WORK_ITEM_ID = "secure-content-w7"
PLAN_ID = "SECURE-CONTENT-HARD-CUT-20260913"
TASK_ID = "W7"
W8_WORK_ITEM_ID = "secure-content-w8"
W8_TASK_ID = "W8"
W8_JOURNEY = "sc-dj-social-expansion"
DESKTOP_CLIENTS = (
    ("secure-content-desktop-alice", "alice", "alice"),
    ("secure-content-desktop-bob", "bob", "bob"),
    ("secure-content-desktop-eve", "eve", "eve"),
)
BROWSER_CLIENTS = (
    ("secure-content-browser-authenticated", "browser_actor", "browser_actor"),
    ("secure-content-browser-anonymous", "anonymous", None),
)
REQUIRED_FIXTURE_CAPABILITIES = frozenset(
    {
        "account-switch",
        "station-switch",
        "publisher-device-revocation",
        "historical-recovery-epoch",
    }
)


def _error_message_with_cleanup(error: BaseException) -> str:
    message = str(error)
    cleanup_failures = tuple(
        getattr(error, "secondary_cleanup_failures", ())
    )
    if cleanup_failures:
        return f"{message}; {'; '.join(cleanup_failures)}"
    return message


class RuntimeOwnerBlocked(RuntimeError):
    def __init__(self, code: str, message: str, *, resource: str) -> None:
        super().__init__(message)
        self.code = code
        self.resource = resource

    def payload(self) -> dict[str, Any]:
        return {
            "status": "BLOCKED",
            "proofState": "UNPROVEN",
            "code": self.code,
            "owner": OWNER_ID,
            "resource": self.resource,
            "message": _error_message_with_cleanup(self),
        }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00",
        "Z",
    )


@contextmanager
def _environment(values: Mapping[str, str]) -> Iterator[None]:
    previous = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _json_bytes(value: Mapping[str, Any]) -> bytes:
    return json.dumps(
        dict(value),
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _sha256(value: bytes | str) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 fixture owner could not resolve {field}",
            resource=f"fixture:{field}",
        )
    return value.strip()


def _required_integer(value: Any, field: str) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < 1
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 fixture owner could not resolve {field}",
            resource=f"fixture:{field}",
        )
    return value


def _fixture_harness(
    client: FoundationRuntimeClient,
    method: str,
    payload: Mapping[str, Any] | None = None,
    *,
    timeout: float = 120,
) -> Mapping[str, Any]:
    previous = client.harness_namespace
    client.harness_namespace = "secure-content-fixture"
    try:
        result = client.harness(method, dict(payload or {}), timeout=timeout)
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 fixture owner action {method!r} failed",
            resource=f"fixture-action:{method}",
        ) from error
    finally:
        client.harness_namespace = previous
    if not isinstance(result, Mapping):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 fixture owner action {method!r} returned invalid data",
            resource=f"fixture-action:{method}",
        )
    return result


def _moments_harness(
    client: FoundationRuntimeClient,
    method: str,
    payload: Mapping[str, Any] | None = None,
    *,
    timeout: float = 120,
) -> Mapping[str, Any]:
    previous = client.harness_namespace
    client.harness_namespace = "moments"
    try:
        result = client.harness(method, dict(payload or {}), timeout=timeout)
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 Moments fixture action {method!r} failed",
            resource=f"fixture-action:{method}",
        ) from error
    finally:
        client.harness_namespace = previous
    if not isinstance(result, Mapping):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 Moments fixture action {method!r} returned invalid data",
            resource=f"fixture-action:{method}",
        )
    return result


def _register_runtime_account(
    station_url: str,
    *,
    role: str,
    suffix: str,
    password: str,
) -> str:
    account = f"sc-{role.replace('_', '-')}-{suffix}@testnet.local"
    request = urllib.request.Request(
        f"{station_url.rstrip('/')}/actor/sign-up",
        data=_json_bytes(
            {
                "email": account,
                "name": f"sc-{role}-{suffix}"[:20],
                "password": password,
            }
        ),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            status = response.status
            response.read()
    except urllib.error.HTTPError as error:
        status = error.code
        error.read()
    except (OSError, TimeoutError) as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 runtime account provisioning failed for role {role}",
            resource=f"fixture-account:{role}",
        ) from error
    if not 200 <= status < 300:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 runtime account provisioning returned HTTP {status} for role {role}",
            resource=f"fixture-account:{role}",
        )
    return account


def _provision_runtime_accounts(
    *,
    primary_station_url: str,
    run_id: str,
    roles: Sequence[str],
    secondary_station_url: str | None = None,
    secondary_roles: Sequence[str] = (),
) -> tuple[dict[str, str], str]:
    suffix = _sha256(f"{run_id}:{secrets.token_hex(16)}")[:10]
    password = f"W7Aa1!{suffix}"
    accounts = {
        role: _register_runtime_account(
            primary_station_url,
            role=role,
            suffix=suffix,
            password=password,
        )
        for role in roles
    }
    if secondary_roles:
        if secondary_station_url is None:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                "W7 secondary runtime accounts require a secondary Station",
                resource="fixture-account:secondary-station",
            )
        for role in secondary_roles:
            if role not in accounts:
                raise RuntimeOwnerBlocked(
                    "FIXTURE_OWNER_UNAVAILABLE",
                    f"W7 secondary runtime account role {role} is not provisioned",
                    resource=f"fixture-account:{role}",
                )
            _register_runtime_account(
                secondary_station_url,
                role=role,
                suffix=suffix,
                password=password,
            )
    return accounts, password


def _wait_for_device_enrollment(
    client: FoundationRuntimeClient,
) -> Mapping[str, Any]:
    try:
        return wait_until(
            lambda: _fixture_harness(
                client,
                "preparePublisherDeviceRevocation",
                timeout=15,
            ),
            f"{client.spec.profile} active messaging device enrollment",
            timeout=60,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 client {client.spec.profile} did not enroll an active device",
            resource=f"fixture-device:{client.spec.profile}",
        ) from error


def _prepare_accepted_friendship(
    alice: FoundationRuntimeClient,
    bob: FoundationRuntimeClient,
) -> None:
    alice_identity = _moments_harness(alice, "acceptanceActorIdentity")
    bob_identity = _moments_harness(bob, "acceptanceActorIdentity")
    alice_ptid = _required_text(alice_identity.get("actorPtid"), "alice-actor")
    bob_ptid = _required_text(bob_identity.get("actorPtid"), "bob-actor")
    if alice_ptid == bob_ptid:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "W7 Alice and Bob runtime accounts resolved the same actor",
            resource="fixture-account:mutual-friendship",
        )
    alice_authority = _moments_harness(alice, "friendshipAuthority")
    bob_authority = _moments_harness(bob, "friendshipAuthority")
    federation_id = _required_text(
        alice_authority.get("federationId"),
        "friendship-federation",
    )
    receiver_home_station = _required_text(
        bob_authority.get("homeStationPeerId"),
        "friendship-receiver-home-station",
    )
    if federation_id != _required_text(
        bob_authority.get("federationId"),
        "friendship-receiver-federation",
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "W7 Alice and Bob do not share one friendship Federation",
            resource="fixture-account:mutual-friendship",
        )
    sent = _moments_harness(
        alice,
        "sendFriendRequest",
        {
            "actorPtid": bob_ptid,
            "federationId": federation_id,
            "homeStationPeerId": receiver_home_station,
        },
    )
    _required_text(sent.get("requestId"), "friendship-request")
    accepted = _moments_harness(
        bob,
        "acceptFriendRequest",
        {"actorPtid": alice_ptid},
    )
    if accepted.get("accepted") is not True:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "W7 Bob did not accept Alice's friend request",
            resource="fixture-account:mutual-friendship",
        )


def _authenticate_running_client(
    client: FoundationRuntimeClient,
    *,
    account: str,
    password: str,
) -> None:
    previous = client.harness_namespace
    client.harness_namespace = "secure-content-fixture"

    def authenticate() -> bool:
        if not harness_ready(client.driver, "secure-content-fixture", timeout=5):
            return False
        result = client.harness(
            "restoreSessionWithPassword",
            {"account": account, "password": password},
            timeout=120,
        )
        return (
            isinstance(result, Mapping)
            and result.get("authenticated") is True
        )

    try:
        wait_until(
            authenticate,
            f"{client.spec.profile} account restoration",
            timeout=60,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W7 fixture owner could not restore client {client.spec.profile}",
            resource=f"client:{client.spec.profile}",
        ) from error
    finally:
        client.harness_namespace = previous


def _fixture_action_timeout(
    deadline_monotonic: float,
    cancellation: Any,
) -> float:
    if cancellation.is_set():
        raise RuntimeOwnerBlocked(
            "FIXTURE_CAPABILITY_UNAVAILABLE",
            "W7 fixture action was cancelled",
            resource="fixture:secure-content-w7",
        )
    remaining = deadline_monotonic - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("W7 fixture action deadline expired")
    return min(remaining, 120.0)


def _write_immutable_json(path: Path, payload: Mapping[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = _json_bytes(payload)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    return path


def _copy_immutable(path: Path, output: Path) -> tuple[dict[str, Any], dict[str, str]]:
    try:
        source = path.resolve(strict=True)
        raw = source.read_bytes()
        payload = json.loads(raw)
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"fixture owner manifest is unavailable: {error}",
            resource="fixture:secure-content-w7",
        ) from error
    if not isinstance(payload, dict):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "fixture owner manifest must be a JSON object",
            resource="fixture:secure-content-w7",
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    return payload, {
        "path": output.name,
        "sha256": _sha256(raw),
    }


def _validate_fixture(
    fixture: Mapping[str, Any],
    *,
    source_commit: str,
) -> None:
    content = dict(fixture)
    digest = content.pop("manifest_digest", None)
    handles = fixture.get("handles")
    capabilities: set[str] = set()
    handle_ids: set[str] = set()
    if isinstance(handles, list):
        for handle in handles:
            if not isinstance(handle, Mapping):
                continue
            capability = str(handle.get("capability") or "")
            handle_id = str(handle.get("opaque_id") or "")
            valid_owner = {
                "account-switch": "actor-session-provisioner",
                "station-switch": "environment-runtime-provisioner",
                "publisher-device-revocation": "actor-identity-provisioner",
                "historical-recovery-epoch": "recovery-key-exchange-provisioner",
            }.get(capability)
            if (
                not capability
                or not handle_id
                or handle_id in handle_ids
                or capability in capabilities
                or handle.get("kind") != f"{capability}-fixture"
                or handle.get("owner") != valid_owner
                or not isinstance(handle.get("expected_identity_digest"), str)
                or len(str(handle["expected_identity_digest"])) != 64
                or any(
                    character not in "0123456789abcdef"
                    for character in str(handle["expected_identity_digest"])
                )
                or (
                    capability == "historical-recovery-epoch"
                    and handle.get("secret_channel_ref")
                    != "w7-recovery-secret-channel"
                )
            ):
                raise RuntimeOwnerBlocked(
                    "FIXTURE_CAPABILITY_UNAVAILABLE",
                    "fixture owner manifest contains an invalid W7 handle",
                    resource="fixture:secure-content-w7",
                )
            capabilities.add(capability)
            handle_ids.add(handle_id)
    if (
        fixture.get("schema_version") != 1
        or fixture.get("kind") != runtime_manifest.FIXTURE_MANIFEST_KIND
        or fixture.get("source_checkpoint") != source_commit
        or digest != runtime_manifest.canonical_digest(content)
        or not REQUIRED_FIXTURE_CAPABILITIES.issubset(capabilities)
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_CAPABILITY_UNAVAILABLE",
            "fixture owner manifest is not source-bound or lacks W7 capabilities",
            resource="fixture:secure-content-w7",
        )


def _resolve_machine_profile(repo_root: Path) -> tuple[dict[str, Any], dict[str, str]]:
    process = subprocess.run(
        [
            "node",
            "tooling/scripts/local-dev/machine-dev.mjs",
            "resolve",
        ],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        resolved = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeOwnerBlocked(
            "PROFILE_AUTHORITY_UNAVAILABLE",
            "machine profile authority returned invalid JSON",
            resource="profile:four",
        ) from error
    binding = resolved.get("binding") if isinstance(resolved, Mapping) else None
    profile = resolved.get("profile") if isinstance(resolved, Mapping) else None
    if (
        process.returncode != 0
        or not isinstance(binding, Mapping)
        or not isinstance(profile, Mapping)
        or binding.get("profile") != PROFILE
        or binding.get("slot") != SLOT
        or profile.get("stationDeployEnvironment") != STATION_ID
    ):
        raise RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            "runtime owner requires the authoritative Profile four, slot 5 binding",
            resource="profile:four",
        )
    profile_path = Path(str(profile.get("profileFile") or ""))
    try:
        profile_env = load_env_file(profile_path)
    except (OSError, ValueError) as error:
        raise RuntimeOwnerBlocked(
            "PROFILE_AUTHORITY_UNAVAILABLE",
            f"cannot load Profile four: {error}",
            resource="profile:four",
        ) from error
    return dict(resolved), profile_env


def _resolve_secondary_profile(
    resolved: Mapping[str, Any],
) -> tuple[Path, dict[str, str]]:
    profile = resolved.get("profile")
    env_repo = (
        Path(str(profile.get("envRepo") or "")).resolve()
        if isinstance(profile, Mapping)
        else Path()
    )
    profile_path = (
        env_repo
        / "peers-touch"
        / SECONDARY_PROFILE
        / "profile.env.example"
    )
    relative_profile = profile_path.relative_to(env_repo)
    tracked = subprocess.run(
        ["git", "-C", str(env_repo), "ls-files", "--error-unmatch", str(relative_profile)],
        check=False,
        capture_output=True,
        text=True,
    )
    dirty = subprocess.run(
        [
            "git",
            "-C",
            str(env_repo),
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--",
            str(relative_profile.parent),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        values = load_env_file(profile_path)
    except (OSError, ValueError) as error:
        raise RuntimeOwnerBlocked(
            "PROFILE_AUTHORITY_UNAVAILABLE",
            f"cannot load approved secondary Profile {SECONDARY_PROFILE}",
            resource=f"profile:{SECONDARY_PROFILE}",
        ) from error
    if (
        tracked.returncode != 0
        or dirty.returncode != 0
        or dirty.stdout.strip()
        or values.get("PT_DEV_PROFILE") != SECONDARY_PROFILE
        or values.get("PT_STATION_DEPLOY_ENV") != SECONDARY_STATION_ID
        or not values.get("PT_STATION_URL")
    ):
        raise RuntimeOwnerBlocked(
            "PROFILE_AUTHORITY_UNAVAILABLE",
            f"secondary Profile {SECONDARY_PROFILE} is not reviewed and clean",
            resource=f"profile:{SECONDARY_PROFILE}",
        )
    return profile_path, values


def _stop_station_tunnel_or_raise(
    tunnel: SshTunnel,
    *,
    service_id: str,
) -> None:
    try:
        tunnel.stop()
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            f"Station tunnel cleanup failed for {service_id}: {error}",
            resource=f"station-tunnel:{service_id}",
        ) from error
    if tunnel.is_alive():
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            f"Station tunnel remains active for {service_id}",
            resource=f"station-tunnel:{service_id}",
        )


def _open_station_tunnels(
    bindings: Sequence[tuple[str, Mapping[str, str]]],
) -> tuple[ExitStack, dict[str, str]]:
    stack = ExitStack()
    endpoints: dict[str, str] = {}
    try:
        for service_id, profile_env in bindings:
            deployment_environment = str(
                profile_env.get("PT_STATION_DEPLOY_ENV") or ""
            )
            raw_port = str(profile_env.get("PT_STATION_PORT") or "")
            try:
                remote_port = int(raw_port)
            except ValueError as error:
                raise RuntimeOwnerBlocked(
                    "SERVICE_TRANSPORT_UNAVAILABLE",
                    f"Station port is invalid for {service_id}",
                    resource=f"station-tunnel:{service_id}",
                ) from error
            if not deployment_environment or not 1 <= remote_port <= 65535:
                raise RuntimeOwnerBlocked(
                    "SERVICE_TRANSPORT_UNAVAILABLE",
                    f"Station tunnel binding is invalid for {service_id}",
                    resource=f"station-tunnel:{service_id}",
                )
            try:
                tunnel = open_reviewed_remote_tunnel(
                    deployment_environment,
                    remote_port=remote_port,
                )
            except BlockedError as error:
                raise RuntimeOwnerBlocked(
                    "SERVICE_TRANSPORT_UNAVAILABLE",
                    error.reason,
                    resource=error.resource,
                ) from error
            stack.callback(
                _stop_station_tunnel_or_raise,
                tunnel,
                service_id=service_id,
            )
            endpoints[service_id] = f"http://127.0.0.1:{tunnel.local_port}"
    except BaseException as error:
        _close_runtime_stack(stack, primary_error=error)
        raise
    return stack, endpoints


def _activate_scenario_journey(
    repo_root: Path,
    journey_id: str,
    *,
    work_item_id: str = WORK_ITEM_ID,
    task_id: str = TASK_ID,
    command_runner: Any = subprocess.run,
) -> Mapping[str, Any]:
    status_process = command_runner(
        [
            "node",
            "tooling/scripts/local-dev/dev-work.mjs",
            "status",
            "--workspace-root",
            str(repo_root),
            "--work-item",
            work_item_id,
        ],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        status = json.loads(status_process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeOwnerBlocked(
            "DECLARATION_TRANSITION_FAILED",
            "W7 development declaration status is unavailable",
            resource=f"journey:{journey_id}",
        ) from error
    declarations = status.get("declarations") if isinstance(status, Mapping) else None
    active = [
        item
        for item in declarations
        if isinstance(item, Mapping) and item.get("state") == "ACTIVE"
    ] if isinstance(declarations, list) else []
    if (
        status_process.returncode != 0
        or len(active) != 1
        or active[0].get("workItemId") != work_item_id
        or active[0].get("planId") != PLAN_ID
        or active[0].get("taskId") != task_id
    ):
        raise RuntimeOwnerBlocked(
            "DECLARATION_TRANSITION_FAILED",
            "W7 functional declaration is not the active Plan task",
            resource=f"journey:{journey_id}",
        )
    session_id = active[0].get("sessionId")
    if not isinstance(session_id, str) or not session_id:
        raise RuntimeOwnerBlocked(
            "DECLARATION_TRANSITION_FAILED",
            "W7 functional declaration has no owning session",
            resource=f"journey:{journey_id}",
        )
    for action in ("update", "check"):
        command = [
            "node",
            "tooling/scripts/local-dev/dev-work.mjs",
            action,
            "--workspace-root",
            str(repo_root),
            "--work-item",
            work_item_id,
            "--session",
            session_id,
        ]
        if action == "update":
            command.extend(["--journey", journey_id])
        process = command_runner(
            command,
            cwd=repo_root,
            check=False,
            capture_output=True,
            text=True,
        )
        try:
            declaration = json.loads(process.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeOwnerBlocked(
                "DECLARATION_TRANSITION_FAILED",
                f"W7 declaration {action} returned invalid JSON",
                resource=f"journey:{journey_id}",
            ) from error
        if (
            process.returncode != 0
            or not isinstance(declaration, Mapping)
            or declaration.get("state") != "ACTIVE"
            or declaration.get("journeyId") != journey_id
            or declaration.get("sessionId") != session_id
        ):
            raise RuntimeOwnerBlocked(
                "DECLARATION_TRANSITION_FAILED",
                f"W7 declaration {action} did not bind Journey {journey_id}",
                resource=f"journey:{journey_id}",
            )
    return declaration


def _require_clean_source(
    repo_root: Path,
    result_root: Path,
) -> Mapping[str, str | int]:
    process = subprocess.run(
        [
            sys.executable,
            "tooling/scripts/verify-worktree-binding.py",
            "--root",
            str(repo_root),
            "--capture",
        ],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        identity = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            "worktree identity is unavailable",
            resource="source:workspace",
        ) from error
    if process.returncode != 0 or not isinstance(identity, dict):
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            "worktree identity is unavailable",
            resource="source:workspace",
        )
    for field in ("root", "workspaceId", "branch", "head"):
        if not isinstance(identity.get(field), str) or not identity[field]:
            raise RuntimeOwnerBlocked(
                "SOURCE_IDENTITY_MISMATCH",
                f"worktree identity is missing {field}",
                resource="source:workspace",
            )
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if status.strip():
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            "runtime manifests require a clean exact-source checkpoint",
            resource="source:workspace",
        )
    try:
        identity = resolve_runtime_source_identity(
            repo_root=repo_root,
            result_root=result_root,
            control_identity=identity,
        )
    except SourceProjectionError as error:
        raise RuntimeOwnerBlocked(
            "SOURCE_IDENTITY_MISMATCH",
            str(error),
            resource="source:plan-lifecycle",
        ) from error
    identity["worktreeSetDigest"] = _sha256(
        json.dumps(
            {
                "branch": identity["branch"],
                "controlHead": identity["controlHead"],
                "head": identity["head"],
                "root": str(repo_root.resolve()),
                "transitionDigest": identity["transitionDigest"],
                "workspaceId": identity["workspaceId"],
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return identity


def _free_port(start: int, reserved: set[int]) -> int:
    for port in range(start, start + 2000):
        if port in reserved:
            continue
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
        reserved.add(port)
        return port
    raise RuntimeOwnerBlocked(
        "CLIENT_RUNTIME_UNAVAILABLE",
        "no isolated client port is available",
        resource="client:ports",
    )


def _webdriver_endpoint(client: FoundationRuntimeClient) -> str:
    if client.spec.runtime == "native-tauri":
        return f"http://127.0.0.1:{client.spec.webdriver_port}"
    driver = client.driver
    config = getattr(getattr(driver, "command_executor", None), "_client_config", None)
    endpoint = getattr(config, "remote_server_addr", None)
    if not isinstance(endpoint, str) or not endpoint.startswith("http"):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            "Browser WebDriver endpoint is unavailable",
            resource=f"client:{client.spec.profile}",
        )
    return endpoint.rstrip("/")


def _storage_identity(path: Path) -> str:
    stat = path.resolve(strict=True).stat()
    return _sha256(f"{path.resolve()}:{stat.st_dev}:{stat.st_ino}")


def _client_payload(
    client_id: str,
    actor_role: str,
    client: FoundationRuntimeClient,
    snapshot: Mapping[str, Any],
    *,
    service_roles: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    actor_digest = snapshot.get("actorPtidSha256")
    if actor_role == "anonymous":
        actor_digest = _sha256("anonymous")
    if not isinstance(actor_digest, str):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"client {client_id} has no live actor identity",
            resource=f"client:{client_id}",
        )
    roles = dict(service_roles or {"station": STATION_ID})
    return {
        "id": client_id,
        "actor_role": actor_role,
        "actor_role_digest": actor_digest,
        "runtime_kind": client.spec.runtime,
        "required_service_roles": sorted(roles),
        "service_bindings": {
            role: {
                "service_id": service_id,
                "required_kind": "station",
            }
            for role, service_id in roles.items()
        },
        "storage_identity_digest": _storage_identity(client.spec.storage_root),
        "boot_identity": snapshot["bootIdentitySha256"],
        "session_generation": snapshot["sessionGeneration"],
    }


def _service_payload(
    attestation: Any,
    reference: Mapping[str, str],
    schema_attestation_reference: Mapping[str, str],
    *,
    profile_id: str,
    schema_attestation_endpoint: str,
) -> dict[str, Any]:
    return {
        "kind": attestation.service_kind,
        "profile_id": profile_id,
        "deployment_environment": attestation.deployment_environment,
        "endpoint": attestation.endpoint,
        "schema_attestation_endpoint": schema_attestation_endpoint,
        "live_commit": attestation.live_commit,
        "protocol_digest": attestation.protocol_digest,
        "runtime_identity": attestation.runtime_identity,
        "attestation_artifact_ref": dict(reference),
        "canonical_private_schema_attestation_ref": dict(
            schema_attestation_reference
        ),
    }


def _publish_attestation(
    root: Path,
    attestation: Any,
    *,
    run_id: str,
    journey_id: str,
    service_id: str,
    artifact_directory: str = "attestations",
) -> dict[str, str]:
    payload = {
        **attestation.to_dict(),
        "runId": run_id,
        "gateId": journey_id,
    }
    path = _write_immutable_json(
        root / artifact_directory / f"{service_id}.json",
        payload,
    )
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": _sha256(path.read_bytes()),
    }


def _resolve_canonical_private_schema_attestation(
    result_root: Path,
    repo_root: Path,
    identity: Mapping[str, str],
    attestation: Any,
    *,
    service_id: str,
    profile_id: str,
    attested_endpoint: str,
    accepted_intents: Sequence[str] = ("FINAL_CUT", "SCHEMA_ACTIVATION"),
    live_verifier: Callable[
        [runtime_manifest.CanonicalPrivateSchemaAttestationBinding],
        None,
    ]
    | None = None,
) -> runtime_manifest.CanonicalPrivateSchemaAttestationBinding:
    roots_by_intent = {
        "FINAL_CUT": (
            result_root / "W12" / "final-cut" / identity["head"] / profile_id
        ),
        "SCHEMA_ACTIVATION": (
            result_root / "W12A" / "activation" / identity["head"] / profile_id
        ),
    }
    if (
        not accepted_intents
        or len(set(accepted_intents)) != len(accepted_intents)
        or any(intent not in roots_by_intent for intent in accepted_intents)
    ):
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            "canonical private schema attestation intent policy is invalid",
            resource=f"schema-attestation:{service_id}",
        )
    roots = tuple(roots_by_intent[intent] for intent in accepted_intents)
    for root in roots:
        candidates = sorted(
            root.glob(
                "*/"
                + runtime_manifest.CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME
            )
        )
        if not candidates:
            continue
        if len(candidates) != 1:
            raise RuntimeOwnerBlocked(
                "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                (
                    f"{service_id} has {len(candidates)} canonical private "
                    "schema attestations for the exact source"
                ),
                resource=f"schema-attestation:{service_id}",
            )
        service = {
            "kind": attestation.service_kind,
            "profile_id": profile_id,
            "deployment_environment": attestation.deployment_environment,
            "endpoint": attested_endpoint,
            "live_commit": attestation.live_commit,
            "protocol_digest": attestation.protocol_digest,
            "runtime_identity": attestation.runtime_identity,
        }
        try:
            binding = runtime_manifest.load_canonical_private_schema_attestation(
                candidates[0],
                repo_root=repo_root,
                source_commit=identity["head"],
                workspace_id=identity["workspaceId"],
                service_id=service_id,
                profile_id=profile_id,
                deployment_environment=attestation.deployment_environment,
                station_runtime_identity=attestation.runtime_identity,
                service_attestation_digest=(
                    runtime_manifest.service_attestation_binding_digest(
                        service_id,
                        service,
                    )
                ),
            )
            if live_verifier is None:
                _verify_live_canonical_private_schema_attestation(
                    binding,
                    repo_root=repo_root,
                )
            else:
                live_verifier(binding)
            return binding
        except runtime_manifest.RuntimeManifestError as error:
            raise RuntimeOwnerBlocked(
                "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                str(error),
                resource=f"schema-attestation:{service_id}",
            ) from error
    raise RuntimeOwnerBlocked(
        "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
        (
            f"{service_id} has no canonical private schema attestation "
            "for the exact source"
        ),
        resource=f"schema-attestation:{service_id}",
    )


def _verify_live_canonical_private_schema_attestation(
    binding: runtime_manifest.CanonicalPrivateSchemaAttestationBinding,
    *,
    repo_root: Path,
    transport: ReviewedSchemaActivationTransport | None = None,
    command_runner: Any = subprocess.run,
) -> None:
    try:
        command = (
            transport
            or ReviewedSchemaActivationTransport(repo_root=repo_root)
        ).schema_verify_command(
            binding.payload,
            budget_seconds=120,
        )
    except ActivationTransportError as error:
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            (
                "reviewed live canonical private schema transport is "
                f"unavailable: {error}"
            ),
            resource="schema-attestation:live",
        ) from error
    try:
        completed = command_runner(
            command,
            cwd=repo_root,
            input=_json_bytes(binding.payload).decode("utf-8") + "\n",
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            f"live canonical private schema verification could not run: {error}",
            resource="schema-attestation:live",
        ) from error
    if completed.returncode != 0:
        diagnostic = (completed.stderr or completed.stdout)[-2000:].strip()
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            (
                "live canonical private schema verification failed with "
                f"exit code {completed.returncode}: {diagnostic}"
            ),
            resource="schema-attestation:live",
        )
    lines = [
        line
        for line in completed.stdout.splitlines()
        if line.strip()
    ]
    if len(lines) != 1:
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            "live canonical private schema verification returned invalid output",
            resource="schema-attestation:live",
        )
    try:
        response = json.loads(lines[0])
    except json.JSONDecodeError as error:
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            "live canonical private schema verification returned invalid JSON",
            resource="schema-attestation:live",
        ) from error
    if (
        not isinstance(response, Mapping)
        or _json_bytes(response) != _json_bytes(binding.payload)
    ):
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            "live canonical private schema verification changed the attestation",
            resource="schema-attestation:live",
        )


def _publish_canonical_private_schema_attestation(
    root: Path,
    service_id: str,
    binding: runtime_manifest.CanonicalPrivateSchemaAttestationBinding,
) -> dict[str, str]:
    target_root = root / "schema-attestations" / service_id
    artifacts = (
        (binding.path, binding.raw_bytes),
        *binding.provenance_files,
    )
    reference: dict[str, str] | None = None
    for source, raw_bytes in artifacts:
        target = target_root / source.name
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(
            target,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            0o600,
        )
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw_bytes)
            handle.flush()
            os.fsync(handle.fileno())
        if source == binding.path:
            reference = {
                "path": target.relative_to(root).as_posix(),
                "sha256": _sha256(raw_bytes),
            }
    if reference is None:
        raise RuntimeOwnerBlocked(
            "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
            f"{service_id} schema attestation copy is incomplete",
            resource=f"schema-attestation:{service_id}",
        )
    return reference


def _make_client(
    *,
    repo_root: Path,
    runtime_root: Path,
    station_url: str,
    profile_env: Mapping[str, str],
    source_commit: str,
    client_id: str,
    runtime_kind: str,
    port_bases: tuple[int, int, int],
    reserved_ports: set[int],
) -> FoundationRuntimeClient:
    gateway = _free_port(port_bases[0], reserved_ports)
    renderer = _free_port(port_bases[1], reserved_ports)
    webdriver = _free_port(port_bases[2], reserved_ports)
    return FoundationRuntimeClient(
        FoundationClientSpec(
            runtime=runtime_kind,
            worktree=repo_root,
            gateway_port=gateway,
            renderer_port=renderer,
            webdriver_port=webdriver,
            storage_root=runtime_root / "clients" / client_id / "run" / "storage",
            profile=f"secure-content-{runtime_kind}-{client_id}",
        ),
        station_url=station_url,
        profile_env={
            **profile_env,
            "PT_BUILD_SOURCE_COMMIT": source_commit,
        },
        harness_namespace="agent",
        launch_env={
            "PT_BUILD_SOURCE_COMMIT": source_commit,
            "PT_SECURE_CONTENT_RUNTIME_OWNER": "1",
        },
        direct_station_binding=True,
    )


def _wait_for_moments_snapshot(
    client: FoundationRuntimeClient,
) -> Mapping[str, Any]:
    client.harness_namespace = "moments"
    if not harness_ready(client.driver, "moments", timeout=60):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"client {client.spec.profile} has no Moments harness",
            resource=f"client:{client.spec.profile}",
        )
    try:
        snapshot = wait_until(
            lambda: client.harness("snapshot", timeout=10),
            f"{client.spec.profile} Moments runtime readiness",
            timeout=60,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            redact_text(
                f"client {client.spec.profile} Moments runtime did not become "
                f"ready: {_error_message_with_cleanup(error)}"
            ),
            resource=f"client:{client.spec.profile}",
        ) from error
    if not isinstance(snapshot, Mapping):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"client {client.spec.profile} returned an invalid snapshot",
            resource=f"client:{client.spec.profile}",
        )
    return snapshot


def _start_client(
    client: FoundationRuntimeClient,
    *,
    account: str | None,
    password: str,
) -> Mapping[str, Any]:
    client.start()
    client.configure_station()
    if account is not None:
        _authenticate_running_client(
            client,
            account=account,
            password=password,
        )
    return _wait_for_moments_snapshot(client)


def _manifest_payload(
    *,
    identity: Mapping[str, str],
    journey_id: str,
    run_id: str,
    services: Mapping[str, Mapping[str, Any]],
    fixture_ref: Mapping[str, str],
    fixture_digest: str,
    clients: Sequence[Mapping[str, Any]],
    continuation: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema_version": runtime_manifest.SCHEMA_VERSION,
        "kind": runtime_manifest.MANIFEST_KIND,
        "run_id": run_id,
        "journey_id": journey_id,
        "source": {
            "canonical_worktree": str(identity["root"]),
            "workspace_id": identity["workspaceId"],
            "commit": identity["head"],
            "worktree_set_digest": identity["worktreeSetDigest"],
            "workspace_digest": "clean",
        },
        "controller_binding": {"profile_id": PROFILE, "slot": SLOT},
        "services": {
            service_id: dict(service)
            for service_id, service in services.items()
        },
        "clients": [dict(client) for client in clients],
        "fixture_manifest_ref": dict(fixture_ref),
        "fixture_manifest_digest": fixture_digest,
        "lifecycle_observer_capabilities": sorted(
            runtime_manifest.LIFECYCLE_OBSERVER_CAPABILITIES
        ),
        "created_at": _utc_now(),
    }
    if continuation is not None:
        payload["continuation"] = dict(continuation)
    return payload


def _continuation_run_id(parent_run_id: str, restart_request_id: str) -> str:
    return (
        f"{parent_run_id}-c-"
        f"{_sha256(f'{parent_run_id}:{restart_request_id}')[:12]}"
    )


def _continuation_services(
    root: Path,
    *,
    run_id: str,
    journey_id: str,
    services: Mapping[str, Mapping[str, Any]],
    attestations: Mapping[str, Any],
) -> dict[str, dict[str, Any]]:
    return {
        service_id: {
            **dict(service),
            "attestation_artifact_ref": _publish_attestation(
                root,
                attestations[service_id],
                run_id=run_id,
                journey_id=journey_id,
                service_id=service_id,
                artifact_directory="continuation-attestations",
            ),
        }
        for service_id, service in services.items()
    }


def _stage_continuation_evidence(
    *,
    blocked_result_path: Path,
    request_path: Path,
    child_run_id: str,
    client_id: str,
    acknowledgement: Mapping[str, Any],
) -> Path:
    parent_artifact_dir = blocked_result_path.parent
    child_artifact_dir = parent_artifact_dir.parent / child_run_id
    resume_path = parent_artifact_dir / "desktop-pilot-resume.json"
    for source in (blocked_result_path, resume_path, request_path):
        try:
            raw = source.read_bytes()
        except OSError as error:
            raise RuntimeOwnerBlocked(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                f"continuation evidence is unavailable: {source.name}",
                resource=f"client:{client_id}",
            ) from error
        child_artifact_dir.mkdir(parents=True, exist_ok=True)
        target = child_artifact_dir / source.name
        descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    _write_immutable_json(
        child_artifact_dir / f"restart-acknowledgement-{client_id}.json",
        acknowledgement,
    )
    return child_artifact_dir


def _fixture_binding_id(
    run_id: str,
    capability: str,
    identity_digest: str,
) -> str:
    return (
        f"w7-{capability}-"
        f"{_sha256(f'{run_id}:{capability}:{identity_digest}')[:20]}"
    )


def _build_fixture_owner(
    *,
    identity: Mapping[str, str],
    run_id: str,
    secondary_station_url: str,
    password: str,
    accounts: Mapping[str, str],
    desktop: Mapping[str, FoundationRuntimeClient],
) -> W7FixtureOwner:
    alice = desktop[DESKTOP_CLIENTS[0][0]]
    bob = desktop[DESKTOP_CLIENTS[1][0]]
    eve = desktop[DESKTOP_CLIENTS[2][0]]
    pin = f"{secrets.randbelow(100_000_000):08d}"

    account = _fixture_harness(
        eve,
        "prepareAccountSwitch",
        {
            "secondaryAccount": accounts[DESKTOP_CLIENTS[0][2]],
            "password": password,
            "pin": pin,
        },
    )
    primary_account_id = _required_text(
        account.get("primaryAccountId"),
        "account-switch-primary-account",
    )
    secondary_account_id = _required_text(
        account.get("secondaryAccountId"),
        "account-switch-secondary-account",
    )
    primary_actor_ptid = _required_text(
        account.get("primaryActorPtid"),
        "account-switch-primary-actor",
    )
    secondary_actor_ptid = _required_text(
        account.get("secondaryActorPtid"),
        "account-switch-secondary-actor",
    )
    primary_storage_identity = _required_text(
        account.get("primaryStorageIdentitySha256"),
        "account-switch-primary-storage",
    )
    secondary_storage_identity = _required_text(
        account.get("secondaryStorageIdentitySha256"),
        "account-switch-secondary-storage",
    )
    if (
        len(primary_storage_identity) != 64
        or len(secondary_storage_identity) != 64
        or primary_storage_identity == secondary_storage_identity
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "account-switch fixture storage identities are invalid",
            resource="fixture:account-switch",
        )
    account_identity = fixture_identity_digest(
        {
            "capability": "account-switch",
            "clientId": DESKTOP_CLIENTS[2][0],
            "primaryAccountIdSha256": _sha256(primary_account_id),
            "primaryActorPtidSha256": _sha256(primary_actor_ptid),
            "primaryStorageIdentitySha256": primary_storage_identity,
            "secondaryAccountIdSha256": _sha256(secondary_account_id),
            "secondaryActorPtidSha256": _sha256(secondary_actor_ptid),
            "secondaryStorageIdentitySha256": secondary_storage_identity,
            "sourceCheckpoint": identity["head"],
        }
    )
    _authenticate_running_client(
        alice,
        account=accounts[DESKTOP_CLIENTS[0][2]],
        password=password,
    )

    station = _fixture_harness(
        bob,
        "prepareStationSwitch",
        {"secondaryStationUrl": secondary_station_url},
    )
    primary_station_url = _required_text(
        station.get("primaryStationUrl"),
        "station-switch-primary-url",
    )
    secondary_station_url = _required_text(
        station.get("secondaryStationUrl"),
        "station-switch-secondary-url",
    )
    primary_station_peer_id = _required_text(
        station.get("primaryStationPeerId"),
        "station-switch-primary-peer",
    )
    secondary_station_peer_id = _required_text(
        station.get("secondaryStationPeerId"),
        "station-switch-secondary-peer",
    )
    station_identity = fixture_identity_digest(
        {
            "capability": "station-switch",
            "clientId": DESKTOP_CLIENTS[1][0],
            "primaryStationIdentitySha256": _sha256(
                f"{primary_station_peer_id}:{primary_station_url}"
            ),
            "secondaryStationIdentitySha256": _sha256(
                f"{secondary_station_peer_id}:{secondary_station_url}"
            ),
            "sourceCheckpoint": identity["head"],
        }
    )

    publisher = _fixture_harness(
        alice,
        "preparePublisherDeviceRevocation",
    )
    publisher_actor_ptid = _required_text(
        publisher.get("actorPtid"),
        "publisher-device-actor",
    )
    publisher_device_id = _required_text(
        publisher.get("deviceId"),
        "publisher-device-id",
    )
    publisher_profile_version = _required_text(
        publisher.get("observedProfileVersion"),
        "publisher-device-profile-version",
    )
    publisher_identity = fixture_identity_digest(
        {
            "actorPtidSha256": _sha256(publisher_actor_ptid),
            "capability": "publisher-device-revocation",
            "clientId": DESKTOP_CLIENTS[0][0],
            "deviceIdSha256": _sha256(publisher_device_id),
            "observedProfileVersion": publisher_profile_version,
            "sourceCheckpoint": identity["head"],
        }
    )

    publisher_recovery = _fixture_harness(
        alice,
        "prepareHistoricalRecoveryEpoch",
    )
    publisher_recovery_actor_ptid = _required_text(
        publisher_recovery.get("actorPtid"),
        "publisher-recovery-actor",
    )
    if publisher_recovery_actor_ptid != publisher_actor_ptid:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "publisher recovery actor does not match the publisher fixture",
            resource="fixture:publisher-recovery-actor",
        )
    _required_text(
        publisher_recovery.get("backupId"),
        "publisher-recovery-backup",
    )
    _required_integer(
        publisher_recovery.get("recoveryEpoch"),
        "publisher-recovery-epoch",
    )
    _required_integer(
        publisher_recovery.get("recoveryPreKeyAvailable"),
        "publisher-recovery-prekey-availability",
    )

    recovery = _fixture_harness(
        bob,
        "prepareHistoricalRecoveryEpoch",
    )
    recovery_actor_ptid = _required_text(
        recovery.get("actorPtid"),
        "historical-recovery-actor",
    )
    recovery_backup_id = _required_text(
        recovery.get("backupId"),
        "historical-recovery-backup",
    )
    recovery_epoch = _required_integer(
        recovery.get("recoveryEpoch"),
        "historical-recovery-epoch",
    )
    _required_integer(
        recovery.get("recoveryPreKeyAvailable"),
        "historical-recovery-prekey-availability",
    )
    recovery_identity = fixture_identity_digest(
        {
            "actorPtidSha256": _sha256(recovery_actor_ptid),
            "backupIdSha256": _sha256(recovery_backup_id),
            "capability": "historical-recovery-epoch",
            "recoveryEpoch": recovery_epoch,
            "sourceCheckpoint": identity["head"],
        }
    )

    def account_action(
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: Any,
    ) -> Mapping[str, object]:
        if payload:
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "account-switch action does not accept scenario-owned input",
                resource="fixture:account-switch",
            )
        result = _fixture_harness(
            eve,
            "roundTripAccountSwitch",
            {
                "primaryAccountId": primary_account_id,
                "primaryActorPtid": primary_actor_ptid,
                "primaryStorageIdentitySha256": primary_storage_identity,
                "secondaryAccountId": secondary_account_id,
                "secondaryActorPtid": secondary_actor_ptid,
                "secondaryStorageIdentitySha256": secondary_storage_identity,
                "pin": pin,
            },
            timeout=_fixture_action_timeout(deadline_monotonic, cancellation),
        )
        primary_actor_digest = _sha256(primary_actor_ptid)
        secondary_actor_digest = _sha256(secondary_actor_ptid)
        completed = (
            result.get("staleProjectionCleared") is True
            and result.get("primaryActorPtidSha256") == primary_actor_digest
            and result.get("secondaryActorPtidSha256") == secondary_actor_digest
            and result.get("primaryStorageIdentitySha256")
            == primary_storage_identity
            and result.get("secondaryStorageIdentitySha256")
            == secondary_storage_identity
        )
        return {
            "completed": completed,
            "fixtureIdentityDigest": account_identity,
            "primaryActorIdentitySha256": primary_actor_digest,
            "primaryStorageIdentitySha256": primary_storage_identity,
            "secondaryActorIdentitySha256": secondary_actor_digest,
            "secondaryStorageIdentitySha256": secondary_storage_identity,
            "sessionGenerationAdvanced": (
                isinstance(result.get("beforeGeneration"), int)
                and isinstance(result.get("afterGeneration"), int)
                and int(result["afterGeneration"])
                > int(result["beforeGeneration"])
            ),
        }

    def station_action(
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: Any,
    ) -> Mapping[str, object]:
        if payload:
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "station-switch action does not accept scenario-owned input",
                resource="fixture:station-switch",
            )
        result = _fixture_harness(
            bob,
            "roundTripStationSwitch",
            {
                "account": accounts[DESKTOP_CLIENTS[1][2]],
                "password": password,
                "primaryStationUrl": primary_station_url,
                "secondaryStationUrl": secondary_station_url,
            },
            timeout=_fixture_action_timeout(deadline_monotonic, cancellation),
        )
        primary_station_digest = _sha256(
            f"{primary_station_peer_id}:{primary_station_url}"
        )
        secondary_station_digest = _sha256(
            f"{secondary_station_peer_id}:{secondary_station_url}"
        )
        return {
            "completed": (
                isinstance(result.get("generationBefore"), int)
                and isinstance(result.get("generationAfter"), int)
                and int(result["generationAfter"])
                > int(result["generationBefore"])
                and result.get("primaryStationIdentitySha256")
                == primary_station_digest
                and result.get("secondaryStationIdentitySha256")
                == secondary_station_digest
            ),
            "fixtureIdentityDigest": station_identity,
            "primaryStationIdentitySha256": primary_station_digest,
            "secondaryStationIdentitySha256": secondary_station_digest,
        }

    def revoke_action(
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: Any,
    ) -> Mapping[str, object]:
        if payload:
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "device-revocation action does not accept scenario-owned input",
                resource="fixture:publisher-device-revocation",
            )
        result = _fixture_harness(
            alice,
            "revokePublisherDevice",
            {
                "deviceId": publisher_device_id,
                "observedProfileVersion": publisher_profile_version,
            },
            timeout=_fixture_action_timeout(deadline_monotonic, cancellation),
        )
        actor_digest = _sha256(publisher_actor_ptid)
        device_digest = _sha256(publisher_device_id)
        return {
            "completed": (
                result.get("revoked") is True
                and result.get("actorPtidSha256") == actor_digest
                and result.get("deviceIdSha256") == device_digest
                and result.get("observedProfileVersion")
                == publisher_profile_version
                and result.get("committedProfileVersion")
                == publisher_profile_version
            ),
            "fixtureIdentityDigest": publisher_identity,
            "actorIdentitySha256": actor_digest,
            "deviceIdentitySha256": device_digest,
            "observedProfileVersion": result.get("observedProfileVersion"),
            "committedProfileVersion": result.get("committedProfileVersion"),
        }

    def recovery_action(
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: Any,
    ) -> Mapping[str, object]:
        if payload:
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "recovery-epoch action does not accept scenario-owned input",
                resource="fixture:historical-recovery-epoch",
            )
        result = _fixture_harness(
            bob,
            "advanceHistoricalRecoveryEpoch",
            {
                "expectedEpoch": recovery_epoch,
            },
            timeout=_fixture_action_timeout(deadline_monotonic, cancellation),
        )
        actor_digest = _sha256(recovery_actor_ptid)
        return {
            "completed": (
                result.get("actorPtidSha256") == actor_digest
                and result.get("previousEpoch") == recovery_epoch
                and result.get("currentEpoch") == recovery_epoch + 1
                and isinstance(result.get("recoveryPreKeyAvailable"), int)
                and int(result["recoveryPreKeyAvailable"]) > 0
            ),
            "fixtureIdentityDigest": recovery_identity,
            "actorIdentitySha256": actor_digest,
            "backupIdentitySha256": result.get("backupIdSha256"),
            "previousEpoch": result.get("previousEpoch"),
            "currentEpoch": result.get("currentEpoch"),
        }

    return W7FixtureOwner(
        source_checkpoint=identity["head"],
        run_id=run_id,
        bindings=(
            W7FixtureBinding(
                capability="account-switch",
                opaque_id=_fixture_binding_id(
                    run_id,
                    "account-switch",
                    account_identity,
                ),
                expected_identity_digest=account_identity,
                action=account_action,
                sensitive_values=(
                    pin,
                    primary_account_id,
                    primary_actor_ptid,
                    secondary_account_id,
                    secondary_actor_ptid,
                ),
            ),
            W7FixtureBinding(
                capability="station-switch",
                opaque_id=_fixture_binding_id(
                    run_id,
                    "station-switch",
                    station_identity,
                ),
                expected_identity_digest=station_identity,
                action=station_action,
            ),
            W7FixtureBinding(
                capability="publisher-device-revocation",
                opaque_id=_fixture_binding_id(
                    run_id,
                    "publisher-device-revocation",
                    publisher_identity,
                ),
                expected_identity_digest=publisher_identity,
                action=revoke_action,
                sensitive_values=(
                    publisher_actor_ptid,
                    publisher_device_id,
                ),
            ),
            W7FixtureBinding(
                capability="historical-recovery-epoch",
                opaque_id=_fixture_binding_id(
                    run_id,
                    "historical-recovery-epoch",
                    recovery_identity,
                ),
                expected_identity_digest=recovery_identity,
                action=recovery_action,
                sensitive_values=(
                    recovery_actor_ptid,
                    recovery_backup_id,
                ),
                secret_channel_ref="w7-recovery-secret-channel",
            ),
        ),
    )


def _close_fixture_action_channel(
    context: EphemeralGateLaunchContext,
    client: EphemeralGateClient,
) -> None:
    failures: list[str] = []
    try:
        client.close()
    except Exception as error:
        failures.append(f"client close: {error}")
    try:
        context.quiesce()
    except Exception as error:
        failures.append(f"context quiesce: {error}")
    result = None
    try:
        result = context.close()
    except Exception as error:
        failures.append(f"context close: {error}")
    if failures or result is None or not result.succeeded:
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            "W7 fixture action channel did not close cleanly"
            + (f": {'; '.join(failures)}" if failures else ""),
            resource="fixture:secure-content-w7",
        )


def _stop_client_or_raise(
    client: FoundationRuntimeClient,
    *,
    purpose: str,
    active_client_ids: set[int],
) -> None:
    client_identity = id(client)
    if client_identity not in active_client_ids:
        return
    cleanup = client.stop()
    if cleanup["status"] != "clean":
        failures = cleanup.get("failures")
        detail = (
            "; ".join(str(item) for item in failures)
            if isinstance(failures, list) and failures
            else "cleanup owner returned no failure detail"
        )
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            redact_text(
                f"{purpose} cleanup failed for {client.spec.profile}: {detail}"
            ),
            resource=f"client:{client.spec.profile}",
        )
    active_client_ids.discard(client_identity)


def _close_runtime_stack(
    stack: ExitStack,
    *,
    primary_error: BaseException | None = None,
) -> None:
    try:
        stack.close()
    except BaseException as cleanup_error:
        if primary_error is None:
            raise
        cleanup_code = getattr(
            cleanup_error,
            "code",
            type(cleanup_error).__name__,
        )
        cleanup_note = (
            f"secondary runtime cleanup failure: {cleanup_code}: "
            f"{redact_text(str(cleanup_error))}"
        )
        existing = tuple(
            getattr(primary_error, "secondary_cleanup_failures", ())
        )
        setattr(
            primary_error,
            "secondary_cleanup_failures",
            (*existing, cleanup_note),
        )
        add_note = getattr(primary_error, "add_note", None)
        if callable(add_note):
            add_note(cleanup_note)


@contextmanager
def _runtime_cleanup_scope(stack: ExitStack) -> Iterator[ExitStack]:
    try:
        yield stack
    except BaseException as primary_error:
        _close_runtime_stack(stack, primary_error=primary_error)
        raise
    else:
        _close_runtime_stack(stack)


@contextmanager
def _restart_lease(
    runtime_root: Path,
    *,
    request_id: str,
    client_id: str,
) -> Iterator[tuple[str, str, str]]:
    path = runtime_root / "leases" / f"{client_id}.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeOwnerBlocked(
                "RUNTIME_LEASE_UNAVAILABLE",
                f"restart lease is unavailable for {client_id}",
                resource=f"client.storage:{client_id}",
            ) from error
        acquired = datetime.now(timezone.utc)
        expires = acquired + timedelta(minutes=20)
        lease_id = f"{request_id}-{os.getpid()}-{path.stat().st_ino}"
        yield (
            lease_id,
            acquired.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            expires.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        )


class W7RuntimeOwner:
    def __init__(
        self,
        *,
        repo_root: Path,
        result_root: Path,
    ) -> None:
        self.repo_root = repo_root.resolve(strict=True)
        self.result_root = result_root.resolve()
        self.runtime_root = self.result_root / "runtime-owner"

    def preflight(self) -> dict[str, Any]:
        identity = _require_clean_source(self.repo_root, self.result_root)
        resolved, _profile_env = _resolve_machine_profile(self.repo_root)
        _secondary_profile_path, secondary_profile_env = (
            _resolve_secondary_profile(resolved)
        )
        return {
            "status": "READY",
            "proofState": "UNPROVEN",
            "workspaceId": identity["workspaceId"],
            "sourceCommit": identity["head"],
            "profile": resolved["binding"]["profile"],
            "slot": resolved["binding"]["slot"],
            "station": resolved["profile"]["stationUrl"],
            "secondaryProfile": SECONDARY_PROFILE,
            "secondaryStation": secondary_profile_env["PT_STATION_URL"],
            "fixtureOwner": "runtime-bound",
        }

    def run(self) -> dict[str, Any]:
        identity = _require_clean_source(self.repo_root, self.result_root)
        resolved, profile_env = _resolve_machine_profile(self.repo_root)
        _secondary_profile_path, secondary_profile_env = (
            _resolve_secondary_profile(resolved)
        )
        run_id = f"w7-{identity['head'][:12]}-{os.getpid()}"
        owner_root = self.runtime_root / run_id
        acceptance_run_id = (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            + "-"
            + _sha256(run_id)[:32]
        )
        attestation_store = owner_root / "attestation-store"
        (
            attestation_store
            / identity["workspaceId"]
            / DESKTOP_JOURNEY
            / acceptance_run_id
        ).mkdir(parents=True, mode=0o700)
        transport_stack, station_endpoints = _open_station_tunnels(
            (
                (STATION_ID, profile_env),
                (SECONDARY_STATION_ID, secondary_profile_env),
            )
        )
        station_url = station_endpoints[STATION_ID]
        secondary_station_url = station_endpoints[SECONDARY_STATION_ID]
        try:
            with _environment(
                {
                    "PT_ACCEPTANCE_ARTIFACT_ROOT": str(attestation_store),
                    "PT_ACCEPTANCE_WORKSPACE_ID": identity["workspaceId"],
                    "PT_ACCEPTANCE_GATE_ID": DESKTOP_JOURNEY,
                    "PT_ACCEPTANCE_RUN_ID": acceptance_run_id,
                }
            ):
                attestation = produce_station_attestation(
                    environment_id="secure-content-w7-runtime",
                    run_id=run_id,
                    service_id=STATION_ID,
                    station_url=station_url,
                    profile_env=profile_env,
                    require_runtime_identity=True,
                    remote_source_identity_provider=resolve_remote_source_identity,
                )
                secondary_attestation = produce_station_attestation(
                    environment_id="secure-content-w7-runtime",
                    run_id=run_id,
                    service_id=SECONDARY_STATION_ID,
                    station_url=secondary_station_url,
                    profile_env=secondary_profile_env,
                    require_runtime_identity=True,
                    remote_source_identity_provider=resolve_remote_source_identity,
                )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            reason = _error_message_with_cleanup(error)
            resource = (
                error.resource
                if isinstance(error, BlockedError)
                else "station:station-four"
            )
            raise RuntimeOwnerBlocked(
                "SERVICE_ATTESTATION_UNAVAILABLE",
                reason,
                resource=resource,
            ) from error
        if (
            not commits_match(attestation.live_commit, identity["head"])
            or attestation.protocol_digest != source_proto_digest(self.repo_root)
            or not commits_match(
                secondary_attestation.live_commit,
                identity["head"],
            )
            or secondary_attestation.protocol_digest
            != source_proto_digest(self.repo_root)
        ):
            error = RuntimeOwnerBlocked(
                "SOURCE_ATTESTATION_MISMATCH",
                "W7 Stations are not deployed from the exact source",
                resource="station:secure-content-w7",
            )
            _close_runtime_stack(transport_stack, primary_error=error)
            raise error

        try:
            schema_attestation = (
                _resolve_canonical_private_schema_attestation(
                    self.result_root,
                    self.repo_root,
                    identity,
                    attestation,
                    service_id=STATION_ID,
                    profile_id=PROFILE,
                    attested_endpoint=profile_env["PT_STATION_URL"],
                )
            )
            secondary_schema_attestation = (
                _resolve_canonical_private_schema_attestation(
                    self.result_root,
                    self.repo_root,
                    identity,
                    secondary_attestation,
                    service_id=SECONDARY_STATION_ID,
                    profile_id=SECONDARY_PROFILE,
                    attested_endpoint=secondary_profile_env["PT_STATION_URL"],
                )
            )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise

        with _runtime_cleanup_scope(transport_stack) as stack:
            _activate_scenario_journey(self.repo_root, DESKTOP_JOURNEY)
            accounts, password = _provision_runtime_accounts(
                primary_station_url=station_url,
                secondary_station_url=secondary_station_url,
                run_id=run_id,
                roles=("alice", "bob", "eve", "browser_actor"),
                secondary_roles=("bob",),
            )
            reserved_ports: set[int] = set()
            active_client_ids: set[int] = set()
            desktop: dict[str, FoundationRuntimeClient] = {}
            for index, (client_id, actor, account_role) in enumerate(DESKTOP_CLIENTS):
                client = _make_client(
                    repo_root=self.repo_root,
                    runtime_root=owner_root,
                    station_url=station_url,
                    profile_env=profile_env,
                    source_commit=str(identity["head"]),
                    client_id=client_id,
                    runtime_kind="native-tauri",
                    port_bases=(3530 + index * 20, 3710 + index * 20, 4495 + index * 20),
                    reserved_ports=reserved_ports,
                )
                stack.callback(
                    _stop_client_or_raise,
                    client,
                    purpose="Desktop",
                    active_client_ids=active_client_ids,
                )
                active_client_ids.add(id(client))
                _start_client(
                    client,
                    account=accounts[account_role],
                    password=password,
                )
                _wait_for_device_enrollment(client)
                desktop[client_id] = client

            _prepare_accepted_friendship(
                desktop[DESKTOP_CLIENTS[0][0]],
                desktop[DESKTOP_CLIENTS[1][0]],
            )
            fixture_owner = _build_fixture_owner(
                identity=identity,
                run_id=run_id,
                secondary_station_url=secondary_station_url,
                password=password,
                accounts=accounts,
                desktop=desktop,
            )
            fixture_path = fixture_owner.write_manifest(
                owner_root / "fixture.json"
            )
            fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
            _validate_fixture(fixture, source_commit=identity["head"])
            fixture_ref = {
                "path": fixture_path.name,
                "sha256": _sha256(fixture_path.read_bytes()),
            }
            fixture_digest = str(fixture["manifest_digest"])

            desktop_payloads: list[dict[str, Any]] = []
            for client_id, actor, _account_role in DESKTOP_CLIENTS:
                client = desktop[client_id]
                previous_namespace = client.harness_namespace
                client.harness_namespace = "moments"
                try:
                    snapshot = client.harness("snapshot", timeout=60)
                finally:
                    client.harness_namespace = previous_namespace
                desktop_payloads.append(
                    _client_payload(
                        client_id,
                        actor,
                        client,
                        snapshot,
                        service_roles={
                            "station": STATION_ID,
                            "station-secondary": SECONDARY_STATION_ID,
                        },
                    )
                )

            desktop_dir = owner_root / "desktop"
            desktop_fixture_ref = self._copy_fixture_into(
                owner_root / fixture_ref["path"],
                desktop_dir,
            )
            desktop_attestation_ref = _publish_attestation(
                desktop_dir,
                attestation,
                run_id=run_id,
                journey_id=DESKTOP_JOURNEY,
                service_id=STATION_ID,
            )
            desktop_secondary_attestation_ref = _publish_attestation(
                desktop_dir,
                secondary_attestation,
                run_id=run_id,
                journey_id=DESKTOP_JOURNEY,
                service_id=SECONDARY_STATION_ID,
            )
            desktop_schema_attestation_ref = (
                _publish_canonical_private_schema_attestation(
                    desktop_dir,
                    STATION_ID,
                    schema_attestation,
                )
            )
            desktop_secondary_schema_attestation_ref = (
                _publish_canonical_private_schema_attestation(
                    desktop_dir,
                    SECONDARY_STATION_ID,
                    secondary_schema_attestation,
                )
            )
            services = {
                STATION_ID: _service_payload(
                    attestation,
                    desktop_attestation_ref,
                    desktop_schema_attestation_ref,
                    profile_id=PROFILE,
                    schema_attestation_endpoint=profile_env[
                        "PT_STATION_URL"
                    ],
                ),
                SECONDARY_STATION_ID: _service_payload(
                    secondary_attestation,
                    desktop_secondary_attestation_ref,
                    desktop_secondary_schema_attestation_ref,
                    profile_id=SECONDARY_PROFILE,
                    schema_attestation_endpoint=secondary_profile_env[
                        "PT_STATION_URL"
                    ],
                ),
            }
            parent_path = write_attached_runtime_manifest(
                manifest_payload=_manifest_payload(
                    identity=identity,
                    journey_id=DESKTOP_JOURNEY,
                    run_id=run_id,
                    services=services,
                    fixture_ref=desktop_fixture_ref,
                    fixture_digest=fixture_digest,
                    clients=desktop_payloads,
                ),
                output_path=desktop_dir / "runtime-parent.json",
                journey_id=DESKTOP_JOURNEY,
                sessions_by_client=desktop,
                automation_refs_by_client={
                    client_id: {
                        "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
                        "endpoint": _webdriver_endpoint(client),
                        "session_id": str(client.driver.session_id),
                    }
                    for client_id, client in desktop.items()
                },
                repo_root=self.repo_root,
            )
            blocked_result_path: Path | None = None
            try:
                execute_scenario(
                    runtime="desktop",
                    scenario_id="desktop-pilot",
                    budget_seconds=1200,
                    repo_root=self.repo_root,
                    profile=None,
                    profiles=(PROFILE, SECONDARY_PROFILE),
                    clients=tuple(item[0] for item in DESKTOP_CLIENTS),
                    runtime_manifest_path=parent_path,
                    result_root=self.result_root,
                    workspace_identity=identity,
                )
            except ScenarioBlocked as error:
                if error.kind != "BLOCKED_RUNTIME_ACTION_REQUIRED":
                    raise
                blocked_result_path = error.result_path
            if blocked_result_path is None:
                raise RuntimeOwnerBlocked(
                    "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                    "Desktop pilot did not publish its restart boundary",
                    resource=f"client:{DESKTOP_CLIENTS[1][0]}",
                )
            request_path = (
                blocked_result_path.parent
                / f"restart-request-{DESKTOP_CLIENTS[1][0]}.json"
            )
            request = json.loads(request_path.read_text(encoding="utf-8"))
            bob = desktop[DESKTOP_CLIENTS[1][0]]
            previous = next(
                item for item in desktop_payloads
                if item["id"] == DESKTOP_CLIENTS[1][0]
            )
            with _restart_lease(
                owner_root,
                request_id=str(request["request_id"]),
                client_id=DESKTOP_CLIENTS[1][0],
            ) as (lease_id, acquired_at, expires_at):
                bob.restart()
                snapshot = _wait_for_moments_snapshot(bob)
                current = _client_payload(
                    DESKTOP_CLIENTS[1][0],
                    DESKTOP_CLIENTS[1][1],
                    bob,
                    snapshot,
                    service_roles={
                        "station": STATION_ID,
                        "station-secondary": SECONDARY_STATION_ID,
                    },
                )
                desktop_payloads = [
                    current if item["id"] == current["id"] else item
                    for item in desktop_payloads
                ]
                lease = {
                    "schema_version": 1,
                    "kind": runtime_manifest.RUNTIME_LEASE_EVIDENCE_KIND,
                    "owner_id": OWNER_ID,
                    "request_id": request["request_id"],
                    "parent_manifest_digest": request[
                        "parent_runtime_manifest_digest"
                    ],
                    "retained_client_id": current["id"],
                    "lease_ids": [lease_id],
                    "acquired_at": acquired_at,
                    "expires_at": expires_at,
                }
                lease["artifact_digest"] = runtime_manifest.canonical_digest(lease)
                lease_path = _write_immutable_json(
                    desktop_dir / "leases" / f"{current['id']}.json",
                    lease,
                )
                lease_ref = {
                    "path": lease_path.relative_to(desktop_dir).as_posix(),
                    "sha256": _sha256(lease_path.read_bytes()),
                }
                acknowledgement_id = f"ack-{request['request_id']}"
                child_run_id = _continuation_run_id(
                    run_id,
                    str(request["request_id"]),
                )
                child_services = _continuation_services(
                    desktop_dir,
                    run_id=child_run_id,
                    journey_id=DESKTOP_JOURNEY,
                    services=services,
                    attestations={
                        STATION_ID: attestation,
                        SECONDARY_STATION_ID: secondary_attestation,
                    },
                )
                child_path = write_attached_runtime_manifest(
                    manifest_payload=_manifest_payload(
                        identity=identity,
                        journey_id=DESKTOP_JOURNEY,
                        run_id=child_run_id,
                        services=child_services,
                        fixture_ref=desktop_fixture_ref,
                        fixture_digest=fixture_digest,
                        clients=desktop_payloads,
                        continuation={
                            "parent_manifest_digest": request[
                                "parent_runtime_manifest_digest"
                            ],
                            "restart_request_id": request["request_id"],
                            "retained_client_id": current["id"],
                            "retained_storage_identity_digest": current[
                                "storage_identity_digest"
                            ],
                            "previous_boot_identity": previous["boot_identity"],
                            "runtime_owner_acknowledgement_id": acknowledgement_id,
                            "lease_evidence_ref": lease_ref,
                        },
                    ),
                    output_path=desktop_dir / "runtime-child.json",
                    journey_id=DESKTOP_JOURNEY,
                    sessions_by_client=desktop,
                    automation_refs_by_client={
                        client_id: {
                            "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
                            "endpoint": _webdriver_endpoint(client),
                            "session_id": str(client.driver.session_id),
                        }
                        for client_id, client in desktop.items()
                    },
                    repo_root=self.repo_root,
                )
                child = json.loads(child_path.read_text(encoding="utf-8"))
                fixture_context, fixture_action_client = (
                    fixture_owner.open_action_channel(
                        workspace_id=identity["workspaceId"],
                        gate_id=DESKTOP_JOURNEY,
                        runtime_manifest_digests=(
                            str(child["manifest_digest"]),
                        ),
                    )
                )
                stack.callback(
                    _close_fixture_action_channel,
                    fixture_context,
                    fixture_action_client,
                )
                acknowledgement = {
                    "schema_version": 1,
                    "kind": runtime_manifest.CONTINUATION_ACKNOWLEDGEMENT_KIND,
                    "request_id": request["request_id"],
                    "owner_id": OWNER_ID,
                    "acknowledgement_id": acknowledgement_id,
                    "parent_runtime_manifest_digest": request[
                        "parent_runtime_manifest_digest"
                    ],
                    "child_runtime_manifest_digest": child["manifest_digest"],
                    "previous_boot_identity": previous["boot_identity"],
                    "current_boot_identity": current["boot_identity"],
                    "session_generation": current["session_generation"],
                    "retained_storage_identity_digest": current[
                        "storage_identity_digest"
                    ],
                    "lease_evidence_ref": lease_ref,
                }
                acknowledgement["artifact_digest"] = (
                    runtime_manifest.canonical_digest(acknowledgement)
                )
                _stage_continuation_evidence(
                    blocked_result_path=blocked_result_path,
                    request_path=request_path,
                    child_run_id=child_run_id,
                    client_id=current["id"],
                    acknowledgement=acknowledgement,
                )
                desktop_result = execute_scenario(
                    runtime="desktop",
                    scenario_id="desktop-pilot",
                    budget_seconds=1200,
                    repo_root=self.repo_root,
                    profile=None,
                    profiles=(PROFILE, SECONDARY_PROFILE),
                    clients=tuple(item[0] for item in DESKTOP_CLIENTS),
                    runtime_manifest_path=child_path,
                    result_root=self.result_root,
                    workspace_identity=identity,
                    fixture_action_client=fixture_action_client,
                )

            _close_fixture_action_channel(
                fixture_context,
                fixture_action_client,
            )
            for client in reversed(tuple(desktop.values())):
                _stop_client_or_raise(
                    client,
                    purpose="Desktop",
                    active_client_ids=active_client_ids,
                )
            desktop.clear()

            _activate_scenario_journey(self.repo_root, BROWSER_JOURNEY)
            browser: dict[str, FoundationRuntimeClient] = {}
            browser_payloads: list[dict[str, Any]] = []
            for index, (client_id, actor, account_role) in enumerate(BROWSER_CLIENTS):
                client = _make_client(
                    repo_root=self.repo_root,
                    runtime_root=owner_root,
                    station_url=station_url,
                    profile_env=profile_env,
                    source_commit=str(identity["head"]),
                    client_id=client_id,
                    runtime_kind="browser",
                    port_bases=(3630 + index * 20, 3810 + index * 20, 4595 + index * 20),
                    reserved_ports=reserved_ports,
                )
                stack.callback(
                    _stop_client_or_raise,
                    client,
                    purpose="Browser",
                    active_client_ids=active_client_ids,
                )
                active_client_ids.add(id(client))
                snapshot = _start_client(
                    client,
                    account=(
                        accounts[account_role]
                        if account_role is not None
                        else None
                    ),
                    password=password,
                )
                browser[client_id] = client
                browser_payloads.append(
                    _client_payload(
                        client_id,
                        actor,
                        client,
                        snapshot,
                        service_roles={
                            "station": STATION_ID,
                            "station-secondary": SECONDARY_STATION_ID,
                        },
                    )
                )
            browser_dir = owner_root / "browser"
            browser_fixture_ref = self._copy_fixture_into(
                owner_root / fixture_ref["path"],
                browser_dir,
            )
            browser_service_ref = _publish_attestation(
                browser_dir,
                attestation,
                run_id=run_id,
                journey_id=BROWSER_JOURNEY,
                service_id=STATION_ID,
            )
            browser_secondary_service_ref = _publish_attestation(
                browser_dir,
                secondary_attestation,
                run_id=run_id,
                journey_id=BROWSER_JOURNEY,
                service_id=SECONDARY_STATION_ID,
            )
            browser_schema_attestation_ref = (
                _publish_canonical_private_schema_attestation(
                    browser_dir,
                    STATION_ID,
                    schema_attestation,
                )
            )
            browser_secondary_schema_attestation_ref = (
                _publish_canonical_private_schema_attestation(
                    browser_dir,
                    SECONDARY_STATION_ID,
                    secondary_schema_attestation,
                )
            )
            browser_path = write_attached_runtime_manifest(
                manifest_payload=_manifest_payload(
                    identity=identity,
                    journey_id=BROWSER_JOURNEY,
                    run_id=run_id,
                    services={
                        STATION_ID: _service_payload(
                            attestation,
                            browser_service_ref,
                            browser_schema_attestation_ref,
                            profile_id=PROFILE,
                            schema_attestation_endpoint=profile_env[
                                "PT_STATION_URL"
                            ],
                        ),
                        SECONDARY_STATION_ID: _service_payload(
                            secondary_attestation,
                            browser_secondary_service_ref,
                            browser_secondary_schema_attestation_ref,
                            profile_id=SECONDARY_PROFILE,
                            schema_attestation_endpoint=secondary_profile_env[
                                "PT_STATION_URL"
                            ],
                        ),
                    },
                    fixture_ref=browser_fixture_ref,
                    fixture_digest=fixture_digest,
                    clients=browser_payloads,
                ),
                output_path=browser_dir / "runtime.json",
                journey_id=BROWSER_JOURNEY,
                sessions_by_client=browser,
                automation_refs_by_client={
                    client_id: {
                        "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
                        "endpoint": _webdriver_endpoint(client),
                        "session_id": str(client.driver.session_id),
                    }
                    for client_id, client in browser.items()
                },
                repo_root=self.repo_root,
            )
            browser_result = execute_scenario(
                runtime="browser",
                scenario_id="browser-private-boundary",
                budget_seconds=1200,
                repo_root=self.repo_root,
                profile=None,
                profiles=(PROFILE, SECONDARY_PROFILE),
                clients=tuple(item[0] for item in BROWSER_CLIENTS),
                runtime_manifest_path=browser_path,
                result_root=self.result_root,
                workspace_identity=identity,
            )
        return {
            "status": "FUNCTIONAL_PASS",
            "proofState": "UNPROVEN",
            "desktopResult": desktop_result["result"],
            "browserResult": browser_result["result"],
            "runtimeRoot": str(owner_root),
        }

    def run_private_comment(self) -> dict[str, Any]:
        identity = _require_clean_source(self.repo_root, self.result_root)
        _activate_scenario_journey(
            self.repo_root,
            W8_JOURNEY,
            work_item_id=W8_WORK_ITEM_ID,
            task_id=W8_TASK_ID,
        )
        resolved, profile_env = _resolve_machine_profile(self.repo_root)
        run_id = f"w8-comment-{identity['head'][:12]}-{os.getpid()}"
        owner_root = self.runtime_root / run_id
        acceptance_run_id = (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            + "-"
            + _sha256(run_id)[:32]
        )
        attestation_store = owner_root / "attestation-store"
        (
            attestation_store
            / identity["workspaceId"]
            / W8_JOURNEY
            / acceptance_run_id
        ).mkdir(parents=True, mode=0o700)
        transport_stack, station_endpoints = _open_station_tunnels(
            ((STATION_ID, profile_env),)
        )
        station_url = station_endpoints[STATION_ID]
        try:
            with _environment(
                {
                    "PT_ACCEPTANCE_ARTIFACT_ROOT": str(attestation_store),
                    "PT_ACCEPTANCE_WORKSPACE_ID": identity["workspaceId"],
                    "PT_ACCEPTANCE_GATE_ID": W8_JOURNEY,
                    "PT_ACCEPTANCE_RUN_ID": acceptance_run_id,
                }
            ):
                attestation = produce_station_attestation(
                    environment_id="secure-content-w8-runtime",
                    run_id=run_id,
                    service_id=STATION_ID,
                    station_url=station_url,
                    profile_env=profile_env,
                    require_runtime_identity=True,
                    remote_source_identity_provider=resolve_remote_source_identity,
                )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            reason = _error_message_with_cleanup(error)
            resource = (
                error.resource
                if isinstance(error, BlockedError)
                else "station:station-four"
            )
            raise RuntimeOwnerBlocked(
                "SERVICE_ATTESTATION_UNAVAILABLE",
                reason,
                resource=resource,
            ) from error
        if (
            not commits_match(attestation.live_commit, identity["head"])
            or attestation.protocol_digest != source_proto_digest(self.repo_root)
        ):
            error = RuntimeOwnerBlocked(
                "SOURCE_ATTESTATION_MISMATCH",
                "station-four is not deployed from the exact W8 source",
                resource="station:station-four",
            )
            _close_runtime_stack(transport_stack, primary_error=error)
            raise error

        try:
            schema_attestation = (
                _resolve_canonical_private_schema_attestation(
                    self.result_root,
                    self.repo_root,
                    identity,
                    attestation,
                    service_id=STATION_ID,
                    profile_id=PROFILE,
                    attested_endpoint=profile_env["PT_STATION_URL"],
                )
            )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise

        with _runtime_cleanup_scope(transport_stack) as stack:
            fixture: dict[str, Any] = {
                "schema_version": 1,
                "kind": runtime_manifest.FIXTURE_MANIFEST_KIND,
                "fixture_set_id": "secure-content-w8-private-comment",
                "source_checkpoint": identity["head"],
                "handles": [],
            }
            fixture["manifest_digest"] = runtime_manifest.canonical_digest(fixture)
            fixture_path = _write_immutable_json(
                owner_root / "fixture.json",
                fixture,
            )
            fixture_digest = str(fixture["manifest_digest"])
            accounts, password = _provision_runtime_accounts(
                primary_station_url=station_url,
                run_id=run_id,
                roles=("alice", "bob", "eve"),
            )
            reserved_ports: set[int] = set()
            active_client_ids: set[int] = set()
            clients: dict[str, FoundationRuntimeClient] = {}
            payloads: list[dict[str, Any]] = []
            for index, (client_id, actor, account_role) in enumerate(DESKTOP_CLIENTS):
                client = _make_client(
                    repo_root=self.repo_root,
                    runtime_root=owner_root,
                    station_url=station_url,
                    profile_env=profile_env,
                    source_commit=str(identity["head"]),
                    client_id=client_id,
                    runtime_kind="native-tauri",
                    port_bases=(
                        3530 + index * 20,
                        3710 + index * 20,
                        4495 + index * 20,
                    ),
                    reserved_ports=reserved_ports,
                )
                stack.callback(
                    _stop_client_or_raise,
                    client,
                    purpose="Private Comment",
                    active_client_ids=active_client_ids,
                )
                active_client_ids.add(id(client))
                snapshot = _start_client(
                    client,
                    account=accounts[account_role],
                    password=password,
                )
                _wait_for_device_enrollment(client)
                clients[client_id] = client
                payloads.append(
                    _client_payload(client_id, actor, client, snapshot)
                )

            _prepare_accepted_friendship(
                clients[DESKTOP_CLIENTS[0][0]],
                clients[DESKTOP_CLIENTS[1][0]],
            )
            runtime_dir = owner_root / "private-comment"
            fixture_ref = self._copy_fixture_into(fixture_path, runtime_dir)
            attestation_ref = _publish_attestation(
                runtime_dir,
                attestation,
                run_id=run_id,
                journey_id=W8_JOURNEY,
                service_id=STATION_ID,
            )
            schema_attestation_ref = (
                _publish_canonical_private_schema_attestation(
                    runtime_dir,
                    STATION_ID,
                    schema_attestation,
                )
            )
            manifest_path = write_attached_runtime_manifest(
                manifest_payload=_manifest_payload(
                    identity=identity,
                    journey_id=W8_JOURNEY,
                    run_id=run_id,
                    services={
                        STATION_ID: _service_payload(
                            attestation,
                            attestation_ref,
                            schema_attestation_ref,
                            profile_id=PROFILE,
                            schema_attestation_endpoint=profile_env[
                                "PT_STATION_URL"
                            ],
                        ),
                    },
                    fixture_ref=fixture_ref,
                    fixture_digest=fixture_digest,
                    clients=payloads,
                ),
                output_path=runtime_dir / "runtime.json",
                journey_id=W8_JOURNEY,
                sessions_by_client=clients,
                automation_refs_by_client={
                    client_id: {
                        "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
                        "endpoint": _webdriver_endpoint(client),
                        "session_id": str(client.driver.session_id),
                    }
                    for client_id, client in clients.items()
                },
                repo_root=self.repo_root,
            )
            result = execute_scenario(
                runtime="desktop",
                scenario_id="private-comment",
                budget_seconds=1200,
                repo_root=self.repo_root,
                profile=PROFILE,
                profiles=(),
                clients=tuple(item[0] for item in DESKTOP_CLIENTS),
                runtime_manifest_path=manifest_path,
                result_root=self.result_root,
                workspace_identity=identity,
            )

            for client in reversed(tuple(clients.values())):
                _stop_client_or_raise(
                    client,
                    purpose="Private Comment",
                    active_client_ids=active_client_ids,
                )
            clients.clear()

        return {
            "status": "FUNCTIONAL_PASS",
            "proofState": "UNPROVEN",
            "privateCommentResult": result["result"],
            "runtimeRoot": str(owner_root),
        }

    @staticmethod
    def _copy_fixture_into(source: Path, target_root: Path) -> dict[str, str]:
        target = target_root / "fixture.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        with source.open("rb") as reader:
            descriptor = os.open(
                target,
                os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                0o600,
            )
            with os.fdopen(descriptor, "wb") as writer:
                shutil.copyfileobj(reader, writer)
                writer.flush()
                os.fsync(writer.fileno())
        return {
            "path": target.relative_to(target_root).as_posix(),
            "sha256": _sha256(target.read_bytes()),
        }


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=("preflight", "run", "run-private-comment"),
    )
    parser.add_argument("--profile", default=PROFILE)
    parser.add_argument("--slot", type=int, default=SLOT)
    parser.add_argument("--result-root", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.profile != PROFILE or args.slot != SLOT:
        blocked = RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            "W7 runtime owner requires --profile four --slot 5",
            resource="profile:four",
        )
        print(json.dumps(blocked.payload(), sort_keys=True), file=sys.stderr)
        return 2
    repo_root = Path(__file__).resolve().parents[3]
    result_root = args.result_root or (
        Path.home()
        / ".peers-touch"
        / "dev"
        / "workspaces"
        / hashlib.sha256(str(repo_root).encode("utf-8")).hexdigest()[:16]
        / "development"
        / "secure-content"
    )
    owner = W7RuntimeOwner(
        repo_root=repo_root,
        result_root=result_root,
    )
    try:
        if args.action == "preflight":
            result = owner.preflight()
        elif args.action == "run-private-comment":
            result = owner.run_private_comment()
        else:
            result = owner.run()
    except RuntimeOwnerBlocked as error:
        print(json.dumps(error.payload(), sort_keys=True), file=sys.stderr)
        return 2
    except (RunnerError, OSError, subprocess.SubprocessError) as error:
        blocked = RuntimeOwnerBlocked(
            "RUNTIME_OWNER_FAILED",
            _error_message_with_cleanup(error),
            resource="runtime:secure-content-w7",
        )
        print(json.dumps(blocked.payload(), sort_keys=True), file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
