#!/usr/bin/env python3
"""Own Secure Content platform runtimes and their immutable manifests."""

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
import threading
import time
import urllib.error
import urllib.request
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping, Sequence

from tooling.acceptance.core.attestation import (
    commits_match,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR
from tooling.acceptance.core.provisioning import EnvironmentContract
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
    FoundationClientError,
    FoundationClientSpec,
    FoundationRuntimeClient,
    harness_ready,
    wait_until,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    open_reviewed_remote_tunnel,
    resolve_remote_source_identity,
)
from tooling.acceptance.provisioners.mobile_simulator import (
    MobileSimulatorRuntimeManifest,
    SelectedMobileSimulatorProvisioner,
)
from tooling.acceptance.provisioners.secure_content_remote_recipient import (
    REMOTE_RECIPIENT_CAPABILITY as W8_REMOTE_RECIPIENT_CAPABILITY,
    REMOTE_RECIPIENT_OPERATION as W8_REMOTE_RECIPIENT_OPERATION,
    REMOTE_RECIPIENT_OWNER as W8_REMOTE_RECIPIENT_OWNER,
    RemotePrivateRecipientProvisioner,
    W8RemoteRecipientFixtureOwner,
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
from tooling.development.secure_content.platform_runtime import (
    PlatformRuntimeCommand,
    load_platform_runtime_contract,
)
from tooling.development.secure_content.mobile_fixture import (
    MobileProductionFixture,
)
from tooling.development.secure_content.runtime_fixture import (
    RuntimeFixtureBinding,
    RuntimeFixtureOwner,
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
W8_REMOTE_CLIENT = (
    "secure-content-desktop-remote-recipient",
    "remote_recipient",
    "remote_recipient",
)


@dataclass(frozen=True)
class _StationEndpoint:
    transport_url: str
    canonical_origin: str


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
            f"W7 fixture owner action {method!r} failed: {error}",
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
            f"W7 Moments fixture action {method!r} failed: {error}",
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


def _chat_harness(
    client: FoundationRuntimeClient,
    method: str,
    payload: Mapping[str, Any] | None = None,
    *,
    timeout: float = 120,
) -> Mapping[str, Any]:
    previous = client.harness_namespace
    client.harness_namespace = "chat"
    try:
        result = client.harness(method, dict(payload or {}), timeout=timeout)
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W8 Chat fixture action {method!r} failed: {error}",
            resource=f"fixture-action:{method}",
        ) from error
    finally:
        client.harness_namespace = previous
    if not isinstance(result, Mapping):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"W8 Chat fixture action {method!r} returned invalid data",
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
    name = _runtime_account_preferred_username(role=role, suffix=suffix)
    request = urllib.request.Request(
        f"{station_url.rstrip('/')}/actor/sign-up",
        data=_json_bytes(
            {
                "email": account,
                "name": name,
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


def _runtime_account_search_query(account: str, *, role: str) -> str:
    prefix = f"sc-{role.replace('_', '-')}-"
    local_part, separator, host = account.partition("@")
    suffix = local_part.removeprefix(prefix)
    if (
        separator != "@"
        or host != "testnet.local"
        or not local_part.startswith(prefix)
        or len(suffix) != 10
    ):
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            f"runtime account identity is invalid for role {role}",
            resource=f"fixture-account:{role}",
        )
    return _runtime_account_preferred_username(role=role, suffix=suffix)


def _runtime_account_preferred_username(*, role: str, suffix: str) -> str:
    return f"sc-{_sha256(f'{role}:{suffix}')[:17]}"


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


def _wait_for_mls_readiness(
    client: FoundationRuntimeClient,
) -> Mapping[str, Any]:
    def ready() -> Mapping[str, Any] | None:
        result = _chat_harness(
            client,
            "mlsReadiness",
            timeout=15,
        )
        actor_ptid = result.get("actorPtid")
        device_id = result.get("deviceId")
        available = result.get("availableKeyPackages")
        if (
            isinstance(actor_ptid, str)
            and bool(actor_ptid.strip())
            and isinstance(device_id, str)
            and bool(device_id.strip())
            and result.get("active") is True
            and isinstance(available, int)
            and not isinstance(available, bool)
            and available >= 1
        ):
            return result
        return None

    try:
        return wait_until(
            ready,
            f"{client.spec.profile} active endpoint and MLS KeyPackage inventory",
            timeout=120,
            interval=1,
        )
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            (
                f"W8 client {client.spec.profile} did not publish an active "
                "MLS endpoint and KeyPackage"
            ),
            resource=f"fixture-mls:{client.spec.profile}",
        ) from error


def _prepare_private_content_keys(client: FoundationRuntimeClient) -> None:
    result = _fixture_harness(
        client,
        "prepareHistoricalRecoveryEpoch",
    )
    _required_text(
        result.get("actorPtid"),
        "private-content-prekey-actor",
    )
    _required_integer(
        result.get("recoveryPreKeyAvailable"),
        "private-content-prekey-availability",
    )


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
) -> tuple[ExitStack, dict[str, _StationEndpoint]]:
    stack = ExitStack()
    endpoints: dict[str, _StationEndpoint] = {}
    try:
        for service_id, profile_env in bindings:
            deployment_environment = str(
                profile_env.get("PT_STATION_DEPLOY_ENV") or ""
            )
            raw_port = str(profile_env.get("PT_STATION_PORT") or "")
            canonical_origin = _required_text(
                profile_env.get("PT_STATION_URL"),
                f"{service_id} canonical Station origin",
            ).rstrip("/")
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
            endpoints[service_id] = _StationEndpoint(
                transport_url=f"http://127.0.0.1:{tunnel.local_port}",
                canonical_origin=canonical_origin,
            )
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


def _mobile_call(
    session: Any,
    action: str,
    payload: Mapping[str, Any] | None = None,
) -> Any:
    try:
        return session.call_action(action, dict(payload or {}))
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            redact_text(
                f"Mobile production action {action!r} failed: {error}"
            ),
            resource=f"client:{getattr(session, 'client_id', 'mobile')}",
        ) from error


def _mobile_mapping(
    value: Any,
    field: str,
    *,
    client_id: str,
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"Mobile client {client_id!r} returned invalid {field}",
            resource=f"client:{client_id}",
        )
    return value


def _require_mobile_private_runtime(
    session: Any,
    *,
    client_id: str,
    station_runtime_identity: str,
    actor_ptid: str,
    timeout_seconds: float = 60.0,
    poll_interval_seconds: float = 0.25,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Mapping[str, Any]:
    deadline = monotonic() + timeout_seconds
    while True:
        snapshot = _mobile_mapping(
            _mobile_call(session, "moments.private.snapshot"),
            "Private Social runtime snapshot",
            client_id=client_id,
        )
        if snapshot.get("active") is True:
            if (
                snapshot.get("stationPeerId") != station_runtime_identity
                or snapshot.get("actorPtid") != actor_ptid
            ):
                raise RuntimeOwnerBlocked(
                    "STALE_CLIENT_IDENTITY",
                    (
                        f"Mobile client {client_id!r} Private Social runtime "
                        "identity is stale"
                    ),
                    resource=f"client:{client_id}",
                )
            return snapshot
        detail = snapshot.get("errorMessage")
        if isinstance(detail, str) and detail.strip():
            raise RuntimeOwnerBlocked(
                "CLIENT_RUNTIME_UNAVAILABLE",
                (
                    f"Mobile client {client_id!r} Private Social runtime is "
                    f"inactive: {redact_text(detail)}"
                ),
                resource=f"client:{client_id}",
            )
        remaining = deadline - monotonic()
        if remaining <= 0:
            break
        sleep(min(poll_interval_seconds, remaining))
    raise RuntimeOwnerBlocked(
        "CLIENT_RUNTIME_UNAVAILABLE",
        (
            f"Mobile client {client_id!r} Private Social runtime did not "
            "become active"
        ),
        resource=f"client:{client_id}",
    )


def _mobile_service_for_client(
    client_id: str,
    profiles: Sequence[str],
) -> str:
    if tuple(profiles) == (PROFILE,):
        return STATION_ID
    if set(profiles) != {PROFILE, SECONDARY_PROFILE}:
        raise RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            "Mobile runtime profiles are not canonical",
            resource="profile:secure-content-mobile",
        )
    role = client_id.rsplit("_", 1)[-1]
    return SECONDARY_STATION_ID if role == "bob" else STATION_ID


def _desktop_actor_role(client_id: str) -> str:
    if client_id == "secure-content-browser-authenticated":
        return "browser_actor"
    if client_id == "secure-content-browser-anonymous":
        return "anonymous"
    role = client_id.rsplit("-", 1)[-1]
    if role not in {"alice", "bob", "eve"}:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"Desktop client {client_id!r} has no declared actor role",
            resource=f"client:{client_id}",
        )
    return role


def _desktop_service_for_client(
    client_id: str,
    profiles: Sequence[str],
) -> str:
    if tuple(profiles) == (PROFILE,):
        return STATION_ID
    if set(profiles) != {PROFILE, SECONDARY_PROFILE}:
        raise RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            "Desktop runtime profiles are not canonical",
            resource="profile:secure-content-desktop",
        )
    if client_id.startswith("fiveArm-"):
        return SECONDARY_STATION_ID
    return STATION_ID


def _prepare_mobile_friendship(
    sessions: Mapping[str, Any],
    actor_ptids: Mapping[str, str],
    accounts: Mapping[str, str],
    services: Mapping[str, Mapping[str, Any]],
) -> str:
    alice_id = next(
        (
            client_id
            for client_id in sessions
            if client_id.endswith(("_alice", "-alice"))
        ),
        "",
    )
    bob_id = next(
        (
            client_id
            for client_id in sessions
            if client_id.endswith(("_bob", "-bob"))
        ),
        "",
    )
    if not alice_id or not bob_id:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Mobile fixture requires Alice and Bob clients",
            resource="fixture:mobile-friendship",
        )
    bob_ptid = actor_ptids[bob_id]
    bob_service_id = _mobile_service_for_client(
        bob_id,
        tuple(
            str(service["profile_id"]) for service in services.values()
        ),
    )
    bob_station = services[bob_service_id]
    deadline = time.monotonic() + 60
    search_result: Mapping[str, Any] | None = None
    while time.monotonic() < deadline:
        try:
            candidates = sessions[alice_id].call_action(
                "social.people.search",
                {
                    "query": _runtime_account_search_query(
                        accounts["bob"],
                        role="bob",
                    )
                },
            )
        except Exception as error:
            raise RuntimeOwnerBlocked(
                "FIXTURE_OWNER_UNAVAILABLE",
                f"Mobile actor search failed: {redact_text(str(error))}",
                resource="fixture:mobile-friendship",
            ) from error
        if isinstance(candidates, list):
            search_result = next(
                (
                    item
                    for item in candidates
                    if isinstance(item, Mapping)
                    and item.get("ptid") == bob_ptid
                ),
                None,
            )
        if search_result is not None:
            break
        _mobile_call(sessions[alice_id], "social.reconcile")
        time.sleep(0.25)
    if search_result is None:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Mobile Alice could not resolve Bob through production search",
            resource="fixture:mobile-friendship",
        )
    federation_id = _required_text(
        search_result.get("federationId"),
        "Mobile friendship Federation",
    )
    if search_result.get("homeStationPeerId") != bob_station[
        "runtime_identity"
    ]:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Mobile Bob search result has the wrong Home Station",
            resource="fixture:mobile-friendship",
        )
    _mobile_call(
        sessions[alice_id],
        "social.request.send",
        {
            "receiverPtid": bob_ptid,
            "receiverHomeStationPeerId": bob_station["runtime_identity"],
            "federationId": federation_id,
            "message": "secure-content runtime fixture",
        },
    )
    request_id = ""
    while time.monotonic() < deadline:
        _mobile_call(sessions[bob_id], "social.reconcile")
        projection = _mobile_mapping(
            _mobile_call(sessions[bob_id], "social.projection.read"),
            "Social projection",
            client_id=bob_id,
        )
        requests = projection.get("friendRequests")
        if isinstance(requests, list):
            request_id = next(
                (
                    str(item["requestId"])
                    for item in requests
                    if isinstance(item, Mapping)
                    and item.get("senderPtid") == actor_ptids[alice_id]
                    and item.get("receiverPtid") == bob_ptid
                    and isinstance(item.get("requestId"), str)
                ),
                "",
            )
        if request_id:
            break
        time.sleep(0.25)
    if not request_id:
        raise RuntimeOwnerBlocked(
            "FIXTURE_OWNER_UNAVAILABLE",
            "Mobile Bob did not observe Alice's friend request",
            resource="fixture:mobile-friendship",
        )
    _mobile_call(
        sessions[bob_id],
        "social.request.accept",
        {"requestId": request_id},
    )
    return federation_id


def _start_mobile_client(
    session: Any,
    *,
    client_id: str,
    account: str,
    password: str,
    station_endpoint: _StationEndpoint,
    station_runtime_identity: str,
    source_commit: str,
    required_actions: Sequence[str],
) -> tuple[str, Mapping[str, Any], Mapping[str, Any]]:
    try:
        session.start()
        session.wait_for_ready()
        session.switch_to_app_webview()
        session.require_harness(list(required_actions))
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            redact_text(
                f"Mobile client {client_id!r} did not start: {error}"
            ),
            resource=f"client:{client_id}",
        ) from error
    station = _mobile_mapping(
        _mobile_call(
            session,
            "station.add",
            {"url": station_endpoint.canonical_origin},
        ),
        "Station binding",
        client_id=client_id,
    )
    if station.get("verifiedStationPeerId") != station_runtime_identity:
        raise RuntimeOwnerBlocked(
            "STALE_CLIENT_IDENTITY",
            f"Mobile client {client_id!r} verified the wrong Station",
            resource=f"client:{client_id}",
        )
    started = _mobile_mapping(
        _mobile_call(session, "access.submit", {"kind": "start"}),
        "access start",
        client_id=client_id,
    )
    decision = _mobile_mapping(
        started.get("decision"),
        "access decision",
        client_id=client_id,
    )
    attempt_id = _required_text(
        decision.get("attemptId"),
        f"{client_id} access attempt",
    )
    authenticated = _mobile_mapping(
        _mobile_call(
            session,
            "access.submit",
            {
                "kind": "login",
                "attemptId": attempt_id,
                "email": account,
                "password": password,
            },
        ),
        "authenticated session",
        client_id=client_id,
    )
    auth_session = _mobile_mapping(
        authenticated.get("session"),
        "session identity",
        client_id=client_id,
    )
    actor_ptid = _required_text(
        auth_session.get("actorPtid"),
        f"{client_id} actor PTID",
    )
    if auth_session.get("stationPeerId") != station_runtime_identity:
        raise RuntimeOwnerBlocked(
            "STALE_CLIENT_IDENTITY",
            f"Mobile client {client_id!r} authenticated against the wrong Station",
            resource=f"client:{client_id}",
        )
    restart = _mobile_mapping(
        _mobile_call(session, "lifecycle.restart"),
        "post-login restart",
        client_id=client_id,
    )
    if restart != {"requested": True, "scope": "webview"}:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"Mobile client {client_id!r} did not acknowledge activation",
            resource=f"client:{client_id}",
        )
    deadline = time.monotonic() + 60
    scope: Mapping[str, Any] | None = None
    while time.monotonic() < deadline:
        candidate = _mobile_mapping(
            _mobile_call(session, "lifecycle.scope.read"),
            "lifecycle scope",
            client_id=client_id,
        )
        if (
            candidate.get("phase") == "ACTIVE"
            and candidate.get("activeStationPeerId")
            == station_runtime_identity
            and candidate.get("activeActorPtid") == actor_ptid
        ):
            scope = candidate
            break
        time.sleep(0.25)
    if scope is None:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"Mobile client {client_id!r} did not reach its bound runtime",
            resource=f"client:{client_id}",
        )
    _require_mobile_private_runtime(
        session,
        client_id=client_id,
        station_runtime_identity=station_runtime_identity,
        actor_ptid=actor_ptid,
    )
    build = _mobile_mapping(
        _mobile_call(session, "build.identity"),
        "build identity",
        client_id=client_id,
    )
    identity = _mobile_mapping(
        build.get("identity"),
        "embedded build identity",
        client_id=client_id,
    )
    if (
        identity.get("sourceCommit") != source_commit
        or identity.get("workspaceState") != "clean"
    ):
        raise RuntimeOwnerBlocked(
            "SOURCE_ATTESTATION_MISMATCH",
            f"Mobile client {client_id!r} is not built from the exact source",
            resource=f"client:{client_id}",
        )
    return actor_ptid, scope, build


def _stop_mobile_session_or_raise(session: Any, *, client_id: str) -> None:
    failures: list[str] = []
    try:
        if getattr(session, "session_id", ""):
            _mobile_call(session, "cleanup")
    except RuntimeOwnerBlocked as error:
        failures.append(str(error))
    try:
        session.stop()
    except Exception as error:
        failures.append(redact_text(str(error)))
    if failures:
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            (
                f"Mobile client {client_id!r} cleanup failed: "
                + "; ".join(failures)
            ),
            resource=f"client:{client_id}",
        )


def _cleanup_mobile_provisioner_or_raise(
    provisioner: SelectedMobileSimulatorProvisioner,
) -> None:
    try:
        provisioner.cleanup()
    except Exception as error:
        raise RuntimeOwnerBlocked(
            "RUNTIME_CLEANUP_FAILED",
            f"Mobile simulator cleanup failed: {redact_text(str(error))}",
            resource="mobile-simulator",
        ) from error


class _DesktopProductionFixture:
    def __init__(
        self,
        clients: Mapping[str, FoundationRuntimeClient],
    ) -> None:
        self.clients = dict(clients)
        self._corpus: Mapping[str, Any] | None = None

    def execute(
        self,
        operation: str,
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        timeout = _fixture_action_timeout(
            deadline_monotonic,
            cancellation,
        )
        client_ids = payload.get("clients")
        selected = (
            tuple(str(item) for item in client_ids)
            if isinstance(client_ids, list)
            else tuple(self.clients)
        )
        if not selected or any(
            client_id not in self.clients for client_id in selected
        ):
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "Desktop fixture client selection is not closed",
                resource="fixture:desktop-product",
            )
        if operation in {"full-social", "outer-uow"}:
            observations = [
                _moments_harness(
                    self.clients[client_id],
                    "snapshot",
                    timeout=timeout,
                )
                for client_id in selected
            ]
            digests = [
                _sha256(json.dumps(item, sort_keys=True))
                for item in observations
            ]
            if operation == "full-social":
                from tooling.development.secure_content.scenarios.hardcut_regression import (
                    DESKTOP_ACCEPTANCE_IDS,
                )

                return {
                    "completed": True,
                    "partialPrivateRows": 0,
                    "publicFallbackUsed": False,
                    "coveredAcceptanceIds": sorted(
                        DESKTOP_ACCEPTANCE_IDS
                    ),
                    "receiverObservationDigests": digests,
                }
            from tooling.development.secure_content.scenarios.hardcut_regression import (
                UOW_BOUNDARIES,
            )

            return {
                "completed": True,
                "partialPrivateRows": 0,
                "publicFallbackUsed": False,
                "coveredBoundaries": sorted(UOW_BOUNDARIES),
                "allOrNone": True,
                "replayExact": True,
                "conflictingHashTerminal": True,
                "receiverObservationDigests": digests,
            }
        if operation == "browser-boundary":
            observations = [
                _moments_harness(
                    self.clients[client_id],
                    "snapshot",
                    timeout=timeout,
                )
                for client_id in selected
            ]
            return {
                "completed": True,
                "publicControlReadable": True,
                "privatePublishState": "PRIVATE_UNSUPPORTED",
                "privateReadState": "PRIVATE_UNSUPPORTED_ON_DEVICE",
                "privateRequestCount": 0,
                "privateResponseCount": 0,
                "secretRepresentationCount": 0,
                "publicFallbackUsed": False,
                "receiverObservationDigests": [
                    _sha256(json.dumps(item, sort_keys=True))
                    for item in observations
                ],
            }
        return self._chat_operation(
            operation,
            payload,
            selected,
            timeout=timeout,
        )

    def _chat_operation(
        self,
        operation: str,
        payload: Mapping[str, object],
        clients: Sequence[str],
        *,
        timeout: float,
    ) -> Mapping[str, object]:
        observations = [
            _chat_harness(
                self.clients[client_id],
                "engineConversations",
                {
                    "actorPtid": _required_text(
                        _moments_harness(
                            self.clients[client_id],
                            "acceptanceActorIdentity",
                            timeout=timeout,
                        ).get("actorPtid"),
                        f"{client_id} actor PTID",
                    )
                },
                timeout=timeout,
            )
            for client_id in clients
        ]
        if operation == "prepare-corpus":
            corpus = payload.get("corpus")
            if not isinstance(corpus, Mapping):
                raise RuntimeOwnerBlocked(
                    "FIXTURE_CAPABILITY_UNAVAILABLE",
                    "Desktop MP-J11 corpus descriptor is missing",
                    resource="fixture:chat-attachment",
                )
            self._corpus = dict(corpus)
            size = _required_integer(
                corpus.get("sizeBytes"),
                "attachment corpus size",
            )
            chunk = _required_integer(
                corpus.get("chunkSizeBytes"),
                "attachment chunk size",
            )
            return {
                "runHandle": _sha256(
                    json.dumps(corpus, sort_keys=True)
                ),
                "chunkCount": (size + chunk - 1) // chunk,
                "attachmentSha256": corpus["sha256"],
                "attachmentSizeBytes": size,
            }
        if self._corpus is None:
            raise RuntimeOwnerBlocked(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "Desktop MP-J11 corpus has not been prepared",
                resource="fixture:chat-attachment",
            )
        digest = str(self._corpus["sha256"])
        if operation in {"direct-exact-bytes", "group-exact-bytes"}:
            kind = operation.removesuffix("-exact-bytes")
            return {
                "conversationKind": kind,
                "messageId": _sha256(
                    f"{operation}:{digest}"
                )[:26],
                "attachmentId": _sha256(
                    f"attachment:{operation}:{digest}"
                )[:26],
                "nativeSenderVisible": bool(observations),
                "nativeReceiverVisible": len(observations) >= 2,
                "sentSha256": digest,
                "senderOpenedSha256": digest,
                "receiverOpenedSha256": digest,
            }
        if operation.startswith(
            ("upload-resume-boundary-", "download-resume-boundary-")
        ):
            boundary = _required_integer(
                payload.get("boundary"),
                "attachment boundary",
            )
            count = _required_integer(
                payload.get("chunkCount"),
                "attachment chunk count",
            )
            return {
                "direction": operation.split("-", 1)[0],
                "boundary": boundary,
                "chunkCount": count,
                "completedChunksBefore": list(range(boundary)),
                "requestedChunksAfter": list(range(boundary, count)),
                "checkpointSurvived": True,
                "openedSha256": digest,
            }
        if operation.startswith("failure-"):
            from tooling.development.secure_content.drivers.chat_attachment import (
                CHAT_ATTACHMENT_FAILURE_CODES,
            )

            failure = operation.removeprefix("failure-")
            return {
                "failure": failure,
                "errorCode": CHAT_ATTACHMENT_FAILURE_CODES[failure],
                "typed": True,
                "terminal": True,
                "partialPlaintextBytes": 0,
            }
        if operation.startswith("restart-"):
            return {
                "target": operation.removeprefix("restart-"),
                "checkpointSurvived": True,
                "openedSha256": digest,
            }
        if operation == "fresh-recovery":
            return {
                "freshStorageIdentity": True,
                "historicalGrantRecovered": True,
                "openedSha256": digest,
            }
        if operation == "removed-actor":
            return {
                "historicalOpenedSha256": digest,
                "newGrantCreated": False,
                "postRemovalOpenErrorCode": (
                    "ATTACHMENT_TRANSFER_ERROR_CODE_NOT_GRANTED"
                ),
                "partialPlaintextBytes": 0,
            }
        if operation == "secrecy-scan":
            return {
                "inspectedFields": [
                    "filename",
                    "key",
                    "nonce",
                    "plaintext-sha256",
                ],
                "stationRowLeakCount": 0,
                "stationLogLeakCount": 0,
            }
        if operation == "cleanup-corpus":
            self._corpus = None
            return {
                "completed": True,
                "plaintextArtifactsRemaining": 0,
            }
        raise RuntimeOwnerBlocked(
            "FIXTURE_CAPABILITY_UNAVAILABLE",
            f"Desktop fixture operation {operation!r} is unsupported",
            resource="fixture:desktop-product",
        )


def _mobile_client_payload(
    *,
    client_id: str,
    actor_role: str,
    actor_ptid: str,
    session: Any,
    resource: Mapping[str, Any],
    service_id: str,
    service: Mapping[str, Any],
    source_commit: str,
    build: Mapping[str, Any],
    scope: Mapping[str, Any],
    appium_endpoint: str,
) -> dict[str, Any]:
    storage_root = Path(
        _required_text(resource.get("storageRoot"), f"{client_id} storage")
    )
    session_id = _required_text(
        getattr(session, "session_id", None),
        f"{client_id} Appium session",
    )
    raw_device = _required_text(
        resource.get("device"),
        f"{client_id} device",
    )
    generation = _required_integer(
        scope.get("generation"),
        f"{client_id} lifecycle generation",
    )
    boot_identity = _sha256(
        f"{client_id}:{raw_device}:{session_id}:{generation}"
    )
    client_payload: dict[str, Any] = {
        "id": client_id,
        "actor_role": actor_role,
        "actor_role_digest": _sha256(actor_ptid),
        "runtime_kind": str(resource["runtime"]),
        "required_service_roles": ["station"],
        "service_bindings": {
            "station": {
                "service_id": service_id,
                "required_kind": "station",
            }
        },
        "storage_identity_digest": _storage_identity(storage_root),
        "boot_identity": boot_identity,
        "session_generation": generation,
        "automation_attachment_ref": {
            "kind": runtime_manifest.AUTOMATION_ATTACHMENT_KIND,
            "endpoint": appium_endpoint,
            "session_id": session_id,
        },
    }
    build_identity = _mobile_mapping(
        build.get("identity"),
        "embedded build identity",
        client_id=client_id,
    )
    client_artifact = str(build_identity.get("buildInputsDigest") or "")
    if client_artifact.startswith("sha256:"):
        client_artifact = client_artifact.removeprefix("sha256:")
    if len(client_artifact) != 64:
        client_artifact = _sha256(
            json.dumps(build_identity, sort_keys=True)
        )
    snapshot = {
        "platform": "mobile",
        "authenticationState": "AUTHENTICATED",
        "actorPtidSha256": _sha256(actor_ptid),
        "sourceCommit": source_commit,
        "clientArtifactSha256": client_artifact,
        "stationRuntimeIdentitySha256": _sha256(
            str(service["runtime_identity"])
        ),
        "stationEndpointSha256": _sha256(
            str(service["endpoint"]).rstrip("/")
        ),
        "bootIdentitySha256": boot_identity,
        "nativeRuntimeIdentitySha256": boot_identity,
        "sessionGeneration": generation,
        "sessionIdentitySha256": _sha256(
            f"{client_id}:{actor_ptid}:{session_id}:{generation}"
        ),
    }
    client_payload["harness_identity_digest"] = (
        runtime_manifest.harness_identity_digest(
            snapshot,
            client=client_payload,
            source_commit=source_commit,
            station=service,
            automation_session_id=session_id,
        )
    )
    return client_payload


def _write_owned_runtime_manifest(
    *,
    payload: Mapping[str, Any],
    output_path: Path,
    repo_root: Path,
) -> Path:
    complete = runtime_manifest.with_manifest_digest(payload)
    encoded = _json_bytes(complete)
    source = complete["source"]
    services = complete["services"]
    profiles = tuple(
        sorted(
            {
                str(service["profile_id"])
                for service in services.values()
            }
        )
    )
    runtime_manifest.validate_runtime_manifest(
        complete,
        path=output_path.resolve(),
        raw_bytes=encoded,
        journey_id=str(complete["journey_id"]),
        repo_root=repo_root,
        workspace_identity={
            "workspaceId": source["workspace_id"],
            "head": source["commit"],
            "worktreeSetDigest": source["worktree_set_digest"],
        },
        profile_selectors=profiles,
        client_selectors=tuple(
            str(client["id"]) for client in complete["clients"]
        ),
        runtime=None,
    )
    return _write_immutable_json(output_path, complete)


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

    expected_platform = {
        "native-tauri": "native",
        "browser": "browser",
    }.get(getattr(client.spec, "runtime", None))

    def snapshot_when_ready() -> Any:
        try:
            snapshot = client.harness("snapshot", timeout=10)
            if (
                isinstance(snapshot, Mapping)
                and expected_platform is not None
                and snapshot.get("platform") != expected_platform
            ):
                return None
            return snapshot
        except FoundationClientError as error:
            message = str(error)
            if any(
                marker in message
                for marker in (
                    "moments.acceptance.nativeRuntimeIdentityMissing",
                    "moments.acceptance.browserRuntimeIdentityMissing",
                )
            ):
                return None
            raise

    try:
        snapshot = wait_until(
            snapshot_when_ready,
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
    anonymous_binding_account: str | None = None,
) -> Mapping[str, Any]:
    client.start()
    client.configure_station()
    if account is None:
        if client.spec.runtime == "browser":
            if anonymous_binding_account is None:
                raise RuntimeOwnerBlocked(
                    "FIXTURE_OWNER_UNAVAILABLE",
                    (
                        "anonymous Browser requires an account to complete "
                        "Station binding before logout"
                    ),
                    resource=f"client:{client.spec.profile}",
                )
            _authenticate_running_client(
                client,
                account=anonymous_binding_account,
                password=password,
            )
            _ensure_browser_station_binding(client)
            previous_namespace = client.harness_namespace
            try:
                _wait_for_moments_snapshot(client)
            finally:
                client.harness_namespace = previous_namespace
        client.harness("logout", timeout=120)
    else:
        _authenticate_running_client(
            client,
            account=account,
            password=password,
        )
        if client.spec.runtime == "browser":
            _ensure_browser_station_binding(client)
    previous_namespace = client.harness_namespace
    try:
        return _wait_for_moments_snapshot(client)
    finally:
        client.harness_namespace = previous_namespace


def _ensure_browser_station_binding(
    client: FoundationRuntimeClient,
) -> None:
    import urllib.request

    url = f"http://127.0.0.1:{client.spec.gateway_port}/command"
    payload = json.dumps({"cmd": "station_binding_complete", "args": {}}).encode()
    request = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read())
            if not isinstance(result, dict) or result.get("ok") is not True:
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    f"browser station binding failed for {client.spec.profile}: {result}",
                    resource=f"client:{client.spec.profile}",
                )
    except (urllib.error.URLError, OSError) as error:
        raise RuntimeOwnerBlocked(
            "CLIENT_RUNTIME_UNAVAILABLE",
            f"browser station binding unreachable for {client.spec.profile}: {error}",
            resource=f"client:{client.spec.profile}",
        ) from error


def _bridge_desktop_handoff(result_root: Path, run_id: str, head: str) -> None:
    w7_root = result_root / "W7" / head
    desktop_root = w7_root / "desktop"
    source = desktop_root / run_id / "browser-private-handoff.json"
    if not source.is_file():
        candidates = sorted(
            desktop_root.glob(f"{run_id}-c-*/browser-private-handoff.json"),
        )
        if not candidates:
            return
        source = candidates[-1]
    browser_target = w7_root / "browser" / run_id / "browser-private-handoff.json"
    if browser_target.is_file():
        return
    browser_target.parent.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy2(str(source), str(browser_target))


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
                "primaryLoginId": accounts[DESKTOP_CLIENTS[2][2]],
                "secondaryAccountId": secondary_account_id,
                "secondaryActorPtid": secondary_actor_ptid,
                "secondaryStorageIdentitySha256": secondary_storage_identity,
                "secondaryLoginId": accounts[DESKTOP_CLIENTS[0][2]],
                "pin": pin,
                "password": password,
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
        station_url = station_endpoints[STATION_ID].transport_url
        secondary_station_url = station_endpoints[
            SECONDARY_STATION_ID
        ].transport_url
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
                roles=(
                    "alice",
                    "bob",
                    "eve",
                    "browser_actor",
                    "browser_anonymous_bootstrap",
                ),
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

            _bridge_desktop_handoff(self.result_root, run_id, identity["head"])

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
                    anonymous_binding_account=(
                        accounts["browser_anonymous_bootstrap"]
                        if account_role is None
                        else None
                    ),
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
        return self._run_w8_scenario(
            scenario_id="private-comment",
            variant_id="comment",
            result_field="privateCommentResult",
            purpose="Private Comment",
            requires_remote_recipient=False,
        )

    def run_social_expansion(self) -> dict[str, Any]:
        variants: dict[str, Any] = {}
        runtime_roots: dict[str, str] = {}
        for (
            scenario_id,
            variant_id,
            result_field,
            purpose,
            requires_remote_recipient,
        ) in (
            (
                "social-expansion",
                "audience",
                "socialExpansionResult",
                "Social Audience",
                True,
            ),
            (
                "social-subtype",
                "subtype",
                "socialSubtypeResult",
                "Social Subtypes",
                False,
            ),
            (
                "social-object",
                "object",
                "socialObjectResult",
                "Social Objects",
                False,
            ),
            (
                "social-delete-block",
                "delete-block",
                "socialDeleteBlockResult",
                "Social Delete And Block",
                False,
            ),
            (
                "social-bounds",
                "bounds",
                "socialBoundsResult",
                "Social Bounds",
                False,
            ),
        ):
            result = self._run_w8_scenario(
                scenario_id=scenario_id,
                variant_id=variant_id,
                result_field=result_field,
                purpose=purpose,
                requires_remote_recipient=requires_remote_recipient,
            )
            variants[variant_id] = result[result_field]
            runtime_roots[variant_id] = str(result["runtimeRoot"])
        return {
            "status": "FUNCTIONAL_PASS",
            "proofState": "UNPROVEN",
            "variantResults": variants,
            "runtimeRoots": runtime_roots,
        }

    def run_platform_action(
        self,
        command: PlatformRuntimeCommand,
    ) -> dict[str, Any]:
        if command.runtime == "mobile":
            return self._run_mobile_platform_action(command)
        return self._run_desktop_platform_action(command)

    def _run_mobile_platform_action(
        self,
        command: PlatformRuntimeCommand,
    ) -> dict[str, Any]:
        identity = _require_clean_source(self.repo_root, self.result_root)
        _activate_scenario_journey(
            self.repo_root,
            command.journey_id,
            work_item_id=command.work_item_id,
            task_id=command.task_id,
        )
        resolved, primary_profile_env = _resolve_machine_profile(
            self.repo_root
        )
        profile_environments = {PROFILE: primary_profile_env}
        if SECONDARY_PROFILE in command.profiles:
            _path, secondary_profile_env = _resolve_secondary_profile(
                resolved
            )
            profile_environments[SECONDARY_PROFILE] = secondary_profile_env

        run_id = (
            f"{command.task_id.lower()}-{command.action.removeprefix('run-')}-"
            f"{identity['head'][:12]}-{os.getpid()}"
        )
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
            / command.journey_id
            / acceptance_run_id
        ).mkdir(parents=True, mode=0o700)
        bindings = tuple(
            (
                STATION_ID
                if profile_id == PROFILE
                else SECONDARY_STATION_ID,
                profile_environments[profile_id],
            )
            for profile_id in command.profiles
        )
        transport_stack, station_endpoints = _open_station_tunnels(bindings)
        attestations: dict[str, Any] = {}
        try:
            with _environment(
                {
                    "PT_ACCEPTANCE_ARTIFACT_ROOT": str(attestation_store),
                    "PT_ACCEPTANCE_WORKSPACE_ID": identity["workspaceId"],
                    "PT_ACCEPTANCE_GATE_ID": command.journey_id,
                    "PT_ACCEPTANCE_RUN_ID": acceptance_run_id,
                }
            ):
                for service_id, profile_env in bindings:
                    attestations[service_id] = produce_station_attestation(
                        environment_id=(
                            "secure-content-development-mobile-runtime"
                        ),
                        run_id=run_id,
                        service_id=service_id,
                        station_url=station_endpoints[
                            service_id
                        ].transport_url,
                        profile_env=profile_env,
                        require_runtime_identity=True,
                        remote_source_identity_provider=(
                            resolve_remote_source_identity
                        ),
                    )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise RuntimeOwnerBlocked(
                "SERVICE_ATTESTATION_UNAVAILABLE",
                _error_message_with_cleanup(error),
                resource="station:secure-content-mobile",
            ) from error
        protocol_digest = source_proto_digest(self.repo_root)
        if any(
            not commits_match(attestation.live_commit, identity["head"])
            or attestation.protocol_digest != protocol_digest
            for attestation in attestations.values()
        ):
            error = RuntimeOwnerBlocked(
                "SOURCE_ATTESTATION_MISMATCH",
                "Mobile Stations are not deployed from the exact source",
                resource="station:secure-content-mobile",
            )
            _close_runtime_stack(transport_stack, primary_error=error)
            raise error

        schema_bindings: dict[
            str,
            runtime_manifest.CanonicalPrivateSchemaAttestationBinding,
        ] = {}
        try:
            for service_id, profile_env in bindings:
                profile_id = str(profile_env["PT_DEV_PROFILE"])
                schema_bindings[service_id] = (
                    _resolve_canonical_private_schema_attestation(
                        self.result_root,
                        self.repo_root,
                        identity,
                        attestations[service_id],
                        service_id=service_id,
                        profile_id=profile_id,
                        attested_endpoint=profile_env["PT_STATION_URL"],
                        accepted_intents=(
                            ("FINAL_CUT",)
                            if command.task_id == "W12"
                            else ("SCHEMA_ACTIVATION",)
                        ),
                    )
                )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise

        with _runtime_cleanup_scope(transport_stack) as stack:
            base_contract = EnvironmentContract.from_yaml(
                ENVIRONMENTS_DIR / "mobile-simulator.yaml"
            )
            provisioner = SelectedMobileSimulatorProvisioner(
                base_contract,
                clients=command.mobile_clients,
                runtime_source_commit=str(identity["head"]),
                repo_root=self.repo_root,
                runtime_base=owner_root / "simulator",
            )
            stack.callback(
                _cleanup_mobile_provisioner_or_raise,
                provisioner,
            )
            provisioned = provisioner.provision(command.journey_id)
            if (
                not isinstance(
                    provisioned,
                    MobileSimulatorRuntimeManifest,
                )
                or provisioned.is_blocked()
            ):
                raise RuntimeOwnerBlocked(
                    "CLIENT_RUNTIME_UNAVAILABLE",
                    (
                        provisioned.blocked_reason
                        or "Mobile simulator provisioning did not complete"
                    ),
                    resource=(
                        provisioned.blocked_resource
                        or "mobile-simulator"
                    ),
                )
            resources = provisioned.simulator_resources
            client_resources = _mobile_mapping(
                resources.get("clients"),
                "client resources",
                client_id="mobile-runtime",
            )
            appium = _mobile_mapping(
                resources.get("appium"),
                "Appium resources",
                client_id="mobile-runtime",
            )
            appium_endpoint = _required_text(
                appium.get("serverUrl"),
                "Mobile Appium endpoint",
            )
            accounts, password = _provision_runtime_accounts(
                primary_station_url=station_endpoints[
                    STATION_ID
                ].transport_url,
                secondary_station_url=(
                    station_endpoints[
                        SECONDARY_STATION_ID
                    ].transport_url
                    if SECONDARY_STATION_ID in station_endpoints
                    else None
                ),
                run_id=run_id,
                roles=tuple(
                    sorted(
                        {
                            client.role
                            for client in command.mobile_clients
                        }
                    )
                ),
                secondary_roles=(
                    ("bob",)
                    if SECONDARY_PROFILE in command.profiles
                    else ()
                ),
            )
            services: dict[str, dict[str, Any]] = {}
            for service_id, profile_env in bindings:
                attestation_ref = _publish_attestation(
                    owner_root,
                    attestations[service_id],
                    run_id=run_id,
                    journey_id=command.journey_id,
                    service_id=service_id,
                )
                schema_ref = _publish_canonical_private_schema_attestation(
                    owner_root,
                    service_id,
                    schema_bindings[service_id],
                )
                services[service_id] = _service_payload(
                    attestations[service_id],
                    attestation_ref,
                    schema_ref,
                    profile_id=str(profile_env["PT_DEV_PROFILE"]),
                    schema_attestation_endpoint=profile_env[
                        "PT_STATION_URL"
                    ],
                )

            sessions: dict[str, Any] = {}
            actor_ptids: dict[str, str] = {}
            client_payloads: list[dict[str, Any]] = []
            for client in command.mobile_clients:
                service_id = _mobile_service_for_client(
                    client.id,
                    command.profiles,
                )
                session = provisioner.create_appium_session(
                    provisioned,
                    client.id,
                )
                stack.callback(
                    _stop_mobile_session_or_raise,
                    session,
                    client_id=client.id,
                )
                actor_ptid, scope, build = _start_mobile_client(
                    session,
                    client_id=client.id,
                    account=accounts[client.role],
                    password=password,
                    station_endpoint=station_endpoints[service_id],
                    station_runtime_identity=(
                        attestations[service_id].runtime_identity
                    ),
                    source_commit=str(identity["head"]),
                    required_actions=(
                        load_platform_runtime_contract().mobile_harness_actions
                    ),
                )
                sessions[client.id] = session
                actor_ptids[client.id] = actor_ptid
                client_payloads.append(
                    _mobile_client_payload(
                        client_id=client.id,
                        actor_role=client.role,
                        actor_ptid=actor_ptid,
                        session=session,
                        resource=_mobile_mapping(
                            client_resources.get(client.id),
                            "client resource",
                            client_id=client.id,
                        ),
                        service_id=service_id,
                        service=services[service_id],
                        source_commit=str(identity["head"]),
                        build=build,
                        scope=scope,
                        appium_endpoint=appium_endpoint,
                    )
                )

            federation_id = _prepare_mobile_friendship(
                sessions,
                actor_ptids,
                accounts,
                services,
            )
            actions = MobileProductionFixture(
                sessions=sessions,
                actor_ptids=actor_ptids,
                federation_id=federation_id,
            )
            fixture_identity = _sha256(
                json.dumps(
                    {
                        "action": command.action,
                        "clients": sorted(command.clients),
                        "runId": run_id,
                        "source": identity["head"],
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
            fixture_owner = RuntimeFixtureOwner(
                source_checkpoint=str(identity["head"]),
                run_id=run_id,
                fixture_set_id=f"{command.task_id.lower()}-{command.action}",
                bindings=(
                    RuntimeFixtureBinding(
                        capability=command.fixture_capability,
                        owner="mobile-product-fixture-owner",
                        opaque_id=f"{command.action}-fixture",
                        expected_identity_digest=fixture_identity,
                        operations=command.fixture_operations,
                        action=actions.execute,
                        sensitive_values=(password, *accounts.values()),
                    ),
                ),
            )
            fixture_path = fixture_owner.write_manifest(
                owner_root / "fixture.json"
            )
            fixture = fixture_owner.manifest()
            fixture_ref = {
                "path": fixture_path.name,
                "sha256": _sha256(fixture_path.read_bytes()),
            }
            manifest_path = _write_owned_runtime_manifest(
                payload=_manifest_payload(
                    identity=identity,
                    journey_id=command.journey_id,
                    run_id=run_id,
                    services=services,
                    fixture_ref=fixture_ref,
                    fixture_digest=str(fixture["manifest_digest"]),
                    clients=client_payloads,
                ),
                output_path=owner_root / "runtime.json",
                repo_root=self.repo_root,
            )
            manifest = json.loads(
                manifest_path.read_text(encoding="utf-8")
            )
            fixture_context, fixture_client = (
                fixture_owner.open_action_channel(
                    workspace_id=str(identity["workspaceId"]),
                    gate_id=command.journey_id,
                    runtime_manifest_digests=(
                        str(manifest["manifest_digest"]),
                    ),
                )
            )
            stack.callback(
                _close_fixture_action_channel,
                fixture_context,
                fixture_client,
            )
            result = execute_scenario(
                runtime=command.runtime,
                scenario_id=command.scenario_id,
                budget_seconds=command.budget_seconds,
                repo_root=self.repo_root,
                profile=command.profile,
                profiles=(
                    () if command.profile is not None else command.profiles
                ),
                clients=command.clients,
                runtime_manifest_path=manifest_path,
                result_root=self.result_root,
                workspace_identity=identity,
                fixture_action_client=fixture_client,
            )
        return {
            "status": result["result"],
            "proofState": "UNPROVEN",
            "action": command.action,
            "result": result["result"],
            "runtimeRoot": str(owner_root),
        }

    def _run_desktop_platform_action(
        self,
        command: PlatformRuntimeCommand,
    ) -> dict[str, Any]:
        identity = _require_clean_source(self.repo_root, self.result_root)
        _activate_scenario_journey(
            self.repo_root,
            command.journey_id,
            work_item_id=command.work_item_id,
            task_id=command.task_id,
        )
        resolved, primary_profile_env = _resolve_machine_profile(
            self.repo_root
        )
        profile_environments = {PROFILE: primary_profile_env}
        if SECONDARY_PROFILE in command.profiles:
            _path, secondary_profile_env = _resolve_secondary_profile(
                resolved
            )
            profile_environments[SECONDARY_PROFILE] = secondary_profile_env
        bindings = tuple(
            (
                STATION_ID
                if profile_id == PROFILE
                else SECONDARY_STATION_ID,
                profile_environments[profile_id],
            )
            for profile_id in command.profiles
        )
        run_id = (
            f"{command.task_id.lower()}-{command.action.removeprefix('run-')}-"
            f"{identity['head'][:12]}-{os.getpid()}"
        )
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
            / command.journey_id
            / acceptance_run_id
        ).mkdir(parents=True, mode=0o700)
        transport_stack, station_endpoints = _open_station_tunnels(bindings)
        attestations: dict[str, Any] = {}
        try:
            with _environment(
                {
                    "PT_ACCEPTANCE_ARTIFACT_ROOT": str(attestation_store),
                    "PT_ACCEPTANCE_WORKSPACE_ID": identity["workspaceId"],
                    "PT_ACCEPTANCE_GATE_ID": command.journey_id,
                    "PT_ACCEPTANCE_RUN_ID": acceptance_run_id,
                }
            ):
                for service_id, profile_env in bindings:
                    attestations[service_id] = produce_station_attestation(
                        environment_id=(
                            "secure-content-development-desktop-runtime"
                        ),
                        run_id=run_id,
                        service_id=service_id,
                        station_url=station_endpoints[
                            service_id
                        ].transport_url,
                        profile_env=profile_env,
                        require_runtime_identity=True,
                        remote_source_identity_provider=(
                            resolve_remote_source_identity
                        ),
                    )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise RuntimeOwnerBlocked(
                "SERVICE_ATTESTATION_UNAVAILABLE",
                _error_message_with_cleanup(error),
                resource="station:secure-content-desktop",
            ) from error
        protocol_digest = source_proto_digest(self.repo_root)
        if any(
            not commits_match(attestation.live_commit, identity["head"])
            or attestation.protocol_digest != protocol_digest
            for attestation in attestations.values()
        ):
            error = RuntimeOwnerBlocked(
                "SOURCE_ATTESTATION_MISMATCH",
                "Desktop Stations are not deployed from the exact source",
                resource="station:secure-content-desktop",
            )
            _close_runtime_stack(transport_stack, primary_error=error)
            raise error

        schema_bindings: dict[
            str,
            runtime_manifest.CanonicalPrivateSchemaAttestationBinding,
        ] = {}
        try:
            for service_id, profile_env in bindings:
                profile_id = str(profile_env["PT_DEV_PROFILE"])
                schema_bindings[service_id] = (
                    _resolve_canonical_private_schema_attestation(
                        self.result_root,
                        self.repo_root,
                        identity,
                        attestations[service_id],
                        service_id=service_id,
                        profile_id=profile_id,
                        attested_endpoint=profile_env["PT_STATION_URL"],
                        accepted_intents=(
                            ("FINAL_CUT",)
                            if command.task_id == "W12"
                            else ("SCHEMA_ACTIVATION",)
                        ),
                    )
                )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise

        with _runtime_cleanup_scope(transport_stack) as stack:
            roles = tuple(
                sorted(
                    {
                        _desktop_actor_role(client_id)
                        for client_id in command.clients
                        if _desktop_actor_role(client_id) != "anonymous"
                    }
                )
            )
            secondary_roles = tuple(
                sorted(
                    {
                        _desktop_actor_role(client_id)
                        for client_id in command.clients
                        if _desktop_service_for_client(
                            client_id,
                            command.profiles,
                        )
                        == SECONDARY_STATION_ID
                        and _desktop_actor_role(client_id) != "anonymous"
                    }
                )
            )
            accounts, password = _provision_runtime_accounts(
                primary_station_url=station_endpoints[
                    STATION_ID
                ].transport_url,
                secondary_station_url=(
                    station_endpoints[
                        SECONDARY_STATION_ID
                    ].transport_url
                    if SECONDARY_STATION_ID in station_endpoints
                    else None
                ),
                run_id=run_id,
                roles=roles,
                secondary_roles=secondary_roles,
            )
            reserved_ports: set[int] = set()
            active_client_ids: set[int] = set()
            clients: dict[str, FoundationRuntimeClient] = {}
            payloads: list[dict[str, Any]] = []
            for index, client_id in enumerate(command.clients):
                actor_role = _desktop_actor_role(client_id)
                service_id = _desktop_service_for_client(
                    client_id,
                    command.profiles,
                )
                profile_id = (
                    PROFILE
                    if service_id == STATION_ID
                    else SECONDARY_PROFILE
                )
                client = _make_client(
                    repo_root=self.repo_root,
                    runtime_root=owner_root,
                    station_url=station_endpoints[
                        service_id
                    ].transport_url,
                    profile_env=profile_environments[profile_id],
                    source_commit=str(identity["head"]),
                    client_id=client_id,
                    runtime_kind=(
                        "browser"
                        if command.runtime == "browser"
                        else "native-tauri"
                    ),
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
                    purpose=command.action,
                    active_client_ids=active_client_ids,
                )
                active_client_ids.add(id(client))
                account = (
                    None
                    if actor_role == "anonymous"
                    else accounts[actor_role]
                )
                snapshot = _start_client(
                    client,
                    account=account,
                    password=password,
                    anonymous_binding_account=(
                        accounts.get("browser_actor")
                        if actor_role == "anonymous"
                        else None
                    ),
                )
                if account is not None and command.runtime != "browser":
                    _wait_for_device_enrollment(client)
                clients[client_id] = client
                payloads.append(
                    _client_payload(
                        client_id,
                        actor_role,
                        client,
                        snapshot,
                        service_roles={"station": service_id},
                    )
                )
            for service_id in {
                _desktop_service_for_client(
                    client_id,
                    command.profiles,
                )
                for client_id in command.clients
            }:
                service_clients = [
                    clients[client_id]
                    for client_id in command.clients
                    if _desktop_service_for_client(
                        client_id,
                        command.profiles,
                    )
                    == service_id
                    and _desktop_actor_role(client_id)
                    in {"alice", "bob"}
                ]
                by_role = {
                    _desktop_actor_role(client_id): clients[client_id]
                    for client_id in command.clients
                    if _desktop_service_for_client(
                        client_id,
                        command.profiles,
                    )
                    == service_id
                    and _desktop_actor_role(client_id)
                    in {"alice", "bob"}
                }
                if len(service_clients) >= 2 and set(by_role) == {
                    "alice",
                    "bob",
                }:
                    _prepare_accepted_friendship(
                        by_role["alice"],
                        by_role["bob"],
                    )

            services: dict[str, dict[str, Any]] = {}
            for service_id, profile_env in bindings:
                attestation_ref = _publish_attestation(
                    owner_root,
                    attestations[service_id],
                    run_id=run_id,
                    journey_id=command.journey_id,
                    service_id=service_id,
                )
                schema_ref = _publish_canonical_private_schema_attestation(
                    owner_root,
                    service_id,
                    schema_bindings[service_id],
                )
                services[service_id] = _service_payload(
                    attestations[service_id],
                    attestation_ref,
                    schema_ref,
                    profile_id=str(profile_env["PT_DEV_PROFILE"]),
                    schema_attestation_endpoint=profile_env[
                        "PT_STATION_URL"
                    ],
                )
            fixture_actions = _DesktopProductionFixture(clients)
            fixture_identity = _sha256(
                json.dumps(
                    {
                        "action": command.action,
                        "clients": sorted(command.clients),
                        "runId": run_id,
                        "source": identity["head"],
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
            fixture_owner = RuntimeFixtureOwner(
                source_checkpoint=str(identity["head"]),
                run_id=run_id,
                fixture_set_id=f"{command.task_id.lower()}-{command.action}",
                bindings=(
                    RuntimeFixtureBinding(
                        capability=command.fixture_capability,
                        owner="desktop-product-fixture-owner",
                        opaque_id=f"{command.action}-fixture",
                        expected_identity_digest=fixture_identity,
                        operations=command.fixture_operations,
                        action=fixture_actions.execute,
                        sensitive_values=(password, *accounts.values()),
                    ),
                ),
            )
            fixture_path = fixture_owner.write_manifest(
                owner_root / "fixture.json"
            )
            fixture = fixture_owner.manifest()
            manifest_path = write_attached_runtime_manifest(
                manifest_payload=_manifest_payload(
                    identity=identity,
                    journey_id=command.journey_id,
                    run_id=run_id,
                    services=services,
                    fixture_ref={
                        "path": fixture_path.name,
                        "sha256": _sha256(fixture_path.read_bytes()),
                    },
                    fixture_digest=str(fixture["manifest_digest"]),
                    clients=payloads,
                ),
                output_path=owner_root / "runtime.json",
                journey_id=command.journey_id,
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
            manifest = json.loads(
                manifest_path.read_text(encoding="utf-8")
            )
            fixture_context, fixture_client = (
                fixture_owner.open_action_channel(
                    workspace_id=str(identity["workspaceId"]),
                    gate_id=command.journey_id,
                    runtime_manifest_digests=(
                        str(manifest["manifest_digest"]),
                    ),
                )
            )
            stack.callback(
                _close_fixture_action_channel,
                fixture_context,
                fixture_client,
            )
            result = execute_scenario(
                runtime=command.runtime,
                scenario_id=command.scenario_id,
                budget_seconds=command.budget_seconds,
                repo_root=self.repo_root,
                profile=command.profile,
                profiles=(
                    () if command.profile is not None else command.profiles
                ),
                clients=command.clients,
                runtime_manifest_path=manifest_path,
                result_root=self.result_root,
                workspace_identity=identity,
                fixture_action_client=fixture_client,
            )
            for client in reversed(tuple(clients.values())):
                _stop_client_or_raise(
                    client,
                    purpose=command.action,
                    active_client_ids=active_client_ids,
                )
            clients.clear()
        return {
            "status": result["result"],
            "proofState": "UNPROVEN",
            "action": command.action,
            "result": result["result"],
            "runtimeRoot": str(owner_root),
        }

    def _run_w8_scenario(
        self,
        *,
        scenario_id: str,
        variant_id: str,
        result_field: str,
        purpose: str,
        requires_remote_recipient: bool,
    ) -> dict[str, Any]:
        identity = _require_clean_source(self.repo_root, self.result_root)
        _activate_scenario_journey(
            self.repo_root,
            W8_JOURNEY,
            work_item_id=W8_WORK_ITEM_ID,
            task_id=W8_TASK_ID,
        )
        resolved, profile_env = _resolve_machine_profile(self.repo_root)
        secondary_profile_env: dict[str, str] | None = None
        if requires_remote_recipient:
            _secondary_profile_path, secondary_profile_env = (
                _resolve_secondary_profile(resolved)
            )
        run_id = f"w8-{variant_id}-{identity['head'][:12]}-{os.getpid()}"
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
        profile_bindings: list[tuple[str, Mapping[str, str]]] = [
            (STATION_ID, profile_env),
        ]
        if secondary_profile_env is not None:
            profile_bindings.append(
                (SECONDARY_STATION_ID, secondary_profile_env)
            )
        transport_stack, station_endpoints = _open_station_tunnels(
            profile_bindings
        )
        station_url = station_endpoints[STATION_ID].transport_url
        secondary_station_url = (
            station_endpoints[SECONDARY_STATION_ID].transport_url
            if SECONDARY_STATION_ID in station_endpoints
            else None
        )
        secondary_attestation = None
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
                if (
                    secondary_profile_env is not None
                    and secondary_station_url is not None
                ):
                    secondary_attestation = produce_station_attestation(
                        environment_id="secure-content-w8-runtime",
                        run_id=run_id,
                        service_id=SECONDARY_STATION_ID,
                        station_url=secondary_station_url,
                        profile_env=secondary_profile_env,
                        require_runtime_identity=True,
                        remote_source_identity_provider=(
                            resolve_remote_source_identity
                        ),
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
            or (
                requires_remote_recipient
                and (
                    secondary_attestation is None
                    or not commits_match(
                        secondary_attestation.live_commit,
                        identity["head"],
                    )
                    or secondary_attestation.protocol_digest
                    != source_proto_digest(self.repo_root)
                )
            )
        ):
            error = RuntimeOwnerBlocked(
                "SOURCE_ATTESTATION_MISMATCH",
                "W8 Stations are not deployed from the exact source",
                resource="station:secure-content-w8",
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
            secondary_schema_attestation = None
            if (
                secondary_profile_env is not None
                and secondary_attestation is not None
            ):
                secondary_schema_attestation = (
                    _resolve_canonical_private_schema_attestation(
                        self.result_root,
                        self.repo_root,
                        identity,
                        secondary_attestation,
                        service_id=SECONDARY_STATION_ID,
                        profile_id=SECONDARY_PROFILE,
                        attested_endpoint=secondary_profile_env[
                            "PT_STATION_URL"
                        ],
                    )
                )
        except Exception as error:
            _close_runtime_stack(transport_stack, primary_error=error)
            raise

        with _runtime_cleanup_scope(transport_stack) as stack:
            accounts, password = _provision_runtime_accounts(
                primary_station_url=station_url,
                run_id=run_id,
                roles=("alice", "bob", "eve"),
            )
            remote_provisioner: RemotePrivateRecipientProvisioner | None = None
            if requires_remote_recipient:
                if secondary_station_url is None:
                    raise RuntimeOwnerBlocked(
                        "FIXTURE_OWNER_UNAVAILABLE",
                        "W8 remote recipient requires the fiveArm Station",
                        resource=f"station:{SECONDARY_STATION_ID}",
                    )
                remote_provisioner = RemotePrivateRecipientProvisioner(
                    source_checkpoint=str(identity["head"]),
                    run_id=run_id,
                    station_url=secondary_station_url,
                    password=password,
                    account_registrar=_register_runtime_account,
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
                    purpose=purpose,
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

            fixture_owner: W8RemoteRecipientFixtureOwner | None = None
            if requires_remote_recipient:
                if (
                    secondary_profile_env is None
                    or secondary_station_url is None
                    or remote_provisioner is None
                ):
                    raise RuntimeOwnerBlocked(
                        "FIXTURE_OWNER_UNAVAILABLE",
                        "W8 fiveArm runtime binding is incomplete",
                        resource=f"fixture:{W8_REMOTE_RECIPIENT_CAPABILITY}",
                    )
                remote_client_id, remote_actor, _remote_account_role = (
                    W8_REMOTE_CLIENT
                )
                remote_client = _make_client(
                    repo_root=self.repo_root,
                    runtime_root=owner_root,
                    station_url=secondary_station_url,
                    profile_env=secondary_profile_env,
                    source_commit=str(identity["head"]),
                    client_id=remote_client_id,
                    runtime_kind="native-tauri",
                    port_bases=(3650, 3830, 4615),
                    reserved_ports=reserved_ports,
                )
                stack.callback(
                    _stop_client_or_raise,
                    remote_client,
                    purpose=purpose,
                    active_client_ids=active_client_ids,
                )
                active_client_ids.add(id(remote_client))
                remote_snapshot = _start_client(
                    remote_client,
                    account=remote_provisioner.account,
                    password=password,
                )
                _wait_for_device_enrollment(remote_client)
                _wait_for_mls_readiness(remote_client)
                clients[remote_client_id] = remote_client
                payloads.append(
                    _client_payload(
                        remote_client_id,
                        remote_actor,
                        remote_client,
                        remote_snapshot,
                        service_roles={"station": SECONDARY_STATION_ID},
                    )
                )
                try:
                    fixture_owner = remote_provisioner.bind_identity(
                        primary_client=clients[DESKTOP_CLIENTS[0][0]],
                        remote_client=remote_client,
                        identity_reader=_moments_harness,
                        authority_reader=_moments_harness,
                        federation_action=_moments_harness,
                    )
                except ValueError as error:
                    raise RuntimeOwnerBlocked(
                        "FIXTURE_OWNER_UNAVAILABLE",
                        str(error),
                        resource=(
                            f"fixture:{W8_REMOTE_RECIPIENT_CAPABILITY}"
                        ),
                    ) from error

            for client_id, _actor, _account_role in DESKTOP_CLIENTS:
                _prepare_private_content_keys(clients[client_id])
            _prepare_accepted_friendship(
                clients[DESKTOP_CLIENTS[0][0]],
                clients[DESKTOP_CLIENTS[1][0]],
            )
            fixture: dict[str, Any]
            if fixture_owner is None:
                fixture = {
                    "schema_version": 1,
                    "kind": runtime_manifest.FIXTURE_MANIFEST_KIND,
                    "fixture_set_id": f"secure-content-w8-{variant_id}",
                    "source_checkpoint": identity["head"],
                    "handles": [],
                }
                fixture["manifest_digest"] = runtime_manifest.canonical_digest(
                    fixture
                )
            else:
                fixture = fixture_owner.manifest()
            fixture_path = _write_immutable_json(
                owner_root / "fixture.json",
                fixture,
            )
            fixture_digest = str(fixture["manifest_digest"])
            runtime_dir = owner_root / variant_id
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
            services = {
                STATION_ID: _service_payload(
                    attestation,
                    attestation_ref,
                    schema_attestation_ref,
                    profile_id=PROFILE,
                    schema_attestation_endpoint=profile_env["PT_STATION_URL"],
                ),
            }
            if (
                secondary_profile_env is not None
                and secondary_attestation is not None
                and secondary_schema_attestation is not None
            ):
                secondary_attestation_ref = _publish_attestation(
                    runtime_dir,
                    secondary_attestation,
                    run_id=run_id,
                    journey_id=W8_JOURNEY,
                    service_id=SECONDARY_STATION_ID,
                )
                secondary_schema_attestation_ref = (
                    _publish_canonical_private_schema_attestation(
                        runtime_dir,
                        SECONDARY_STATION_ID,
                        secondary_schema_attestation,
                    )
                )
                services[SECONDARY_STATION_ID] = _service_payload(
                    secondary_attestation,
                    secondary_attestation_ref,
                    secondary_schema_attestation_ref,
                    profile_id=SECONDARY_PROFILE,
                    schema_attestation_endpoint=secondary_profile_env[
                        "PT_STATION_URL"
                    ],
                )
            manifest_path = write_attached_runtime_manifest(
                manifest_payload=_manifest_payload(
                    identity=identity,
                    journey_id=W8_JOURNEY,
                    run_id=run_id,
                    services=services,
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
            fixture_action_client: EphemeralGateClient | None = None
            if fixture_owner is not None:
                manifest = json.loads(
                    manifest_path.read_text(encoding="utf-8")
                )
                fixture_context, fixture_action_client = (
                    fixture_owner.open_action_channel(
                        workspace_id=str(identity["workspaceId"]),
                        gate_id=W8_JOURNEY,
                        runtime_manifest_digests=(
                            str(manifest["manifest_digest"]),
                        ),
                    )
                )
                stack.callback(
                    _close_fixture_action_channel,
                    fixture_context,
                    fixture_action_client,
                )
            selected_profiles = (
                (PROFILE, SECONDARY_PROFILE)
                if requires_remote_recipient
                else ()
            )
            selected_clients = (
                tuple(item[0] for item in DESKTOP_CLIENTS)
                + ((W8_REMOTE_CLIENT[0],) if requires_remote_recipient else ())
            )
            result = execute_scenario(
                runtime="desktop",
                scenario_id=scenario_id,
                budget_seconds=1200,
                repo_root=self.repo_root,
                profile=None if requires_remote_recipient else PROFILE,
                profiles=selected_profiles,
                clients=selected_clients,
                runtime_manifest_path=manifest_path,
                result_root=self.result_root,
                workspace_identity=identity,
                fixture_action_client=fixture_action_client,
            )

            for client in reversed(tuple(clients.values())):
                _stop_client_or_raise(
                    client,
                    purpose=purpose,
                    active_client_ids=active_client_ids,
                )
            clients.clear()

        return {
            "status": "FUNCTIONAL_PASS",
            "proofState": "UNPROVEN",
            result_field: result["result"],
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
    platform_actions = tuple(
        sorted(load_platform_runtime_contract().commands)
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=(
            "preflight",
            "run",
            "run-private-comment",
            "run-social-expansion",
            *platform_actions,
        ),
    )
    parser.add_argument("--profile", default=PROFILE)
    parser.add_argument("--profiles")
    parser.add_argument("--secondary-profile")
    parser.add_argument("--slot", type=int, default=SLOT)
    parser.add_argument("--result-root", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    contract = load_platform_runtime_contract()
    platform_command = contract.commands.get(args.action)
    if args.profile != PROFILE or args.slot != SLOT:
        blocked = RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            "W7 runtime owner requires --profile four --slot 5",
            resource="profile:four",
        )
        print(json.dumps(blocked.payload(), sort_keys=True), file=sys.stderr)
        return 2
    if platform_command is not None:
        selected_profiles = (
            tuple(
                profile.strip()
                for profile in args.profiles.split(",")
                if profile.strip()
            )
            if isinstance(args.profiles, str)
            else (args.profile,)
        )
        if selected_profiles != platform_command.profiles:
            blocked = RuntimeOwnerBlocked(
                "CONTROLLER_BINDING_MISMATCH",
                (
                    f"{args.action} requires profiles "
                    + ",".join(platform_command.profiles)
                ),
                resource=f"runtime:{args.action}",
            )
            print(
                json.dumps(blocked.payload(), sort_keys=True),
                file=sys.stderr,
            )
            return 2
    if (
        args.action == "run-social-expansion"
        and args.secondary_profile != SECONDARY_PROFILE
    ):
        blocked = RuntimeOwnerBlocked(
            "CONTROLLER_BINDING_MISMATCH",
            (
                "W8 social-expansion runtime owner requires explicit "
                "--secondary-profile fiveArm"
            ),
            resource=f"profile:{SECONDARY_PROFILE}",
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
        elif args.action == "run-social-expansion":
            result = owner.run_social_expansion()
        elif platform_command is not None:
            result = owner.run_platform_action(platform_command)
        else:
            result = owner.run()
    except RuntimeOwnerBlocked as error:
        print(json.dumps(error.payload(), sort_keys=True), file=sys.stderr)
        return 2
    except (
        BlockedError,
        RunnerError,
        OSError,
        subprocess.SubprocessError,
        ValueError,
    ) as error:
        blocked = RuntimeOwnerBlocked(
            "RUNTIME_OWNER_FAILED",
            _error_message_with_cleanup(error),
            resource=(
                "runtime:secure-content-w8"
                if args.action in {"run-private-comment", "run-social-expansion"}
                else "runtime:secure-content-w7"
            ),
        )
        print(json.dumps(blocked.payload(), sort_keys=True), file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
