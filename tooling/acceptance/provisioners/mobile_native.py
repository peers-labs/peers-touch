from __future__ import annotations

import base64
import binascii
import dataclasses
import hashlib
import json
import math
import os
import platform
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Protocol

from tooling.acceptance.core import (
    EphemeralCapabilityBlocked,
    EphemeralCapabilityHandler,
    EphemeralGateLaunchContext,
    EphemeralHandlerCleanup,
    EvidenceStore,
    DriverError,
    RunHandle,
)
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR, REPO_ROOT
from tooling.acceptance.core.attestation import (
    produce_service_attestation,
    produce_station_attestation,
)
from tooling.acceptance.core.bounded_http import (
    HttpResponseBodyTooLarge,
    HttpResponseCancelled,
    HttpResponseDeadlineExceeded,
    HttpResponseDeadlineUnsupported,
    read_bounded_http_response,
)
from tooling.acceptance.core.errors import (
    BlockedError,
    EvidenceError,
    ProvisioningError,
)
from tooling.acceptance.core.evidence_store import ArtifactRef
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
    utc_now,
)
from tooling.acceptance.core.redaction import redact_value
from tooling.acceptance.fixtures.mobile_native_reset import (
    ACTOR_PASSWORD,
    ROLES,
    SERVICE_CONFIG,
    _write_fixture_outcomes,
    reset_fixture,
    resolve_actor_identity,
    verify_reset_target,
)
from tooling.acceptance.fixtures.mobile_oauth_station import (
    MobileOAuthStationFixture,
    SERVICES as MOBILE_OAUTH_FIXTURE_SERVICES,
)
from tooling.acceptance.fixtures.mobile_resource_lease import (
    BaselineRestoreResult,
    BrowserBaselineVerificationResult,
    CLIENT_PLATFORM,
    CLIENT_PROVIDER,
    MobileResourceLeaseBroker,
    MobileResourceLeaseHeartbeatOwner,
    PROVIDER_CLIENTS,
    ResolvedPhysicalDeviceHandle,
    RunScopedCorrelationSecret,
)
from tooling.acceptance.gates.mobile.proof_contracts import (
    GATE_ID as MOBILE_OAUTH_PROOF_GATE_ID,
    ProofContractError,
    validate_contract_payload,
)
from tooling.acceptance.provisioners.mobile_native_build import (
    MobileNativeBuildError,
    orchestrate_source_bound_build,
    produce_build_attestation,
    produce_scenario_build_attestation,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
)


EXPECTED_APPIUM_VERSION = "2.19.0"
EXPECTED_DRIVER_IDENTITIES = {
    "ios": ("appium-xcuitest-driver", "xcuitest", "XCUITest", "9.10.5"),
    "android": (
        "appium-uiautomator2-driver",
        "uiautomator2",
        "UiAutomator2",
        "4.2.9",
    ),
}
EXPECTED_CLIENTS = {
    "alice-ios": ("ios", "alice"),
    "bob-ios": ("ios", "bob"),
    "alice-android": ("android", "alice"),
    "bob-android": ("android", "bob"),
}
MOBILE_NATIVE_SCENARIO_GATES = {
    "access": "mobile-native-access-e2e",
    "lifecycle": "mobile-native-lifecycle-e2e",
    "platform": "mobile-native-platform-e2e",
}
HARNESS_INVENTORY_SCRIPT = """
const root = window.__PEERS_MOBILE_ACCEPTANCE__;
return root ? Object.keys(root).sort() : null;
"""
HARNESS_ACTION_SCRIPT = """
const action = arguments[0];
const input = arguments[1] || {};
const done = arguments[arguments.length - 1];
const root = window.__PEERS_MOBILE_ACCEPTANCE__;
if (!root || typeof root[action] !== 'function') {
  done({error: `acceptance.mobile.actionUnavailable:${action}`});
  return;
}
Promise.resolve(root[action](input))
  .then((value) => done({value}))
  .catch((error) => done({
    error: String(error && error.message || error),
  }));
"""
MAX_MOBILE_SCREENSHOT_BYTES = 64 * 1024 * 1024
MAX_MOBILE_SCREENSHOT_BASE64_BYTES = (
    4 * ((MAX_MOBILE_SCREENSHOT_BYTES + 2) // 3)
)
MAX_MOBILE_SCREENSHOT_RESPONSE_BYTES = (
    MAX_MOBILE_SCREENSHOT_BASE64_BYTES + 4096
)
MAX_APPIUM_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_APPIUM_ERROR_RESPONSE_BYTES = 1024 * 1024
MAX_MOBILE_PAGE_SOURCE_BYTES = 32 * 1024 * 1024
MAX_MOBILE_PAGE_SOURCE_RESPONSE_BYTES = 64 * 1024 * 1024
MOBILE_RESOURCE_LEASE_AUTH_KEY_BYTES = 32
MOBILE_NATIVE_PARENT_CLEANUP_TIMEOUT_SECONDS = 30.0
MOBILE_CAPTURE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,95}$")
MOBILE_CHANNEL_FORBIDDEN_FIELDS = frozenset(
    {
        "accesstoken",
        "authorizationcode",
        "authorizationurl",
        "bearertoken",
        "browserstorage",
        "callbackcode",
        "callbackreplayhandle",
        "cookie",
        "cookies",
        "deviceid",
        "deviceserial",
        "localstorage",
        "nonce",
        "password",
        "pkce",
        "pkceverifier",
        "attemptsecret",
        "privatekey",
        "provideremail",
        "providersubject",
        "providersubjectid",
        "refreshtoken",
        "serial",
        "sessionstorage",
        "token",
        "udid",
    }
)
MOBILE_CHANNEL_FORBIDDEN_VALUE_PATTERNS = (
    re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=-]{8,}"),
    re.compile(
        r"(?i)\b(?:(?:access|refresh)?[_-]?token|authorization[_-]?code|"
        r"provider[_-]?subject|code[_-]?verifier)\s*[:=]\s*[^\s,;]+"
    ),
    re.compile(
        r"(?i)[?&](?:code|state|token|nonce|code_verifier)=[^&#\s]+"
    ),
    re.compile(r"\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b"),
)
MOBILE_NATIVE_CAPABILITIES = {
    "mobile.native.appium-session": (
        "start",
        "stop",
        "wait_ready",
        "is_alive",
        "contexts",
        "switch_context",
        "harness_inventory",
        "harness_action",
        "harness_negative_callback",
        "refresh_webview",
        "find_element",
        "click",
        "capture_page_source",
        "capture_screenshot",
        "verify_build_identity",
    ),
    "mobile.native.provider-authorization": ("authorize",),
    "mobile.native.station-fixture": (
        "prepare_following_gate",
        "expire_awaiting_attempt",
        "read_proof_snapshot",
    ),
}
MOBILE_NATIVE_SCENARIO_APPIUM_OPERATIONS = frozenset(
    (
        *MOBILE_NATIVE_CAPABILITIES["mobile.native.appium-session"],
        "background_app",
    )
)
EXPECTED_PARENT_HARNESS_ACTIONS = frozenset(
    {
        "build.identity",
        "oauth.replayHandle",
        "oauth.negativeCallback",
    }
)
HARNESS_REGISTRATION_PATTERN = re.compile(
    r"""registerMobileAcceptanceAction\s*\(\s*['"]([^'"]+)['"]"""
)
VERSION_PATTERN = re.compile(r"(?<!\d)(\d+)(?:\.\d+){1,3}(?!\d)")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ANDROID_BROWSER_PACKAGES = (
    "com.android.chrome",
    "com.google.android.webview",
)


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


class CommandExecutor(Protocol):
    def run(
        self,
        command: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str],
        timeout: float,
    ) -> CommandResult:
        ...


class SubprocessExecutor:
    def run(
        self,
        command: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str],
        timeout: float,
    ) -> CommandResult:
        try:
            completed = subprocess.run(
                list(command),
                cwd=cwd,
                env=dict(env),
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise BlockedError(
                reason=(
                    "Mobile native command could not complete: "
                    f"{command[0]}: {type(error).__name__}"
                ),
                resource=f"mobile-runtime:command:{command[0]}",
            ) from error
        return CommandResult(
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )


@dataclass(frozen=True)
class AppiumDriverSpec:
    identity: str
    installed_name: str
    automation_name: str
    expected_version: str


@dataclass(frozen=True)
class ChromedriverArtifactSpec:
    browser_major: int
    driver_version: str
    source: str
    platform: str
    arch: str
    android_abis: tuple[str, ...]
    sha256: str
    cache_target: str
    executable_target: str


@dataclass(frozen=True)
class ChromedriverSpec:
    browser_packages: tuple[str, ...]
    cache_root: str
    cache_root_ref: str
    executable_ref: str
    acquisition_enabled: bool
    acquisition_mode: str
    artifacts: tuple[ChromedriverArtifactSpec, ...]


@dataclass(frozen=True)
class BrowserSessionSpec:
    owner: str
    provider: str
    credential_ref: str
    lease_ref: str


@dataclass(frozen=True)
class NativeClientSpec:
    id: str
    platform: str
    actor: str
    runtime: str
    destination_class_ref: str
    physical_device_lease_ref: str
    device_role: str
    profile: str
    port_roles: tuple[str, ...]
    storage_root: str
    session_lease: str
    browser_session: BrowserSessionSpec


@dataclass(frozen=True)
class MobileNativeScenarioSpec:
    id: str
    gate_id: str
    client_ids: tuple[str, ...]
    service_ids: tuple[str, ...]
    credential_ids: tuple[str, ...]
    fixture_ids: tuple[str, ...]
    provider_accounts: tuple[str, ...]
    browser_sessions: tuple[str, ...]
    harness_actions: tuple[str, ...]
    parent_harness_actions: tuple[str, ...]
    ephemeral_capabilities: tuple[str, ...]
    appium_operations: tuple[str, ...]
    require_exact_device_count: bool
    cleanup_resources: tuple[str, ...]


@dataclass(frozen=True)
class MobileNativePreflightSpec:
    scenario: MobileNativeScenarioSpec
    appium_server_url_ref: str
    appium_executable: str
    appium_expected_version: str
    appium_status_path: str
    drivers: dict[str, AppiumDriverSpec]
    ios_device_inventory_command: tuple[str, ...]
    ios_native_context: str
    ios_webview_context_prefix: str
    ios_wda_bundle_id_ref: str
    ios_webview_bundle_id_ref: str
    android_device_inventory_command: tuple[str, ...]
    chromedriver: ChromedriverSpec
    projects: dict[str, str]
    application_ids: dict[str, str]
    callback_schemes: dict[str, str]
    build_environment: dict[str, str]
    clients: tuple[NativeClientSpec, ...]
    harness_namespace: str
    harness_actions: tuple[str, ...]
    parent_harness_actions: tuple[str, ...]
    storage_root_ref: str
    lease_authentication_key_ref: str


class ArtifactReader(Protocol):
    def read_json(self, reference: ArtifactRef) -> dict[str, Any]:
        ...

    def resolve(self, reference: ArtifactRef) -> Path:
        ...


@dataclass(frozen=True)
class MobileNativeSourceArtifactRefs:
    build_attestations: Mapping[str, ArtifactRef]
    provider_account_leases: Mapping[str, ArtifactRef]
    physical_device_leases: Mapping[str, ArtifactRef]
    browser_session_leases: Mapping[str, ArtifactRef]


@dataclass(frozen=True)
class MobileNativeSourceProjection:
    applications: Mapping[str, Mapping[str, ArtifactRef]]
    provider_account_leases: Mapping[str, ArtifactRef]
    clients: Mapping[str, Mapping[str, ArtifactRef]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "applications": {
                platform: {
                    "buildAttestation": values["buildAttestation"].to_dict(),
                }
                for platform, values in self.applications.items()
            },
            "providerAccountLeases": {
                provider: reference.to_dict()
                for provider, reference in self.provider_account_leases.items()
            },
            "clients": {
                client_id: {
                    "physicalDeviceLease": values[
                        "physicalDeviceLease"
                    ].to_dict(),
                    "browserSessionLease": values[
                        "browserSessionLease"
                    ].to_dict(),
                }
                for client_id, values in self.clients.items()
            },
        }


@dataclass(frozen=True)
class MobileNativeScenarioSourceProjection:
    applications: Mapping[str, Mapping[str, ArtifactRef]]
    clients: Mapping[str, Mapping[str, ArtifactRef]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "applications": {
                platform: {
                    "buildAttestation": values["buildAttestation"].to_dict(),
                }
                for platform, values in self.applications.items()
            },
            "clients": {
                client_id: {
                    "physicalDeviceLease": values[
                        "physicalDeviceLease"
                    ].to_dict(),
                }
                for client_id, values in self.clients.items()
            },
        }


def _require_exact_source_dimensions(
    references: Mapping[str, ArtifactRef],
    expected: set[str],
    resource: str,
) -> None:
    actual = set(references)
    if actual != expected:
        raise BlockedError(
            reason=(
                f"Mobile native {resource} dimensions do not match; "
                f"missing={sorted(expected - actual)}, "
                f"extra={sorted(actual - expected)}"
            ),
            resource=f"mobile-source:{resource}",
        )


def _load_source_artifact(
    reader: ArtifactReader,
    reference: ArtifactRef,
    *,
    expected_path: str,
    expected_kind: str,
    expected_workspace_id: str,
    expected_run_id: str,
    expected_gate_id: str = MOBILE_OAUTH_PROOF_GATE_ID,
) -> dict[str, Any]:
    if (
        reference.artifact_kind != "acceptance-artifact-ref"
        or reference.workspace_id != expected_workspace_id
        or reference.gate_id != expected_gate_id
        or reference.run_id != expected_run_id
        or reference.path != expected_path
        or reference.media_type != "application/json"
    ):
        raise BlockedError(
            reason=(
                f"Mobile native source artifact identity is invalid: "
                f"{expected_path}"
            ),
            resource=f"mobile-source:{expected_kind}",
        )
    try:
        payload = reader.read_json(reference)
        return validate_contract_payload(
            payload,
            expected_kind=expected_kind,
            expected_run_id=expected_run_id,
            expected_gate_id=expected_gate_id,
            expected_workspace_id=expected_workspace_id,
        )
    except (EvidenceError, OSError, ProofContractError, TypeError, ValueError) as error:
        raise BlockedError(
            reason=(
                f"Mobile native source artifact failed validation: "
                f"{expected_path}: {error}"
            ),
            resource=f"mobile-source:{expected_kind}",
        ) from error


def _resolve_build_package(
    reader: ArtifactReader,
    payload: Mapping[str, Any],
    *,
    platform: str,
    expected_workspace_id: str,
    expected_run_id: str,
) -> ArtifactRef:
    package_kind = "ipa" if platform == "ios" else "apk"
    try:
        reference = ArtifactRef.from_dict(payload["artifact"]["artifactRef"])
        if (
            reference.artifact_kind != "acceptance-artifact-ref"
            or reference.workspace_id != expected_workspace_id
            or reference.gate_id != MOBILE_OAUTH_PROOF_GATE_ID
            or reference.run_id != expected_run_id
            or reference.path
            != f"runtime/mobile/builds/{platform}.{package_kind}"
            or reference.media_type != "application/octet-stream"
        ):
            raise ValueError("package ArtifactRef identity is invalid")
        reader.resolve(reference)
    except (
        EvidenceError,
        KeyError,
        OSError,
        TypeError,
        ValueError,
    ) as error:
        raise BlockedError(
            reason=(
                f"Mobile native {platform} package artifact failed "
                f"validation: {error}"
            ),
            resource=f"mobile-source:build-package:{platform}",
        ) from error
    return reference


def _load_scenario_build_attestation(
    reader: ArtifactReader,
    reference: ArtifactRef,
    *,
    platform: str,
    expected_gate_id: str,
    expected_workspace_id: str,
    expected_run_id: str,
) -> tuple[dict[str, Any], ArtifactRef]:
    expected_path = f"runtime/mobile/builds/{platform}.json"
    if (
        reference.artifact_kind != "acceptance-artifact-ref"
        or reference.workspace_id != expected_workspace_id
        or reference.gate_id != expected_gate_id
        or reference.run_id != expected_run_id
        or reference.path != expected_path
        or reference.media_type != "application/json"
    ):
        raise BlockedError(
            reason=(
                f"Mobile native {platform} scenario build ArtifactRef is invalid"
            ),
            resource=f"mobile-source:scenario-build:{platform}",
        )
    try:
        payload = reader.read_json(reference)
        build_identity = payload["buildIdentity"]
        artifact = payload["artifact"]
        package_ref = ArtifactRef.from_dict(artifact["artifactRef"])
        package_kind = "ipa" if platform == "ios" else "apk"
        if (
            payload.get("artifactKind")
            != "mobile-native-scenario-build-attestation"
            or payload.get("runId") != expected_run_id
            or payload.get("gateId") != expected_gate_id
            or not isinstance(build_identity, Mapping)
            or build_identity.get("platform") != platform
            or build_identity.get("harnessEnabled") is not True
            or artifact.get("kind") != package_kind
            or package_ref.workspace_id != expected_workspace_id
            or package_ref.gate_id != expected_gate_id
            or package_ref.run_id != expected_run_id
            or package_ref.path
            != f"runtime/mobile/builds/{platform}.{package_kind}"
            or package_ref.media_type != "application/octet-stream"
        ):
            raise ValueError("scenario build attestation shape is invalid")
        reader.resolve(package_ref)
    except (
        EvidenceError,
        KeyError,
        OSError,
        TypeError,
        ValueError,
    ) as error:
        raise BlockedError(
            reason=(
                f"Mobile native {platform} scenario build failed validation: "
                f"{error}"
            ),
            resource=f"mobile-source:scenario-build:{platform}",
        ) from error
    return payload, package_ref


def build_mobile_native_source_projection(
    artifacts: MobileNativeSourceArtifactRefs,
    *,
    reader: ArtifactReader,
    expected_workspace_id: str,
    expected_run_id: str,
) -> MobileNativeSourceProjection:
    """Validate E2-1/E2-3 refs without activating the E2-5 consumer cutover."""

    platforms = set(EXPECTED_DRIVER_IDENTITIES)
    providers = set(PROVIDER_CLIENTS)
    clients = set(EXPECTED_CLIENTS)
    _require_exact_source_dimensions(
        artifacts.build_attestations,
        platforms,
        "build-attestations",
    )
    _require_exact_source_dimensions(
        artifacts.provider_account_leases,
        providers,
        "provider-account-leases",
    )
    _require_exact_source_dimensions(
        artifacts.physical_device_leases,
        clients,
        "physical-device-leases",
    )
    _require_exact_source_dimensions(
        artifacts.browser_session_leases,
        clients,
        "browser-session-leases",
    )

    references = [
        *artifacts.build_attestations.values(),
        *artifacts.provider_account_leases.values(),
        *artifacts.physical_device_leases.values(),
        *artifacts.browser_session_leases.values(),
    ]
    identities = {
        (
            reference.workspace_id,
            reference.gate_id,
            reference.run_id,
            reference.path,
            reference.sha256,
        )
        for reference in references
    }
    if len(identities) != len(references):
        raise BlockedError(
            reason="Mobile native source artifacts contain duplicate references",
            resource="mobile-source:artifact-refs",
        )

    builds: dict[str, dict[str, Any]] = {}
    for platform in sorted(platforms):
        payload = _load_source_artifact(
            reader,
            artifacts.build_attestations[platform],
            expected_path=f"runtime/mobile/builds/{platform}.json",
            expected_kind="mobile-application-build-attestation",
            expected_workspace_id=expected_workspace_id,
            expected_run_id=expected_run_id,
        )
        expected_package_kind = "ipa" if platform == "ios" else "apk"
        if (
            payload["buildIdentity"]["platform"] != platform
            or payload["artifact"]["kind"] != expected_package_kind
        ):
            raise BlockedError(
                reason=f"Mobile native {platform} build attestation is mismatched",
                resource=f"mobile-source:build-attestation:{platform}",
            )
        _resolve_build_package(
            reader,
            payload,
            platform=platform,
            expected_workspace_id=expected_workspace_id,
            expected_run_id=expected_run_id,
        )
        builds[platform] = payload

    accounts: dict[str, dict[str, Any]] = {}
    for provider in sorted(providers):
        payload = _load_source_artifact(
            reader,
            artifacts.provider_account_leases[provider],
            expected_path=f"runtime/mobile/leases/accounts/{provider}.json",
            expected_kind="provider-account-lease",
            expected_workspace_id=expected_workspace_id,
            expected_run_id=expected_run_id,
        )
        if (
            payload["provider"] != provider
            or tuple(payload["allowedClientIds"]) != PROVIDER_CLIENTS[provider]
        ):
            raise BlockedError(
                reason=f"Mobile native {provider} account lease is mismatched",
                resource=f"mobile-source:provider-account:{provider}",
            )
        accounts[provider] = payload

    devices: dict[str, dict[str, Any]] = {}
    browsers: dict[str, dict[str, Any]] = {}
    for client_id in sorted(clients):
        platform = CLIENT_PLATFORM[client_id]
        provider = CLIENT_PROVIDER[client_id]
        device = _load_source_artifact(
            reader,
            artifacts.physical_device_leases[client_id],
            expected_path=f"runtime/mobile/leases/devices/{client_id}.json",
            expected_kind="physical-device-lease",
            expected_workspace_id=expected_workspace_id,
            expected_run_id=expected_run_id,
        )
        browser = _load_source_artifact(
            reader,
            artifacts.browser_session_leases[client_id],
            expected_path=f"runtime/mobile/leases/browsers/{client_id}.json",
            expected_kind="provider-browser-session-lease",
            expected_workspace_id=expected_workspace_id,
            expected_run_id=expected_run_id,
        )
        if (
            device["clientId"] != client_id
            or device["platform"] != platform
            or browser["clientId"] != client_id
            or browser["platform"] != platform
            or browser["physicalDeviceLeaseRef"]
            != f"physical-device-lease/{client_id}"
            or browser["providerAccountLeaseRef"]
            != f"provider-account-lease/{provider}"
            or client_id not in accounts[provider]["allowedClientIds"]
        ):
            raise BlockedError(
                reason=f"Mobile native {client_id} lease graph is mismatched",
                resource=f"mobile-source:client:{client_id}",
            )
        devices[client_id] = device
        browsers[client_id] = browser

    return MobileNativeSourceProjection(
        applications={
            platform: {
                "buildAttestation": artifacts.build_attestations[platform],
            }
            for platform in sorted(builds)
        },
        provider_account_leases={
            provider: artifacts.provider_account_leases[provider]
            for provider in sorted(accounts)
        },
        clients={
            client_id: {
                "physicalDeviceLease": artifacts.physical_device_leases[
                    client_id
                ],
                "browserSessionLease": artifacts.browser_session_leases[
                    client_id
                ],
            }
            for client_id in sorted(devices)
            if client_id in browsers
        },
    )


def _required_object(
    owner: dict[str, Any],
    name: str,
    resource: str,
) -> dict[str, Any]:
    value = owner.get(name)
    if not isinstance(value, dict):
        raise BlockedError(
            reason=f"Mobile native contract requires object {name!r}",
            resource=resource,
        )
    return value


def _required_text(
    owner: Mapping[str, Any],
    name: str,
    resource: str,
) -> str:
    value = str(owner.get(name) or "").strip()
    if not value:
        raise BlockedError(
            reason=f"Mobile native contract requires {name!r}",
            resource=resource,
        )
    return value


def _required_list(
    owner: Mapping[str, Any],
    name: str,
    resource: str,
) -> list[Any]:
    value = owner.get(name)
    if not isinstance(value, list):
        raise BlockedError(
            reason=f"Mobile native contract requires list {name!r}",
            resource=resource,
        )
    return value


def _required_command(
    owner: Mapping[str, Any],
    name: str,
    resource: str,
) -> tuple[str, ...]:
    value = _required_list(owner, name, resource)
    if not value or any(not isinstance(item, str) or not item for item in value):
        raise BlockedError(
            reason=f"Mobile native command {name!r} is invalid",
            resource=resource,
        )
    return tuple(value)


def _parse_version(value: str, resource: str) -> tuple[str, int]:
    match = VERSION_PATTERN.search(value)
    if match is None:
        raise BlockedError(
            reason=f"Cannot parse a dotted version from {value!r}",
            resource=resource,
        )
    version = match.group(0)
    return version, int(match.group(1))


def _relative_cache_path(value: str, resource: str) -> str:
    path = Path(value)
    if path.is_absolute() or not path.parts or ".." in path.parts:
        raise BlockedError(
            reason=f"Chromedriver cache path must be relative: {value!r}",
            resource=resource,
        )
    return path.as_posix()


def _load_chromedriver_spec(android: Mapping[str, Any]) -> ChromedriverSpec:
    raw = _required_object(
        dict(android),
        "chromedriver",
        "mobile-contract:chromedriver",
    )
    packages = tuple(
        _required_list(
            raw,
            "browser_packages",
            "mobile-contract:android-browser-packages",
        )
    )
    if packages != ANDROID_BROWSER_PACKAGES:
        raise BlockedError(
            reason=(
                "Mobile native browser packages must declare Chrome and "
                "Android System WebView in deterministic order"
            ),
            resource="mobile-contract:android-browser-packages",
        )
    cache_root = _required_text(
        raw,
        "cache_root",
        "mobile-contract:chromedriver-cache",
    )
    if cache_root != "<runtime-cache>/chromedriver":
        raise BlockedError(
            reason=(
                "Mobile native Chromedriver cache must use the external "
                "<runtime-cache>/chromedriver root"
            ),
            resource="mobile-contract:chromedriver-cache",
        )
    acquisition = _required_object(
        raw,
        "acquisition",
        "mobile-contract:chromedriver-acquisition",
    )
    if acquisition.get("enabled") is not False or _required_text(
        acquisition,
        "mode",
        "mobile-contract:chromedriver-acquisition",
    ) != "preseeded":
        raise BlockedError(
            reason=(
                "Mobile native Chromedriver acquisition must be disabled "
                "and use preseeded mode"
            ),
            resource="mobile-contract:chromedriver-acquisition",
        )

    artifacts: list[ChromedriverArtifactSpec] = []
    for raw_artifact in _required_list(
        raw,
        "artifacts",
        "mobile-contract:chromedriver-artifacts",
    ):
        if not isinstance(raw_artifact, dict):
            raise BlockedError(
                reason="Chromedriver artifact entries must be objects",
                resource="mobile-contract:chromedriver-artifacts",
            )
        browser_major = raw_artifact.get("browser_major")
        if not isinstance(browser_major, int) or browser_major <= 0:
            raise BlockedError(
                reason="Chromedriver browser_major must be positive",
                resource="mobile-contract:chromedriver-artifact",
            )
        driver_version = _required_text(
            raw_artifact,
            "driver_version",
            "mobile-contract:chromedriver-artifact",
        )
        _, driver_major = _parse_version(
            driver_version,
            "mobile-contract:chromedriver-artifact",
        )
        source = _required_text(
            raw_artifact,
            "source",
            "mobile-contract:chromedriver-artifact",
        )
        sha256 = _required_text(
            raw_artifact,
            "sha256",
            "mobile-contract:chromedriver-artifact",
        ).lower()
        if (
            driver_major != browser_major
            or urllib.parse.urlparse(source).scheme != "https"
            or SHA256_PATTERN.fullmatch(sha256) is None
        ):
            raise BlockedError(
                reason=(
                    "Chromedriver artifact requires matching browser/driver "
                    "major, HTTPS source, and lowercase SHA-256"
                ),
                resource="mobile-contract:chromedriver-artifact",
            )
        raw_abis = _required_list(
            raw_artifact,
            "android_abis",
            "mobile-contract:chromedriver-artifact",
        )
        if not raw_abis or any(not isinstance(abi, str) or not abi for abi in raw_abis):
            raise BlockedError(
                reason="Chromedriver artifact requires Android ABIs",
                resource="mobile-contract:chromedriver-artifact",
            )
        artifacts.append(
            ChromedriverArtifactSpec(
                browser_major=browser_major,
                driver_version=driver_version,
                source=source,
                platform=_required_text(
                    raw_artifact,
                    "platform",
                    "mobile-contract:chromedriver-artifact",
                ),
                arch=_required_text(
                    raw_artifact,
                    "arch",
                    "mobile-contract:chromedriver-artifact",
                ),
                android_abis=tuple(raw_abis),
                sha256=sha256,
                cache_target=_relative_cache_path(
                    _required_text(
                        raw_artifact,
                        "cache_target",
                        "mobile-contract:chromedriver-artifact",
                    ),
                    "mobile-contract:chromedriver-artifact",
                ),
                executable_target=_relative_cache_path(
                    _required_text(
                        raw_artifact,
                        "executable_target",
                        "mobile-contract:chromedriver-artifact",
                    ),
                    "mobile-contract:chromedriver-artifact",
                ),
            )
        )
    if not artifacts:
        raise BlockedError(
            reason="Mobile native requires declared Chromedriver artifacts",
            resource="mobile-contract:chromedriver-artifacts",
        )
    return ChromedriverSpec(
        browser_packages=packages,
        cache_root=cache_root,
        cache_root_ref=_required_text(
            raw,
            "cache_root_ref",
            "mobile-contract:chromedriver-cache",
        ),
        executable_ref=_required_text(
            raw,
            "executable_ref",
            "mobile-contract:chromedriver-executable",
        ),
        acquisition_enabled=False,
        acquisition_mode="preseeded",
        artifacts=tuple(artifacts),
    )


def _required_env_ref(reference: str, resource: str) -> tuple[str, str]:
    if not reference.startswith("env:"):
        raise BlockedError(
            reason=f"Mobile native input must use an env reference: {reference!r}",
            resource=resource,
        )
    variable = reference.removeprefix("env:")
    value = os.environ.get(variable, "").strip()
    if not value:
        raise BlockedError(
            reason=f"Mobile native preflight requires {variable}",
            resource=f"{resource}:{variable}",
        )
    return variable, value


def _required_lease_authentication_key(
    reference: str,
    environment: Mapping[str, str],
) -> bytearray:
    if not reference.startswith("env:"):
        raise BlockedError(
            reason=(
                "Mobile resource lease authentication key must use an env "
                f"reference: {reference!r}"
            ),
            resource="mobile-runtime:resource-lease-authentication",
        )
    variable = reference.removeprefix("env:")
    encoded = str(environment.get(variable, "")).strip()
    try:
        key = bytearray.fromhex(encoded)
    except ValueError as error:
        raise BlockedError(
            reason=(
                "Mobile resource lease authentication key must be hexadecimal"
            ),
            resource=f"mobile-runtime:resource-lease-authentication:{variable}",
        ) from error
    if len(key) != MOBILE_RESOURCE_LEASE_AUTH_KEY_BYTES:
        for index in range(len(key)):
            key[index] = 0
        raise BlockedError(
            reason=(
                "Mobile resource lease authentication key must decode to "
                f"{MOBILE_RESOURCE_LEASE_AUTH_KEY_BYTES} bytes"
            ),
            resource=f"mobile-runtime:resource-lease-authentication:{variable}",
        )
    return key


def _scenario_string_list(
    owner: Mapping[str, Any],
    name: str,
    *,
    scenario_id: str,
) -> tuple[str, ...]:
    values = owner.get(name)
    if not isinstance(values, list) or any(
        not isinstance(value, str) or not value for value in values
    ):
        raise BlockedError(
            reason=(
                f"Mobile native scenario {scenario_id!r} requires a string "
                f"list for {name!r}"
            ),
            resource=f"mobile-contract:scenario:{scenario_id}:{name}",
        )
    if len(set(values)) != len(values):
        raise BlockedError(
            reason=(
                f"Mobile native scenario {scenario_id!r} has duplicate "
                f"{name!r} entries"
            ),
            resource=f"mobile-contract:scenario:{scenario_id}:{name}",
        )
    return tuple(values)


def _load_mobile_native_scenario(
    payload: Mapping[str, Any],
    gate_id: str,
) -> MobileNativeScenarioSpec:
    scenarios = payload.get("scenarios")
    if not isinstance(scenarios, Mapping):
        raise BlockedError(
            reason="Mobile native environment requires scenario resource maps",
            resource="mobile-contract:scenarios",
        )
    matching = [
        (str(scenario_id), raw)
        for scenario_id, raw in scenarios.items()
        if isinstance(raw, Mapping) and raw.get("gate_id") == gate_id
    ]
    if len(matching) != 1:
        raise BlockedError(
            reason=(
                f"Mobile native Gate {gate_id!r} requires exactly one "
                "scenario resource map"
            ),
            resource=f"mobile-contract:scenario:{gate_id}",
        )
    scenario_id, raw = matching[0]
    if MOBILE_NATIVE_SCENARIO_GATES.get(scenario_id) != gate_id:
        raise BlockedError(
            reason=(
                f"Mobile native scenario {scenario_id!r} does not own "
                f"Gate {gate_id!r}"
            ),
            resource=f"mobile-contract:scenario:{scenario_id}:gate",
        )
    expected_fields = {
        "gate_id",
        "clients",
        "services",
        "credentials",
        "fixtures",
        "provider_accounts",
        "browser_sessions",
        "harness_actions",
        "parent_harness_actions",
        "ephemeral_capabilities",
        "appium_operations",
        "require_exact_device_count",
        "cleanup_resources",
    }
    if set(raw) != expected_fields:
        raise BlockedError(
            reason=(
                f"Mobile native scenario {scenario_id!r} resource map has "
                "an invalid field set"
            ),
            resource=f"mobile-contract:scenario:{scenario_id}:shape",
        )
    require_exact_device_count = raw.get("require_exact_device_count")
    if not isinstance(require_exact_device_count, bool):
        raise BlockedError(
            reason=(
                f"Mobile native scenario {scenario_id!r} requires a boolean "
                "device-count policy"
            ),
            resource=f"mobile-contract:scenario:{scenario_id}:devices",
        )
    scenario = MobileNativeScenarioSpec(
        id=scenario_id,
        gate_id=gate_id,
        client_ids=_scenario_string_list(
            raw,
            "clients",
            scenario_id=scenario_id,
        ),
        service_ids=_scenario_string_list(
            raw,
            "services",
            scenario_id=scenario_id,
        ),
        credential_ids=_scenario_string_list(
            raw,
            "credentials",
            scenario_id=scenario_id,
        ),
        fixture_ids=_scenario_string_list(
            raw,
            "fixtures",
            scenario_id=scenario_id,
        ),
        provider_accounts=_scenario_string_list(
            raw,
            "provider_accounts",
            scenario_id=scenario_id,
        ),
        browser_sessions=_scenario_string_list(
            raw,
            "browser_sessions",
            scenario_id=scenario_id,
        ),
        harness_actions=_scenario_string_list(
            raw,
            "harness_actions",
            scenario_id=scenario_id,
        ),
        parent_harness_actions=_scenario_string_list(
            raw,
            "parent_harness_actions",
            scenario_id=scenario_id,
        ),
        ephemeral_capabilities=_scenario_string_list(
            raw,
            "ephemeral_capabilities",
            scenario_id=scenario_id,
        ),
        appium_operations=_scenario_string_list(
            raw,
            "appium_operations",
            scenario_id=scenario_id,
        ),
        require_exact_device_count=require_exact_device_count,
        cleanup_resources=_scenario_string_list(
            raw,
            "cleanup_resources",
            scenario_id=scenario_id,
        ),
    )
    if not scenario.client_ids:
        raise BlockedError(
            reason=f"Mobile native scenario {scenario_id!r} requires clients",
            resource=f"mobile-contract:scenario:{scenario_id}:clients",
        )
    if scenario_id in {"lifecycle", "platform"} and any(
        (
            scenario.service_ids,
            scenario.credential_ids,
            scenario.fixture_ids,
            scenario.provider_accounts,
            scenario.browser_sessions,
        )
    ):
        raise BlockedError(
            reason=(
                f"Mobile native scenario {scenario_id!r} must not inherit "
                "access/OAuth resources"
            ),
            resource=f"mobile-contract:scenario:{scenario_id}:oauth-isolation",
        )
    if scenario_id in {"lifecycle", "platform"} and (
        scenario.ephemeral_capabilities
        != ("mobile.native.appium-session",)
    ):
        raise BlockedError(
            reason=(
                f"Mobile native scenario {scenario_id!r} must use only the "
                "Appium ephemeral capability"
            ),
            resource=f"mobile-contract:scenario:{scenario_id}:capabilities",
        )
    return scenario


def load_mobile_native_preflight_spec(
    path: Path = ENVIRONMENTS_DIR / "mobile-native.yaml",
    *,
    gate_id: str = MOBILE_OAUTH_PROOF_GATE_ID,
) -> MobileNativePreflightSpec:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BlockedError(
            reason=f"Cannot load Mobile native environment contract: {error}",
            resource="mobile-contract:environment",
        ) from error

    scenario = _load_mobile_native_scenario(payload, gate_id)
    appium = _required_object(payload, "appium", "mobile-contract:appium")
    server = _required_object(appium, "server", "mobile-contract:appium-server")
    drivers = _required_object(appium, "drivers", "mobile-contract:appium-drivers")
    appium_expected_version = _required_text(
        server,
        "expected_version",
        "mobile-contract:appium-server",
    )
    if appium_expected_version != EXPECTED_APPIUM_VERSION:
        raise BlockedError(
            reason=(
                "Mobile native Appium version must be pinned to "
                f"{EXPECTED_APPIUM_VERSION}"
            ),
            resource="mobile-contract:appium-server-version",
        )
    parsed_drivers: dict[str, AppiumDriverSpec] = {}
    for platform, (
        expected_identity,
        expected_installed_name,
        expected_automation,
        expected_version,
    ) in (
        EXPECTED_DRIVER_IDENTITIES.items()
    ):
        driver = _required_object(
            drivers,
            platform,
            f"mobile-contract:appium-driver:{platform}",
        )
        if (
            _required_text(
                driver,
                "identity",
                f"mobile-contract:appium-driver:{platform}",
            )
            != expected_identity
            or _required_text(
                driver,
                "installed_name",
                f"mobile-contract:appium-driver:{platform}",
            )
            != expected_installed_name
            or _required_text(
                driver,
                "automation_name",
                f"mobile-contract:appium-driver:{platform}",
            )
            != expected_automation
        ):
            raise BlockedError(
                reason=(
                    f"Mobile native {platform} Appium driver identity must be "
                    f"{expected_identity}/{expected_automation}"
                ),
                resource=f"mobile-contract:appium-driver:{platform}",
            )
        actual_expected_version = _required_text(
            driver,
            "expected_version",
            f"mobile-contract:appium-driver-version:{platform}",
        )
        if actual_expected_version != expected_version:
            raise BlockedError(
                reason=(
                    f"Mobile native {platform} Appium driver must be pinned "
                    f"to {expected_version}"
                ),
                resource=f"mobile-contract:appium-driver-version:{platform}",
            )
        parsed_drivers[platform] = AppiumDriverSpec(
            identity=expected_identity,
            installed_name=expected_installed_name,
            automation_name=expected_automation,
            expected_version=expected_version,
        )

    ios = _required_object(appium, "ios", "mobile-contract:ios-readiness")
    android = _required_object(
        appium,
        "android",
        "mobile-contract:android-readiness",
    )

    build = _required_object(payload, "build", "mobile-contract:build")
    projects = _required_object(build, "projects", "mobile-contract:projects")
    applications = _required_object(
        build,
        "applications",
        "mobile-contract:applications",
    )
    build_environment = _required_object(
        build,
        "environment",
        "mobile-contract:build-environment",
    )
    if build_environment.get("VITE_ACCEPTANCE_HARNESS") != "1":
        raise BlockedError(
            reason="Mobile native build must declare VITE_ACCEPTANCE_HARNESS=1",
            resource="mobile-contract:harness-build-flag",
        )

    raw_clients = payload.get("clients")
    if not isinstance(raw_clients, list):
        raise BlockedError(
            reason="Mobile native contract requires a clients list",
            resource="mobile-contract:clients",
        )
    all_clients = tuple(
        NativeClientSpec(
            id=_required_text(client, "id", "mobile-contract:client")
            if isinstance(client, dict)
            else "",
            platform=_required_text(client, "platform", "mobile-contract:client")
            if isinstance(client, dict)
            else "",
            actor=_required_text(client, "actor", "mobile-contract:client")
            if isinstance(client, dict)
            else "",
            runtime=_required_text(client, "runtime", "mobile-contract:client")
            if isinstance(client, dict)
            else "",
            destination_class_ref=_required_text(
                client,
                "destination_class_ref",
                "mobile-contract:client",
            )
            if isinstance(client, dict)
            else "",
            physical_device_lease_ref=_required_text(
                client,
                "physical_device_lease_ref",
                "mobile-contract:client",
            )
            if isinstance(client, dict)
            else "",
            device_role=_required_text(
                client,
                "device_role",
                "mobile-contract:client",
            )
            if isinstance(client, dict)
            else "",
            profile=_required_text(client, "profile", "mobile-contract:client")
            if isinstance(client, dict)
            else "",
            port_roles=tuple(client.get("port_roles") or ())
            if isinstance(client, dict)
            else (),
            storage_root=_required_text(
                client,
                "storage_root",
                "mobile-contract:client",
            )
            if isinstance(client, dict)
            else "",
            session_lease=_required_text(
                client,
                "session_lease",
                "mobile-contract:client",
            )
            if isinstance(client, dict)
            else "",
            browser_session=BrowserSessionSpec(
                owner=_required_text(
                    _required_object(
                        client,
                        "browser_session",
                        "mobile-contract:browser-session",
                    ),
                    "owner",
                    "mobile-contract:browser-session",
                ),
                provider=_required_text(
                    _required_object(
                        client,
                        "browser_session",
                        "mobile-contract:browser-session",
                    ),
                    "provider",
                    "mobile-contract:browser-session",
                ),
                credential_ref=_required_text(
                    _required_object(
                        client,
                        "browser_session",
                        "mobile-contract:browser-session",
                    ),
                    "credential_ref",
                    "mobile-contract:browser-session",
                ),
                lease_ref=_required_text(
                    _required_object(
                        client,
                        "browser_session",
                        "mobile-contract:browser-session",
                    ),
                    "lease_ref",
                    "mobile-contract:browser-session",
                ),
            )
            if isinstance(client, dict)
            else BrowserSessionSpec("", "", "", ""),
        )
        for client in raw_clients
    )
    actual_clients = {
        client.id: (client.platform, client.actor) for client in all_clients
    }
    if actual_clients != EXPECTED_CLIENTS or len(all_clients) != 4:
        raise BlockedError(
            reason=(
                "Mobile native contract requires isolated alice/bob clients "
                "for both iOS and Android"
            ),
            resource="mobile-contract:clients",
        )
    if len({client.profile for client in all_clients}) != 4:
        raise BlockedError(
            reason="Mobile native client profiles must be unique",
            resource="mobile-contract:client-profiles",
        )
    if len({client.physical_device_lease_ref for client in all_clients}) != 4:
        raise BlockedError(
            reason="Mobile native physical-device lease references must be unique",
            resource="mobile-contract:client-devices",
        )
    if any(len(client.port_roles) != 3 for client in all_clients):
        raise BlockedError(
            reason="Every Mobile native client requires three port roles",
            resource="mobile-contract:client-ports",
        )
    expected_browser_sessions = {
        "alice-ios": ("github", "github-disposable-account"),
        "bob-ios": ("google", "google-disposable-account"),
        "alice-android": ("google", "google-disposable-account"),
        "bob-android": ("github", "github-disposable-account"),
    }
    for client in all_clients:
        browser = client.browser_session
        if (
            browser.owner != client.id
            or (browser.provider, browser.credential_ref)
            != expected_browser_sessions[client.id]
            or client.destination_class_ref != f"{client.platform}-physical"
            or client.physical_device_lease_ref
            != f"physical-device-lease/{client.id}"
            or browser.lease_ref
            != f"provider-browser-session-lease/{client.id}"
        ):
            raise BlockedError(
                reason=(
                    f"Mobile native client {client.id!r} has an invalid "
                    "lease or physical-destination binding"
                ),
                resource=f"mobile-contract:browser-session:{client.id}",
            )

    harness = _required_object(payload, "harness", "mobile-contract:harness")
    actions = harness.get("required_actions")
    if not isinstance(actions, list) or not actions or any(
        not isinstance(action, str) or not action for action in actions
    ):
        raise BlockedError(
            reason="Mobile native Harness requires typed action names",
            resource="mobile-contract:harness-actions",
        )
    parent_actions = harness.get("parent_only_actions")
    if (
        not isinstance(parent_actions, list)
        or set(parent_actions) != EXPECTED_PARENT_HARNESS_ACTIONS
        or any(not isinstance(action, str) for action in parent_actions)
        or set(actions).intersection(parent_actions)
    ):
        raise BlockedError(
            reason=(
                "Mobile native Harness parent-only actions must match the "
                "frozen disjoint action set"
            ),
            resource="mobile-contract:harness-parent-actions",
        )
    available_services = set(
        _required_object(
            payload,
            "services",
            "mobile-contract:services",
        )
    )
    available_credentials = {
        credential.get("id")
        for credential in _required_list(
            payload,
            "credentials",
            "mobile-contract:credentials",
        )
        if isinstance(credential, Mapping)
    }
    available_fixtures = {
        fixture.get("id")
        for fixture in _required_list(
            payload,
            "fixtures",
            "mobile-contract:fixtures",
        )
        if isinstance(fixture, Mapping)
    }
    reference_sets = (
        ("clients", set(scenario.client_ids), set(actual_clients)),
        ("services", set(scenario.service_ids), available_services),
        (
            "credentials",
            set(scenario.credential_ids),
            available_credentials,
        ),
        ("fixtures", set(scenario.fixture_ids), available_fixtures),
        (
            "provider_accounts",
            set(scenario.provider_accounts),
            set(PROVIDER_CLIENTS),
        ),
        (
            "browser_sessions",
            set(scenario.browser_sessions),
            set(EXPECTED_CLIENTS),
        ),
    )
    for resource_name, selected, available in reference_sets:
        missing = sorted(selected - available)
        if missing:
            raise BlockedError(
                reason=(
                    f"Mobile native scenario {scenario.id!r} references "
                    f"unknown {resource_name}: {', '.join(missing)}"
                ),
                resource=(
                    f"mobile-contract:scenario:{scenario.id}:"
                    f"{resource_name}"
                ),
            )
    if (
        set(scenario.harness_actions).intersection(
            scenario.parent_harness_actions
        )
        or not set(scenario.parent_harness_actions).issubset(
            EXPECTED_PARENT_HARNESS_ACTIONS
        )
    ):
        raise BlockedError(
            reason=(
                f"Mobile native scenario {scenario.id!r} has invalid "
                "parent-only Harness actions"
            ),
            resource=f"mobile-contract:scenario:{scenario.id}:harness",
        )
    if not set(scenario.ephemeral_capabilities).issubset(
        MOBILE_NATIVE_CAPABILITIES
    ):
        raise BlockedError(
            reason=(
                f"Mobile native scenario {scenario.id!r} has unknown "
                "ephemeral capabilities"
            ),
            resource=f"mobile-contract:scenario:{scenario.id}:capabilities",
        )
    if (
        not scenario.appium_operations
        or not set(scenario.appium_operations).issubset(
            MOBILE_NATIVE_SCENARIO_APPIUM_OPERATIONS
        )
    ):
        raise BlockedError(
            reason=(
                f"Mobile native scenario {scenario.id!r} has invalid "
                "Appium operations"
            ),
            resource=f"mobile-contract:scenario:{scenario.id}:appium",
        )
    if scenario.id == "access" and (
        scenario.client_ids != tuple(EXPECTED_CLIENTS)
        or scenario.service_ids
        != ("station-primary", "station-secondary", "relay")
        or scenario.credential_ids
        != ("github-disposable-account", "google-disposable-account")
        or scenario.fixture_ids != ("mobile-native-actors",)
        or scenario.provider_accounts != tuple(PROVIDER_CLIENTS)
        or scenario.browser_sessions != tuple(EXPECTED_CLIENTS)
        or scenario.harness_actions != tuple(actions)
        or set(scenario.parent_harness_actions)
        != EXPECTED_PARENT_HARNESS_ACTIONS
        or scenario.ephemeral_capabilities
        != tuple(MOBILE_NATIVE_CAPABILITIES)
        or scenario.appium_operations
        != MOBILE_NATIVE_CAPABILITIES["mobile.native.appium-session"]
        or not scenario.require_exact_device_count
    ):
        raise BlockedError(
            reason=(
                "Mobile native access scenario must preserve the frozen "
                "OAuth resource contract"
            ),
            resource="mobile-contract:scenario:access",
        )
    clients_by_id = {client.id: client for client in all_clients}
    clients = tuple(
        clients_by_id[client_id] for client_id in scenario.client_ids
    )
    if {client.platform for client in clients} != set(
        EXPECTED_DRIVER_IDENTITIES
    ):
        raise BlockedError(
            reason=(
                f"Mobile native scenario {scenario.id!r} must declare at "
                "least one iOS and one Android physical client"
            ),
            resource=f"mobile-contract:scenario:{scenario.id}:platforms",
        )
    leases = _required_object(payload, "leases", "mobile-contract:leases")
    return MobileNativePreflightSpec(
        scenario=scenario,
        appium_server_url_ref=_required_text(
            server,
            "url_ref",
            "mobile-contract:appium-server",
        ),
        appium_executable=_required_text(
            server,
            "executable",
            "mobile-contract:appium-server",
        ),
        appium_expected_version=appium_expected_version,
        appium_status_path=_required_text(
            server,
            "status_path",
            "mobile-contract:appium-server",
        ),
        drivers=parsed_drivers,
        ios_device_inventory_command=_required_command(
            ios,
            "device_inventory_command",
            "mobile-contract:ios-device-inventory",
        ),
        ios_native_context=_required_text(
            ios,
            "native_context",
            "mobile-contract:ios-native-context",
        ),
        ios_webview_context_prefix=_required_text(
            ios,
            "webview_context_prefix",
            "mobile-contract:ios-webview-context",
        ),
        ios_wda_bundle_id_ref=_required_text(
            ios,
            "wda_bundle_id_ref",
            "mobile-contract:ios-wda-bundle",
        ),
        ios_webview_bundle_id_ref=_required_text(
            ios,
            "webview_bundle_id_ref",
            "mobile-contract:ios-webview-bundle",
        ),
        android_device_inventory_command=_required_command(
            android,
            "device_inventory_command",
            "mobile-contract:android-device-inventory",
        ),
        chromedriver=_load_chromedriver_spec(android),
        projects={
            platform: _required_text(
                projects,
                platform,
                f"mobile-contract:project:{platform}",
            )
            for platform in EXPECTED_DRIVER_IDENTITIES
        },
        application_ids={
            platform: _required_text(
                _required_object(
                    applications,
                    platform,
                    f"mobile-contract:application:{platform}",
                ),
                "id",
                f"mobile-contract:application:{platform}",
            )
            for platform in EXPECTED_DRIVER_IDENTITIES
        },
        callback_schemes={
            platform: _required_text(
                _required_object(
                    applications,
                    platform,
                    f"mobile-contract:application:{platform}",
                ),
                "callback_scheme",
                f"mobile-contract:application:{platform}",
            )
            for platform in EXPECTED_DRIVER_IDENTITIES
        },
        build_environment={
            str(name): str(value)
            for name, value in build_environment.items()
        },
        clients=clients,
        harness_namespace=_required_text(
            harness,
            "namespace",
            "mobile-contract:harness",
        ),
        harness_actions=scenario.harness_actions,
        parent_harness_actions=scenario.parent_harness_actions,
        storage_root_ref=_required_text(
            leases,
            "storage_root_ref",
            "mobile-contract:storage",
        ),
        lease_authentication_key_ref=_required_text(
            leases,
            "authentication_key_ref",
            "mobile-contract:resource-lease-authentication",
        ),
    )


def _appium_server_version(server_url: str, status_path: str) -> str:
    status_url = urllib.parse.urljoin(
        f"{server_url.rstrip('/')}/",
        status_path.lstrip("/"),
    )
    request = urllib.request.Request(
        status_url,
        headers={"Accept": "application/json"},
    )
    deadline = time.monotonic() + 8
    try:
        with urllib.request.urlopen(
            request,
            timeout=max(deadline - time.monotonic(), 0.001),
        ) as response:
            raw = read_bounded_http_response(
                response,
                max_bytes=MAX_APPIUM_ERROR_RESPONSE_BYTES,
                deadline_monotonic=deadline,
            )
            payload = json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            raise BlockedError(
                reason=(
                    f"Appium server is unavailable at {status_url}: "
                    f"HTTP {error.code}"
                ),
                resource="mobile-runtime:appium-server",
            ) from error
        finally:
            error.close()
    except (
        HttpResponseBodyTooLarge,
        HttpResponseDeadlineExceeded,
        HttpResponseDeadlineUnsupported,
        OSError,
        TimeoutError,
        urllib.error.URLError,
        json.JSONDecodeError,
    ) as error:
        raise BlockedError(
            reason=f"Appium server is unavailable at {status_url}: {error}",
            resource="mobile-runtime:appium-server",
        ) from error
    value = payload.get("value") if isinstance(payload, dict) else None
    build = value.get("build") if isinstance(value, dict) else None
    version = str(build.get("version") or "").strip() if isinstance(build, dict) else ""
    if not version:
        raise BlockedError(
            reason="Appium status does not expose server build version",
            resource="mobile-runtime:appium-server-identity",
        )
    return version


def _run_checked(
    executor: CommandExecutor,
    command: Sequence[str],
    *,
    repo_root: Path,
    environment: Mapping[str, str],
    resource: str,
) -> CommandResult:
    result = executor.run(
        command,
        cwd=repo_root,
        env=environment,
        timeout=30,
    )
    if result.returncode != 0:
        raise BlockedError(
            reason=f"Mobile native command failed: {command[0]}",
            resource=resource,
        )
    return result


def _discover_appium_drivers(
    spec: MobileNativePreflightSpec,
    executor: CommandExecutor,
    repo_root: Path,
    environment: Mapping[str, str],
) -> dict[str, str]:
    result = _run_checked(
        executor,
        (
            spec.appium_executable,
            "driver",
            "list",
            "--installed",
            "--json",
        ),
        repo_root=repo_root,
        environment=environment,
        resource="mobile-runtime:appium-drivers",
    )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise BlockedError(
            reason="Appium driver inventory is not valid JSON",
            resource="mobile-runtime:appium-drivers",
        ) from error
    versions: dict[str, str] = {}
    for platform_name, driver in spec.drivers.items():
        entry = payload.get(driver.installed_name) if isinstance(payload, dict) else None
        version = (
            str(entry.get("version") or "").strip()
            if isinstance(entry, dict)
            else ""
        )
        if version != driver.expected_version:
            raise BlockedError(
                reason=(
                    f"Appium driver {driver.installed_name!r} version "
                    f"{version or 'missing'!r} does not match required "
                    f"version {driver.expected_version!r}"
                ),
                resource=f"mobile-runtime:appium-driver-version:{platform_name}",
            )
        versions[platform_name] = version
    return versions


def _connected_ios_devices(inventory: str) -> set[str]:
    devices_section = inventory.split("== Simulators ==", 1)[0]
    if "== Devices ==" not in devices_section:
        return set()
    connected: set[str] = set()
    for line in devices_section.splitlines():
        if "Unavailable" in line or "Offline" in line:
            continue
        matches = re.findall(r"\(([0-9A-Fa-f-]{8,})\)", line)
        if matches:
            connected.add(matches[-1])
    return connected


def _connected_android_devices(inventory: str) -> set[str]:
    connected: set[str] = set()
    for line in inventory.splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 2 and fields[1] == "device":
            connected.add(fields[0])
    return connected


def _discover_android_browser(
    spec: ChromedriverSpec,
    serial: str,
    executor: CommandExecutor,
    repo_root: Path,
    environment: Mapping[str, str],
) -> tuple[str, str, int]:
    result = _run_checked(
        executor,
        ("adb", "-s", serial, "shell", "dumpsys", "webviewupdate"),
        repo_root=repo_root,
        environment=environment,
        resource=f"mobile-runtime:android-webview:{serial}",
    )
    provider_line = next(
        (
            line
            for line in result.stdout.splitlines()
            if "Current WebView package" in line
        ),
        "",
    )
    provider = next(
        (package for package in spec.browser_packages if package in provider_line),
        "",
    )
    version_match = VERSION_PATTERN.search(provider_line)
    if not provider or version_match is None:
        raise BlockedError(
            reason="Android active WebView provider is missing or ambiguous",
            resource=f"mobile-runtime:android-webview:{serial}",
        )
    version, major = _parse_version(
        version_match.group(0),
        f"mobile-runtime:android-webview:{serial}",
    )
    package_result = _run_checked(
        executor,
        ("adb", "-s", serial, "shell", "dumpsys", "package", provider),
        repo_root=repo_root,
        environment=environment,
        resource=f"mobile-runtime:android-browser:{serial}",
    )
    package_version = re.search(
        r"(?m)^\s*versionName=(\S+)\s*$",
        package_result.stdout,
    )
    if package_version is None or package_version.group(1) != version:
        raise BlockedError(
            reason="Android WebView provider and package versions do not match",
            resource=f"mobile-runtime:android-browser:{serial}",
        )
    return provider, version, major


def _host_platform_identity() -> tuple[str, str]:
    host_platform = {
        "darwin": "darwin",
        "linux": "linux",
        "win32": "windows",
    }.get(os.sys.platform)
    host_arch = {
        "arm64": "arm64",
        "aarch64": "arm64",
        "x86_64": "x86_64",
        "amd64": "x86_64",
    }.get(platform.machine().lower())
    if not host_platform or not host_arch:
        raise BlockedError(
            reason=(
                f"Chromedriver host {os.sys.platform}/"
                f"{platform.machine()} is unsupported"
            ),
            resource="mobile-runtime:chromedriver-host",
        )
    return host_platform, host_arch


def _artifact_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _prepare_chromedriver(
    spec: ChromedriverSpec,
    browser_major: int,
    android_abis: set[str],
    *,
    repo_root: Path,
    executor: CommandExecutor,
    environment: Mapping[str, str],
) -> dict[str, Any]:
    host_platform, host_arch = _host_platform_identity()
    matching = [
        artifact
        for artifact in spec.artifacts
        if artifact.browser_major == browser_major
        and artifact.platform == host_platform
        and artifact.arch == host_arch
        and android_abis.issubset(set(artifact.android_abis))
    ]
    if len(matching) != 1:
        raise BlockedError(
            reason=(
                "No unambiguous preseeded Chromedriver artifact supports "
                f"browser major {browser_major}, host {host_platform}/"
                f"{host_arch}, and device ABIs {sorted(android_abis)!r}"
            ),
            resource="mobile-runtime:chromedriver-artifact",
        )
    artifact = matching[0]
    _, runtime_cache = _required_env_ref(
        spec.cache_root_ref,
        "mobile-runtime:chromedriver-cache",
    )
    cache_root = (Path(runtime_cache).expanduser() / "chromedriver").resolve()
    repository_root = repo_root.resolve()
    if cache_root == repository_root or repository_root in cache_root.parents:
        raise BlockedError(
            reason="Chromedriver cache must be outside the source tree",
            resource="mobile-runtime:chromedriver-cache",
        )
    artifact_path = (cache_root / artifact.cache_target).resolve()
    executable_path = (cache_root / artifact.executable_target).resolve()
    if cache_root not in artifact_path.parents or cache_root not in executable_path.parents:
        raise BlockedError(
            reason="Chromedriver cache target escapes the external cache",
            resource="mobile-runtime:chromedriver-cache",
        )
    _, declared_executable = _required_env_ref(
        spec.executable_ref,
        "mobile-runtime:chromedriver-executable",
    )
    if Path(declared_executable).expanduser().resolve() != executable_path:
        raise BlockedError(
            reason="Chromedriver executable does not match its declared cache target",
            resource="mobile-runtime:chromedriver-executable",
        )
    if not artifact_path.is_file() or not executable_path.is_file():
        raise BlockedError(
            reason=(
                "Preseeded Chromedriver artifact or executable is absent; "
                "Mobile native preflight does not download binaries"
            ),
            resource="mobile-runtime:chromedriver-artifact-absent",
        )
    if _artifact_digest(artifact_path) != artifact.sha256:
        raise BlockedError(
            reason="Preseeded Chromedriver artifact checksum mismatch",
            resource="mobile-runtime:chromedriver-checksum",
        )
    result = _run_checked(
        executor,
        (str(executable_path), "--version"),
        repo_root=repo_root,
        environment=environment,
        resource="mobile-runtime:chromedriver-version",
    )
    version, major = _parse_version(
        result.stdout,
        "mobile-runtime:chromedriver-version",
    )
    if version != artifact.driver_version or major != browser_major:
        raise BlockedError(
            reason=(
                f"Chromedriver {version!r} does not match declared "
                f"{artifact.driver_version!r} and browser major {browser_major}"
            ),
            resource="mobile-runtime:chromedriver-version",
        )
    return {
        "version": version,
        "browserMajor": browser_major,
        "source": artifact.source,
        "sha256": artifact.sha256,
        "platform": artifact.platform,
        "arch": artifact.arch,
        "androidAbis": sorted(android_abis),
        "cacheTarget": (
            f"<runtime-cache>/chromedriver/{artifact.cache_target}"
        ),
        "executable": str(executable_path),
        "executableReference": (
            f"<runtime-cache>/chromedriver/{artifact.executable_target}"
        ),
        "acquisition": {
            "enabled": False,
            "mode": spec.acquisition_mode,
        },
    }


def _registered_harness_actions(repo_root: Path) -> set[str]:
    acceptance_root = repo_root / "apps" / "mobile" / "src" / "acceptance"
    if not acceptance_root.is_dir():
        return set()
    actions: set[str] = set()
    for path in acceptance_root.rglob("*"):
        if path.suffix not in {".ts", ".tsx"} or not path.is_file():
            continue
        actions.update(
            HARNESS_REGISTRATION_PATTERN.findall(
                path.read_text(encoding="utf-8")
            )
        )
    return actions


def preflight_mobile_native_inputs(
    spec: MobileNativePreflightSpec,
    *,
    repo_root: Path = REPO_ROOT,
    executor: CommandExecutor | None = None,
    environment: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    executor = executor or SubprocessExecutor()
    command_environment = dict(environment or os.environ)
    if command_environment.get("VITE_ACCEPTANCE_HARNESS") != "1":
        raise BlockedError(
            reason="Mobile native preflight requires VITE_ACCEPTANCE_HARNESS=1",
            resource="mobile-runtime:harness-build-flag",
        )

    for platform, project in spec.projects.items():
        if not (repo_root / project).exists():
            platform_label = "iOS" if platform == "ios" else "Android"
            raise BlockedError(
                reason=(
                    f"Mobile native {platform_label} project is missing: "
                    f"{project}"
                ),
                resource=f"mobile-runtime:{platform}-project",
            )

    _, appium_url = _required_env_ref(
        spec.appium_server_url_ref,
        "mobile-runtime:appium-server",
    )
    actual_appium_version = _appium_server_version(
        appium_url,
        spec.appium_status_path,
    )
    if actual_appium_version != spec.appium_expected_version:
        raise BlockedError(
            reason=(
                f"Appium server version {actual_appium_version!r} does not "
                f"match required version {spec.appium_expected_version!r}"
            ),
            resource="mobile-runtime:appium-server-version",
        )

    driver_versions = _discover_appium_drivers(
        spec,
        executor,
        repo_root,
        command_environment,
    )
    for client in spec.clients:
        if not client.device_role.endswith("-physical"):
            raise BlockedError(
                reason=f"Mobile native client {client.id!r} must be physical",
                resource=f"mobile-runtime:physical-device:{client.id}",
            )

    ios_clients = [
        client for client in spec.clients if client.platform == "ios"
    ]
    android_clients = [
        client for client in spec.clients if client.platform == "android"
    ]
    ios_inventory = _run_checked(
        executor,
        spec.ios_device_inventory_command,
        repo_root=repo_root,
        environment=command_environment,
        resource="mobile-runtime:ios-device-inventory",
    )
    connected_ios = _connected_ios_devices(ios_inventory.stdout)
    ios_count_matches = (
        len(connected_ios) == len(ios_clients)
        if spec.scenario.require_exact_device_count
        else len(connected_ios) >= len(ios_clients)
    )
    if not ios_count_matches:
        reason = (
            "Mobile native requires exactly two connected physical iOS devices"
            if spec.scenario.id == "access"
            else (
                f"Mobile native scenario {spec.scenario.id!r} requires at "
                f"least {len(ios_clients)} connected physical iOS device(s)"
            )
        )
        raise BlockedError(
            reason=reason,
            resource="mobile-runtime:ios-device-isolation",
        )

    _, ios_wda_bundle_id = _required_env_ref(
        spec.ios_wda_bundle_id_ref,
        "mobile-runtime:ios-wda-bundle",
    )
    _, ios_webview_bundle_id = _required_env_ref(
        spec.ios_webview_bundle_id_ref,
        "mobile-runtime:ios-webview-bundle",
    )
    if (
        spec.ios_native_context != "NATIVE_APP"
        or not spec.ios_webview_context_prefix.startswith("WEBVIEW")
    ):
        raise BlockedError(
            reason="iOS native and WebView readiness inputs are invalid",
            resource="mobile-runtime:ios-context-readiness",
        )

    android_inventory = _run_checked(
        executor,
        spec.android_device_inventory_command,
        repo_root=repo_root,
        environment=command_environment,
        resource="mobile-runtime:android-device-inventory",
    )
    connected_android = _connected_android_devices(android_inventory.stdout)
    android_count_matches = (
        len(connected_android) == len(android_clients)
        if spec.scenario.require_exact_device_count
        else len(connected_android) >= len(android_clients)
    )
    if not android_count_matches:
        reason = (
            "Mobile native requires exactly two connected physical Android devices"
            if spec.scenario.id == "access"
            else (
                f"Mobile native scenario {spec.scenario.id!r} requires at "
                f"least {len(android_clients)} connected physical Android "
                "device(s)"
            )
        )
        raise BlockedError(
            reason=reason,
            resource="mobile-runtime:android-device-isolation",
        )
    device_identifiers = {
        **dict(
            zip(
                sorted(client.id for client in ios_clients),
                sorted(connected_ios),
            )
        ),
        **dict(
            zip(
                sorted(client.id for client in android_clients),
                sorted(connected_android),
            )
        ),
    }
    physical_devices = {
        client.id: ResolvedPhysicalDeviceHandle(
            device_identifiers[client.id],
            client.platform,
            True,
            True,
            False,
        )
        for client in spec.clients
    }
    android_abis: set[str] = set()
    browser_details: dict[str, dict[str, Any]] = {}
    browser_majors: set[int] = set()
    for client in android_clients:
        device = physical_devices[client.id].identifier
        if device.startswith("emulator-"):
            raise BlockedError(
                reason=(
                    f"Android client {client.id!r} is not a connected "
                    "physical device"
                ),
                resource=f"mobile-runtime:physical-device:{client.id}",
            )
        qemu = _run_checked(
            executor,
            ("adb", "-s", device, "shell", "getprop", "ro.kernel.qemu"),
            repo_root=repo_root,
            environment=command_environment,
            resource=f"mobile-runtime:android-physical:{client.id}",
        ).stdout.strip()
        if qemu not in {"", "0"}:
            raise BlockedError(
                reason=f"Android client {client.id!r} reports an emulator",
                resource=f"mobile-runtime:physical-device:{client.id}",
            )
        abi = _run_checked(
            executor,
            ("adb", "-s", device, "shell", "getprop", "ro.product.cpu.abi"),
            repo_root=repo_root,
            environment=command_environment,
            resource=f"mobile-runtime:android-abi:{client.id}",
        ).stdout.strip()
        if not abi:
            raise BlockedError(
                reason=f"Android client {client.id!r} has no reported ABI",
                resource=f"mobile-runtime:android-abi:{client.id}",
            )
        android_abis.add(abi)
        provider, version, major = _discover_android_browser(
            spec.chromedriver,
            device,
            executor,
            repo_root,
            command_environment,
        )
        browser_majors.add(major)
        browser_details[client.id] = {
            "activePackage": provider,
            "version": version,
            "major": major,
            "discovery": "adb-shell-dumpsys-webviewupdate",
        }
    if len(browser_majors) != 1:
        raise BlockedError(
            reason=(
                "Android physical clients require one shared browser major "
                "for the declared Appium ChromeDriver capability"
            ),
            resource="mobile-runtime:android-browser-major",
        )
    chromedriver = _prepare_chromedriver(
        spec.chromedriver,
        next(iter(browser_majors)),
        android_abis,
        repo_root=repo_root,
        executor=executor,
        environment=command_environment,
    )

    _, storage_root = _required_env_ref(
        spec.storage_root_ref,
        "mobile-runtime:storage-root",
    )
    required_actions = set(spec.harness_actions).union(
        spec.parent_harness_actions
    )
    missing_actions = sorted(
        required_actions - _registered_harness_actions(repo_root)
    )
    if missing_actions:
        raise BlockedError(
            reason=(
                "Mobile Acceptance Harness actions are missing: "
                + ", ".join(missing_actions)
            ),
            resource="mobile-runtime:harness-actions",
        )
    lease_authentication_key = _required_lease_authentication_key(
        spec.lease_authentication_key_ref,
        command_environment,
    )
    return {
        "appiumUrl": appium_url,
        "appiumVersion": actual_appium_version,
        "driverVersions": driver_versions,
        "iosReadiness": {
            "nativeContext": spec.ios_native_context,
            "webviewContextPrefix": spec.ios_webview_context_prefix,
            "wdaBundleId": ios_wda_bundle_id,
            "webviewBundleId": ios_webview_bundle_id,
        },
        "androidBrowsers": browser_details,
        "chromedriver": chromedriver,
        "physicalDevices": physical_devices,
        "storageRoot": storage_root,
        "leaseAuthenticationKey": lease_authentication_key,
    }


def require_mobile_native_credentials(
    contract: EnvironmentContract,
) -> tuple[str, ...]:
    try:
        for credential in contract.credentials:
            credential.resolve()
    except ProvisioningError as error:
        raise BlockedError(
            reason=f"Mobile native credential preflight failed: {error}",
            resource="mobile-runtime:credentials",
        ) from error
    return tuple(credential.source_ref for credential in contract.credentials)


class _PortReservation:
    def __init__(self) -> None:
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._socket.bind(("127.0.0.1", 0))
        self.port = int(self._socket.getsockname()[1])
        self._released = False

    def release(self) -> None:
        if not self._released:
            self._socket.close()
            self._released = True


@dataclass(frozen=True)
class MobileNativeRuntimeManifest(RuntimeManifest):
    mobile_resources: dict[str, Any] = dataclasses.field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload = super().to_dict()
        payload["mobileNative"] = redact_value(self.mobile_resources)
        return payload


def _with_mobile_resources(
    manifest: RuntimeManifest,
    resources: dict[str, Any],
) -> MobileNativeRuntimeManifest:
    values = {
        field.name: getattr(manifest, field.name)
        for field in dataclasses.fields(RuntimeManifest)
    }
    return MobileNativeRuntimeManifest(
        **values,
        mobile_resources=resources,
    )


def _mobile_native_manifest_resources(
    projection: MobileNativeSourceProjection,
    fixture_refs: Mapping[str, ArtifactRef],
    spec: MobileNativePreflightSpec,
    *,
    evidence_run_id: str,
    provisioning_run_id: str,
) -> dict[str, Any]:
    if set(fixture_refs) != set(MOBILE_OAUTH_FIXTURE_SERVICES):
        raise BlockedError(
            reason="Mobile native Station Fixture refs are incomplete",
            resource="mobile-source:station-fixture-leases",
        )
    if not evidence_run_id or not provisioning_run_id:
        raise BlockedError(
            reason="Mobile native run identities are incomplete",
            resource="mobile-source:run-identities",
        )
    if evidence_run_id == provisioning_run_id:
        raise BlockedError(
            reason=(
                "Mobile native evidence and provisioning run identities "
                "must remain distinct"
            ),
            resource="mobile-source:run-identities",
        )
    authority_refs = [
        *(
            values["buildAttestation"]
            for values in projection.applications.values()
        ),
        *projection.provider_account_leases.values(),
        *(
            values[field]
            for values in projection.clients.values()
            for field in ("physicalDeviceLease", "browserSessionLease")
        ),
        *fixture_refs.values(),
    ]
    if any(reference.run_id != evidence_run_id for reference in authority_refs):
        raise BlockedError(
            reason=(
                "Mobile native authority ArtifactRefs must use the "
                "evidence run identity"
            ),
            resource="mobile-source:run-identities",
        )
    return {
        "runIdentities": {
            "evidenceRunId": evidence_run_id,
            "provisioningRunId": provisioning_run_id,
        },
        "sourceArtifacts": projection.to_dict(),
        "applications": {
            platform_name: {
                "callbackScheme": spec.callback_schemes[platform_name],
            }
            for platform_name in EXPECTED_DRIVER_IDENTITIES
        },
        "harness": {
            "namespace": spec.harness_namespace,
            "requiredActions": list(spec.harness_actions),
        },
        "oauthFixtureLeases": {
            service_id: fixture_refs[service_id].to_dict()
            for service_id in MOBILE_OAUTH_FIXTURE_SERVICES
        },
    }


def _mobile_native_scenario_manifest_resources(
    projection: MobileNativeScenarioSourceProjection,
    spec: MobileNativePreflightSpec,
    client_resources: Mapping[str, Mapping[str, Any]],
    *,
    evidence_run_id: str,
    provisioning_run_id: str,
) -> dict[str, Any]:
    if (
        not evidence_run_id
        or not provisioning_run_id
        or evidence_run_id == provisioning_run_id
    ):
        raise BlockedError(
            reason="Mobile native scenario run identities are invalid",
            resource="mobile-source:run-identities",
        )
    build_refs = [
        values["buildAttestation"]
        for values in projection.applications.values()
    ]
    authority_refs = [
        *build_refs,
        *(
            values["physicalDeviceLease"]
            for values in projection.clients.values()
        ),
    ]
    if any(
        reference.run_id != evidence_run_id
        or reference.gate_id != spec.scenario.gate_id
        for reference in authority_refs
    ):
        raise BlockedError(
            reason=(
                "Mobile native scenario ArtifactRefs must use the "
                "evidence run identity"
            ),
            resource="mobile-source:run-identities",
        )
    return {
        "scenario": spec.scenario.id,
        "runIdentities": {
            "evidenceRunId": evidence_run_id,
            "provisioningRunId": provisioning_run_id,
        },
        "sourceArtifacts": projection.to_dict(),
        "applications": {
            platform_name: {
                "callbackScheme": spec.callback_schemes[platform_name],
            }
            for platform_name in sorted(projection.applications)
        },
        "clients": {
            client_id: dict(client_resources[client_id])
            for client_id in spec.scenario.client_ids
        },
        "harness": {
            "namespace": spec.harness_namespace,
            "requiredActions": list(spec.harness_actions),
        },
    }


def _capability_text(
    payload: Mapping[str, object],
    name: str,
    *,
    resource: str,
) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value:
        raise EphemeralCapabilityBlocked(
            f"Mobile native capability requires {name!r}",
            resource=resource,
        )
    return value


def _capability_mapping(
    payload: Mapping[str, object],
    name: str,
    *,
    resource: str,
) -> Mapping[str, object]:
    value = payload.get(name)
    if not isinstance(value, Mapping):
        raise EphemeralCapabilityBlocked(
            f"Mobile native capability requires object {name!r}",
            resource=resource,
        )
    return value


def _quarantine_broker_lease(
    broker: MobileResourceLeaseBroker,
    lease: Mapping[str, Any],
    reason: str,
    *,
    deadline_monotonic: float | None = None,
    cancellation: threading.Event | None = None,
) -> bool:
    outcome = broker.quarantine(
        lease,
        reason,
        deadline_monotonic=deadline_monotonic,
        cancellation=cancellation,
    )
    return (
        isinstance(outcome, Mapping)
        and outcome.get("finalState") == "QUARANTINED"
    )


def _quarantine_fixture_lease(
    fixture: MobileOAuthStationFixture,
    service_id: str,
    reason: str,
    *,
    deadline_monotonic: float | None = None,
    cancellation: threading.Event | None = None,
) -> bool:
    _require_cleanup_budget(deadline_monotonic, cancellation)
    fixture._quarantine(service_id, reason)
    return fixture.quarantined.get(service_id) == reason


def _require_cleanup_budget(
    deadline_monotonic: float | None,
    cancellation: threading.Event | None,
) -> None:
    if cancellation is not None and cancellation.is_set():
        raise TimeoutError("Mobile native parent cleanup was cancelled")
    if (
        deadline_monotonic is not None
        and time.monotonic() >= deadline_monotonic
    ):
        raise TimeoutError("Mobile native parent cleanup exceeded its deadline")


class _ParentAppiumTransport:
    def __init__(self, server_url: str, timeout_seconds: float = 60.0) -> None:
        if (
            not isinstance(timeout_seconds, (int, float))
            or isinstance(timeout_seconds, bool)
            or not math.isfinite(timeout_seconds)
            or timeout_seconds <= 0
        ):
            raise ValueError("Appium timeout must be a positive finite number")
        self.server_url = server_url.rstrip("/")
        self.timeout_seconds = float(timeout_seconds)

    def request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
        *,
        max_response_bytes: int = MAX_APPIUM_RESPONSE_BYTES,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> Any:
        if (
            not isinstance(max_response_bytes, int)
            or isinstance(max_response_bytes, bool)
            or max_response_bytes <= 0
        ):
            raise ValueError("Appium response byte limit must be positive")
        body = (
            json.dumps(dict(payload)).encode("utf-8")
            if payload is not None
            else None
        )
        request = urllib.request.Request(
            f"{self.server_url}/{path.lstrip('/')}",
            data=body,
            headers={
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if body else {}),
            },
            method=method,
        )
        if deadline_monotonic is not None and (
            not isinstance(deadline_monotonic, (int, float))
            or isinstance(deadline_monotonic, bool)
            or not math.isfinite(deadline_monotonic)
        ):
            raise ValueError("Appium deadline must be finite")
        now = time.monotonic()
        deadline = now + self.timeout_seconds
        if deadline_monotonic is not None:
            deadline = min(deadline, float(deadline_monotonic))
        if deadline <= now:
            raise _AppiumDeadlineExceeded(
                "Appium request failed: "
                "HttpResponseDeadlineExceeded before dispatch"
            )
        if cancellation is not None and cancellation.is_set():
            raise _AppiumDeadlineExceeded(
                "Appium request failed: HttpResponseCancelled before dispatch"
            )
        try:
            with urllib.request.urlopen(
                request,
                timeout=max(deadline - time.monotonic(), 0.001),
            ) as response:
                raw = read_bounded_http_response(
                    response,
                    max_bytes=max_response_bytes,
                    deadline_monotonic=deadline,
                    cancellation=cancellation,
                )
        except urllib.error.HTTPError as error:
            try:
                try:
                    read_bounded_http_response(
                        error,
                        max_bytes=MAX_APPIUM_ERROR_RESPONSE_BYTES,
                        deadline_monotonic=deadline,
                        cancellation=cancellation,
                    )
                except HttpResponseCancelled as cancellation_error:
                    raise _AppiumDeadlineExceeded(
                        "Appium request failed: HttpResponseCancelled"
                    ) from cancellation_error
                except HttpResponseDeadlineExceeded as deadline_error:
                    raise _AppiumDeadlineExceeded(
                        "Appium request failed: "
                        "HttpResponseDeadlineExceeded"
                    ) from deadline_error
                except (
                    HttpResponseBodyTooLarge,
                    HttpResponseDeadlineUnsupported,
                    OSError,
                ):
                    pass
                raise DriverError(
                    f"Appium {method} request failed with HTTP {error.code}"
                ) from error
            finally:
                error.close()
        except HttpResponseBodyTooLarge as error:
            raise DriverError(
                "Appium response exceeds the configured byte limit"
            ) from error
        except HttpResponseDeadlineExceeded as error:
            raise _AppiumDeadlineExceeded(
                "Appium request failed: HttpResponseDeadlineExceeded"
            ) from error
        except HttpResponseCancelled as error:
            raise _AppiumDeadlineExceeded(
                "Appium request failed: HttpResponseCancelled"
            ) from error
        except (TimeoutError, socket.timeout) as error:
            raise _AppiumDeadlineExceeded(
                "Appium request failed: HttpResponseDeadlineExceeded"
            ) from error
        except urllib.error.URLError as error:
            if isinstance(error.reason, (TimeoutError, socket.timeout)):
                raise _AppiumDeadlineExceeded(
                    "Appium request failed: HttpResponseDeadlineExceeded"
                ) from error
            raise DriverError(
                f"Appium {method} request failed: {type(error).__name__}"
            ) from error
        except (HttpResponseDeadlineUnsupported, OSError) as error:
            raise DriverError(
                f"Appium {method} request failed: {type(error).__name__}"
            ) from error
        try:
            decoded = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DriverError("Appium returned invalid JSON") from error
        if not isinstance(decoded, dict):
            raise DriverError("Appium returned a non-object response")
        value = decoded.get("value")
        if isinstance(value, dict) and value.get("error"):
            raise DriverError(
                f"Appium request failed with {value.get('error')}"
            )
        return value


class _AppiumDeadlineExceeded(DriverError, TimeoutError):
    """An Appium request exhausted the enclosing capability deadline."""


class _ParentAppiumSession:
    """Raw Appium authority retained exclusively in the Provisioner process."""

    def __init__(
        self,
        transport: _ParentAppiumTransport,
        *,
        client_id: str,
        platform_name: str,
        automation_name: str,
        artifact_reader: EvidenceStore,
        device_broker: MobileResourceLeaseBroker,
        physical_device_lease: ArtifactRef,
        build_attestation: ArtifactRef,
        ports: Mapping[str, int],
        source_gate_id: str = MOBILE_OAUTH_PROOF_GATE_ID,
        auto_accept_alerts: bool = False,
        chromedriver_executable: str = "",
    ) -> None:
        self.transport = transport
        self.client_id = client_id
        self.platform = platform_name
        self.automation_name = automation_name
        self.artifact_reader = artifact_reader
        self.device_broker = device_broker
        self.physical_device_lease_ref = physical_device_lease
        self.build_attestation_ref = build_attestation
        self.source_gate_id = source_gate_id
        self.auto_accept_alerts = auto_accept_alerts
        self.ports = dict(ports)
        self.chromedriver_executable = chromedriver_executable
        self.session_id = ""
        self._device_lease: dict[str, Any] | None = None
        self._build_attestation: dict[str, Any] | None = None
        self._application_id = ""
        self._fresh_install_trace: dict[str, Any] | None = None

    @property
    def fresh_install_trace(self) -> dict[str, Any]:
        if self._fresh_install_trace is None:
            raise DriverError("Appium fresh-install trace is unavailable")
        return json.loads(json.dumps(self._fresh_install_trace))

    def start(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> "_ParentAppiumSession":
        source_gate_id = getattr(
            self,
            "source_gate_id",
            MOBILE_OAUTH_PROOF_GATE_ID,
        )
        device = _load_source_artifact(
            self.artifact_reader,
            self.physical_device_lease_ref,
            expected_path=(
                f"runtime/mobile/leases/devices/{self.client_id}.json"
            ),
            expected_kind="physical-device-lease",
            expected_workspace_id=self.physical_device_lease_ref.workspace_id,
            expected_run_id=self.physical_device_lease_ref.run_id,
            expected_gate_id=source_gate_id,
        )
        if source_gate_id == MOBILE_OAUTH_PROOF_GATE_ID:
            attestation = _load_source_artifact(
                self.artifact_reader,
                self.build_attestation_ref,
                expected_path=f"runtime/mobile/builds/{self.platform}.json",
                expected_kind="mobile-application-build-attestation",
                expected_workspace_id=self.build_attestation_ref.workspace_id,
                expected_run_id=self.build_attestation_ref.run_id,
            )
            package_ref = _resolve_build_package(
                self.artifact_reader,
                attestation,
                platform=self.platform,
                expected_workspace_id=self.build_attestation_ref.workspace_id,
                expected_run_id=self.build_attestation_ref.run_id,
            )
        else:
            attestation, package_ref = _load_scenario_build_attestation(
                self.artifact_reader,
                self.build_attestation_ref,
                platform=self.platform,
                expected_gate_id=self.source_gate_id,
                expected_workspace_id=self.build_attestation_ref.workspace_id,
                expected_run_id=self.build_attestation_ref.run_id,
            )
        package = self.artifact_reader.resolve(package_ref)
        self._device_lease = device
        self._build_attestation = attestation
        self._application_id = str(attestation["buildIdentity"]["applicationId"])
        capabilities: dict[str, Any] = {
            "platformName": "iOS" if self.platform == "ios" else "Android",
            "appium:automationName": self.automation_name,
            "appium:autoWebview": False,
            "appium:newCommandTimeout": 180,
        }
        if self.auto_accept_alerts:
            capability = (
                "appium:autoAcceptAlerts"
                if self.platform == "ios"
                else "appium:autoGrantPermissions"
            )
            capabilities[capability] = True
        if self.platform == "ios":
            capabilities.update(
                {
                    "appium:wdaLocalPort": self._required_port("wda-local"),
                    "appium:mjpegServerPort": self._required_port("mjpeg"),
                    "appium:webviewConnectTimeout": 30000,
                    "appium:includeSafariInWebviews": True,
                }
            )
        else:
            if not self.chromedriver_executable:
                raise DriverError(
                    "Android Appium requires the verified ChromeDriver"
                )
            capabilities.update(
                {
                    "appium:systemPort": self._required_port("system"),
                    "appium:mjpegServerPort": self._required_port("mjpeg"),
                    "appium:chromedriverPort": self._required_port("webview"),
                    "appium:ensureWebviewsHavePages": True,
                    "appium:chromedriverExecutable": self.chromedriver_executable,
                }
            )

        value = self._with_physical_device(
            device,
            lambda handle: self.transport.request(
                "POST",
                "/session",
                {
                    "capabilities": {
                        "alwaysMatch": {
                            **capabilities,
                            "appium:udid": handle.identifier,
                        },
                        "firstMatch": [{}],
                    }
                },
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            ),
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        session_id = (
            str(value.get("sessionId") or "")
            if isinstance(value, Mapping)
            else ""
        )
        if not session_id:
            raise DriverError("Appium session response has no session ID")
        self.session_id = session_id
        try:
            self._fresh_install_trace = self._fresh_install(
                package,
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
        except BaseException:
            try:
                self.stop(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
            except BaseException:
                pass
            raise
        return self

    def stop(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        if self.session_id:
            session_id = self.session_id
            self._request(
                "DELETE",
                f"/session/{urllib.parse.quote(session_id, safe='')}",
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            self.session_id = ""

    def wait_for_ready(
        self,
        timeout: float = 30.0,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        local_deadline = time.monotonic() + _positive_appium_timeout(timeout)
        deadline = _bounded_appium_deadline(timeout, deadline_monotonic)
        while time.monotonic() < deadline:
            if "NATIVE_APP" in self.contexts(
                deadline_monotonic=deadline,
                cancellation=cancellation,
            ):
                return
            _wait_for_appium_poll(
                min(0.25, max(0.0, deadline - time.monotonic())),
                cancellation=cancellation,
            )
        _raise_if_capability_deadline_exhausted(
            deadline_monotonic,
            local_deadline=local_deadline,
            cancellation=cancellation,
        )
        raise DriverError("Appium native context did not become ready")

    def is_alive(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> bool:
        try:
            self._request(
                "GET",
                self._path("/timeouts"),
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            return True
        except _AppiumDeadlineExceeded:
            raise
        except DriverError:
            return False

    def contexts(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> list[str]:
        value = self._request(
            "GET",
            self._path("/contexts"),
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        if not isinstance(value, list) or any(
            not isinstance(item, str) for item in value
        ):
            raise DriverError("Appium contexts response is invalid")
        return list(value)

    def switch_context(
        self,
        name: str,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        self._request(
            "POST",
            self._path("/context"),
            {"name": name},
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )

    def switch_to_native(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        self.switch_context(
            "NATIVE_APP",
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )

    def switch_to_app_webview(
        self,
        timeout: float = 30.0,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> str:
        local_deadline = time.monotonic() + _positive_appium_timeout(timeout)
        deadline = _bounded_appium_deadline(timeout, deadline_monotonic)
        while time.monotonic() < deadline:
            for context in self.contexts(
                deadline_monotonic=deadline,
                cancellation=cancellation,
            ):
                if context.upper().startswith(("WEBVIEW", "CHROMIUM")):
                    self.switch_context(
                        context,
                        deadline_monotonic=deadline,
                        cancellation=cancellation,
                    )
                    return context
            _wait_for_appium_poll(
                min(0.25, max(0.0, deadline - time.monotonic())),
                cancellation=cancellation,
            )
        _raise_if_capability_deadline_exhausted(
            deadline_monotonic,
            local_deadline=local_deadline,
            cancellation=cancellation,
        )
        raise DriverError("Appium WebView did not become ready")

    def execute_script(
        self,
        script: str,
        *args: Any,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> Any:
        return self._request(
            "POST",
            self._path("/execute/sync"),
            {"script": script, "args": list(args)},
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )

    def execute_async_script(
        self,
        script: str,
        *args: Any,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> Any:
        return self._request(
            "POST",
            self._path("/execute/async"),
            {"script": script, "args": list(args)},
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )

    def refresh_webview(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        self._request(
            "POST",
            self._path("/refresh"),
            {},
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )

    def background_app(
        self,
        duration_seconds: float,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        duration = _positive_appium_timeout(duration_seconds)
        if duration > 30:
            raise DriverError("Appium background duration exceeds 30 seconds")
        self._request(
            "POST",
            self._path("/appium/app/background"),
            {"seconds": duration},
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )

    def find_element(
        self,
        using: str,
        value: str,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> str:
        result = self._request(
            "POST",
            self._path("/element"),
            {"using": using, "value": value},
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        element_ref = (
            str(result.get("element-6066-11e4-a52e-4f735466cecf") or "")
            if isinstance(result, Mapping)
            else ""
        )
        if not element_ref:
            raise DriverError("Appium element response is invalid")
        return element_ref

    def click(
        self,
        element_ref: str,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        self._request(
            "POST",
            self._path(
                f"/element/{urllib.parse.quote(element_ref, safe='')}/click"
            ),
            {},
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )

    def screenshot_bytes(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> bytes:
        value = self._request(
            "GET",
            self._path("/screenshot"),
            max_response_bytes=MAX_MOBILE_SCREENSHOT_RESPONSE_BYTES,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        if not isinstance(value, str):
            raise DriverError("Appium screenshot response is invalid")
        if len(value) > MAX_MOBILE_SCREENSHOT_BASE64_BYTES:
            raise DriverError(
                "Appium screenshot encoding exceeds the configured byte limit"
            )
        try:
            return base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise DriverError("Appium screenshot response is invalid") from error

    def get_page_source(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> str:
        value = self._request(
            "GET",
            self._path("/source"),
            max_response_bytes=MAX_MOBILE_PAGE_SOURCE_RESPONSE_BYTES,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        if not isinstance(value, str):
            raise DriverError("Appium page source response is invalid")
        if len(value.encode("utf-8")) > MAX_MOBILE_PAGE_SOURCE_BYTES:
            raise DriverError(
                "Appium page source exceeds the configured byte limit"
            )
        return value

    def harness_inventory(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> list[str]:
        inventory = self.execute_script(
            HARNESS_INVENTORY_SCRIPT,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        if not isinstance(inventory, list) or any(
            not isinstance(action, str) for action in inventory
        ):
            raise DriverError("Mobile Acceptance Harness inventory is invalid")
        return inventory

    def call_action(
        self,
        action: str,
        payload: Mapping[str, Any] | None = None,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> Any:
        result = self.execute_async_script(
            HARNESS_ACTION_SCRIPT,
            action,
            dict(payload or {}),
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        if not isinstance(result, Mapping) or result.get("error"):
            raise DriverError(f"Mobile Acceptance action {action!r} failed")
        return result.get("value")

    def verify_installed_build_identity(
        self,
        fresh_install_trace: ArtifactRef,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> dict[str, Any]:
        if self._build_attestation is None:
            raise DriverError("Appium build attestation is unavailable")
        source_gate_id = getattr(
            self,
            "source_gate_id",
            MOBILE_OAUTH_PROOF_GATE_ID,
        )
        if source_gate_id == MOBILE_OAUTH_PROOF_GATE_ID:
            trace = _load_source_artifact(
                self.artifact_reader,
                fresh_install_trace,
                expected_path=(
                    f"evidence/mobile/runtime/{self.client_id}/install.json"
                ),
                expected_kind="mobile-fresh-install-trace",
                expected_workspace_id=fresh_install_trace.workspace_id,
                expected_run_id=fresh_install_trace.run_id,
            )
        else:
            try:
                trace = self.artifact_reader.read_json(fresh_install_trace)
            except (EvidenceError, OSError, TypeError, ValueError) as error:
                raise DriverError(
                    "Appium scenario fresh-install trace is unavailable"
                ) from error
        runtime = self.call_action(
            "build.identity",
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        expected = self._build_attestation["buildIdentity"]
        digest = self._build_attestation["embeddedIdentitySha256"]
        if (
            not isinstance(runtime, Mapping)
            or set(runtime) != {"identity", "embeddedIdentitySha256"}
            or runtime.get("identity") != expected
            or runtime.get("embeddedIdentitySha256") != digest
            or self._active_application_id(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            != expected["applicationId"]
            or trace != self._fresh_install_trace
        ):
            raise DriverError("installed and attested build identities differ")
        payload = {
            "artifactKind": (
                "mobile-installed-build-identity"
                if source_gate_id == MOBILE_OAUTH_PROOF_GATE_ID
                else "mobile-native-scenario-installed-build-identity"
            ),
            "runId": self._build_attestation["runId"],
            "gateId": source_gate_id,
            "clientId": self.client_id,
            "platform": self.platform,
            "buildAttestation": self.build_attestation_ref.to_dict(),
            "freshInstallTrace": fresh_install_trace.to_dict(),
            "buildId": expected["buildId"],
            "activeApplicationId": expected["applicationId"],
            "webEmbeddedIdentitySha256": digest,
            "rustEmbeddedIdentitySha256": digest,
            "attestedEmbeddedIdentitySha256": digest,
            "allIdentitiesMatch": True,
            "observedAt": _utc_timestamp(),
        }
        if source_gate_id != MOBILE_OAUTH_PROOF_GATE_ID:
            return payload
        return validate_contract_payload(
            payload,
            expected_kind="mobile-installed-build-identity",
            expected_run_id=self._build_attestation["runId"],
            expected_workspace_id=self.build_attestation_ref.workspace_id,
        )

    def _fresh_install(
        self,
        package: Path,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> dict[str, Any]:
        application_id = self._application_id
        self._request(
            "POST",
            self._path("/appium/device/remove_app"),
            {"appId": application_id},
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        if self._is_installed(
            application_id,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        ):
            raise DriverError("Appium prior application remains installed")
        uninstall_at = _utc_timestamp()
        self._request(
            "POST",
            self._path("/appium/device/install_app"),
            {"appPath": str(package)},
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        if not self._is_installed(
            application_id,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        ):
            raise DriverError("Appium installed application is unavailable")
        install_at = _utc_timestamp()
        self._request(
            "POST",
            self._path("/appium/device/activate_app"),
            {"appId": application_id},
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        assert self._build_attestation is not None
        source_gate_id = getattr(
            self,
            "source_gate_id",
            MOBILE_OAUTH_PROOF_GATE_ID,
        )
        payload = {
            "artifactKind": (
                "mobile-fresh-install-trace"
                if source_gate_id == MOBILE_OAUTH_PROOF_GATE_ID
                else "mobile-native-scenario-fresh-install-trace"
            ),
            "runId": self._build_attestation["runId"],
            "gateId": source_gate_id,
            "clientId": self.client_id,
            "platform": self.platform,
            "buildAttestation": self.build_attestation_ref.to_dict(),
            "applicationId": application_id,
            "artifactSha256": self._build_attestation["artifact"]["sha256"],
            "uninstall": {
                "stepIndex": 1,
                "requested": True,
                "priorInstallationAbsent": True,
                "completedAt": uninstall_at,
            },
            "install": {
                "stepIndex": 2,
                "completed": True,
                "applicationPresent": True,
                "completedAt": install_at,
            },
            "observedAt": _utc_timestamp(),
        }
        if source_gate_id == MOBILE_OAUTH_PROOF_GATE_ID:
            assert self.physical_device_lease_ref is not None
            payload["physicalDeviceLease"] = (
                self.physical_device_lease_ref.to_dict()
            )
            return validate_contract_payload(
                payload,
                expected_kind="mobile-fresh-install-trace",
                expected_run_id=self._build_attestation["runId"],
                expected_workspace_id=self.build_attestation_ref.workspace_id,
            )
        return payload

    def _is_installed(
        self,
        application_id: str,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> bool:
        value = self._request(
            "POST",
            self._path("/appium/device/app_installed"),
            {"bundleId": application_id},
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        if not isinstance(value, bool):
            raise DriverError("Appium application readback is invalid")
        return value

    def _active_application_id(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> str:
        if self.platform == "ios":
            value = self.execute_script(
                "mobile: activeAppInfo",
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            field = "bundleId"
        else:
            value = self.execute_script(
                "mobile: getCurrentActivity",
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            field = "appPackage"
        result = (
            str(value.get(field) or "") if isinstance(value, Mapping) else ""
        )
        if not result:
            raise DriverError("Appium active application is unavailable")
        return result

    def _request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
        *,
        max_response_bytes: int = MAX_APPIUM_RESPONSE_BYTES,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> Any:
        if self._device_lease is None:
            raise DriverError("Appium physical-device authority is unavailable")
        request_options: dict[str, Any] = {
            "max_response_bytes": max_response_bytes
        }
        if deadline_monotonic is not None:
            request_options["deadline_monotonic"] = deadline_monotonic
        if cancellation is not None:
            request_options["cancellation"] = cancellation
        return self._with_physical_device(
            self._device_lease,
            lambda _: self.transport.request(
                method,
                path,
                payload,
                **request_options,
            ),
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )

    def _with_physical_device(
        self,
        lease: Mapping[str, Any],
        operation: Callable[[ResolvedPhysicalDeviceHandle], Any],
        *,
        deadline_monotonic: float | None,
        cancellation: threading.Event | None,
    ) -> Any:
        options: dict[str, Any] = {}
        if deadline_monotonic is not None:
            options["deadline_monotonic"] = deadline_monotonic
        if cancellation is not None:
            options["cancellation"] = cancellation
        return self.device_broker.with_physical_device(
            lease,
            operation,
            **options,
        )

    def _required_port(self, role: str) -> int:
        value = self.ports.get(role)
        if not isinstance(value, int) or value <= 0:
            raise DriverError(f"Appium requires port role {role!r}")
        return value

    def _path(self, suffix: str) -> str:
        if not self.session_id:
            raise DriverError("Appium session is not started")
        return (
            f"/session/{urllib.parse.quote(self.session_id, safe='')}{suffix}"
        )


def _utc_timestamp() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )


def _bounded_appium_deadline(
    timeout_seconds: float,
    deadline_monotonic: float | None,
) -> float:
    timeout = _positive_appium_timeout(timeout_seconds)
    deadline = time.monotonic() + timeout
    if deadline_monotonic is None:
        return deadline
    if (
        not isinstance(deadline_monotonic, (int, float))
        or isinstance(deadline_monotonic, bool)
        or not math.isfinite(deadline_monotonic)
    ):
        raise ValueError("Appium deadline must be finite")
    return min(deadline, float(deadline_monotonic))


def _positive_appium_timeout(timeout_seconds: float) -> float:
    if (
        not isinstance(timeout_seconds, (int, float))
        or isinstance(timeout_seconds, bool)
        or not math.isfinite(timeout_seconds)
        or timeout_seconds <= 0
    ):
        raise ValueError("Appium timeout must be a positive finite number")
    return float(timeout_seconds)


def _wait_for_appium_poll(
    timeout_seconds: float,
    *,
    cancellation: threading.Event | None,
) -> None:
    if cancellation is None:
        time.sleep(timeout_seconds)
        return
    if cancellation.wait(timeout_seconds):
        raise _AppiumDeadlineExceeded(
            "Appium request failed: HttpResponseCancelled"
        )


def _raise_if_capability_deadline_exhausted(
    deadline_monotonic: float | None,
    *,
    local_deadline: float,
    cancellation: threading.Event | None,
) -> None:
    if cancellation is not None and cancellation.is_set():
        raise _AppiumDeadlineExceeded(
            "Appium request failed: HttpResponseCancelled"
        )
    if (
        deadline_monotonic is not None
        and deadline_monotonic <= local_deadline
        and time.monotonic() >= deadline_monotonic
    ):
        raise _AppiumDeadlineExceeded(
            "Appium request failed: HttpResponseDeadlineExceeded"
        )


def _mobile_capture_id(
    payload: Mapping[str, object],
    *,
    client_id: str,
) -> str:
    capture_id = _capability_text(
        payload,
        "captureId",
        resource=f"mobile.native.appium-session:{client_id}",
    )
    if MOBILE_CAPTURE_ID_PATTERN.fullmatch(capture_id) is None:
        raise EphemeralCapabilityBlocked(
            "Mobile evidence capture identity is invalid",
            resource=f"mobile.native.appium-session:{client_id}",
        )
    return capture_id


def _assert_mobile_channel_safe(
    value: object,
    *,
    path: str = "$",
) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
            if normalized in MOBILE_CHANNEL_FORBIDDEN_FIELDS:
                raise ValueError(
                    f"Mobile Appium response field is forbidden at {path}.{key}"
                )
            _assert_mobile_channel_safe(item, path=f"{path}.{key}")
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _assert_mobile_channel_safe(item, path=f"{path}[{index}]")
        return
    if isinstance(value, str) and any(
        pattern.search(value)
        for pattern in MOBILE_CHANNEL_FORBIDDEN_VALUE_PATTERNS
    ):
        raise ValueError(
            f"Mobile Appium response contains forbidden material at {path}"
        )


def _closed_mapping(
    value: object,
    *,
    required: set[str],
    optional: set[str] = frozenset(),
    label: str,
) -> Mapping[str, object]:
    if not isinstance(value, Mapping) or set(value) - required - optional:
        raise EphemeralCapabilityBlocked(
            f"{label} response has an invalid field set",
            resource="mobile.native.appium-session:harness-response",
        )
    missing = required - set(value)
    if missing:
        raise EphemeralCapabilityBlocked(
            f"{label} response is missing fields: {sorted(missing)}",
            resource="mobile.native.appium-session:harness-response",
        )
    return value


def _response_string(
    value: object,
    *,
    label: str,
    nullable: bool = False,
) -> None:
    if value is None and nullable:
        return
    if not isinstance(value, str):
        raise EphemeralCapabilityBlocked(
            f"{label} response field must be a string",
            resource="mobile.native.appium-session:harness-response",
        )


def _response_number(value: object, *, label: str) -> None:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise EphemeralCapabilityBlocked(
            f"{label} response field must be a finite number",
            resource="mobile.native.appium-session:harness-response",
        )


def _response_integer(
    value: object,
    *,
    label: str,
    minimum: int | None = None,
) -> None:
    if isinstance(value, bool) or not isinstance(value, int):
        raise EphemeralCapabilityBlocked(
            f"{label} response field must be an integer",
            resource="mobile.native.appium-session:harness-response",
        )
    if minimum is not None and value < minimum:
        raise EphemeralCapabilityBlocked(
            f"{label} response field must be at least {minimum}",
            resource="mobile.native.appium-session:harness-response",
        )


def _response_nonempty_string(value: object, *, label: str) -> None:
    _response_string(value, label=label)
    if not str(value).strip():
        raise EphemeralCapabilityBlocked(
            f"{label} response field must not be empty",
            resource="mobile.native.appium-session:harness-response",
        )


def _response_ptid(value: object, *, label: str) -> None:
    _response_nonempty_string(value, label=label)
    if not str(value).startswith("ptid:"):
        raise EphemeralCapabilityBlocked(
            f"{label} response field must be a PTID",
            resource="mobile.native.appium-session:harness-response",
        )


def _response_string_list(
    value: object,
    *,
    label: str,
    ptids: bool = False,
) -> None:
    if not isinstance(value, list):
        raise EphemeralCapabilityBlocked(
            f"{label} response field must be a list",
            resource="mobile.native.appium-session:harness-response",
        )
    for index, item in enumerate(value):
        item_label = f"{label}[{index}]"
        if ptids:
            _response_ptid(item, label=item_label)
        else:
            _response_nonempty_string(item, label=item_label)


def _validate_messaging_attachment(value: object) -> None:
    attachment = _closed_mapping(
        value,
        required={
            "attachmentId",
            "filename",
            "mimeType",
            "plaintextSize",
        },
        optional={"ciphertextSize", "availabilityState"},
        label="Messaging attachment",
    )
    for field in ("attachmentId", "filename", "mimeType"):
        _response_nonempty_string(
            attachment[field],
            label=f"Messaging attachment {field}",
        )
    _response_integer(
        attachment["plaintextSize"],
        label="Messaging attachment plaintextSize",
        minimum=0,
    )
    if "ciphertextSize" in attachment:
        _response_integer(
            attachment["ciphertextSize"],
            label="Messaging attachment ciphertextSize",
            minimum=0,
        )
    if (
        "availabilityState" in attachment
        and attachment["availabilityState"] not in {"remote", "local"}
    ):
        raise EphemeralCapabilityBlocked(
            "Messaging attachment availabilityState is invalid",
            resource="mobile.native.appium-session:harness-response",
        )


def _validate_messaging_message(value: object) -> None:
    message = _closed_mapping(
        value,
        required={
            "messageId",
            "senderPtid",
            "state",
            "timestampUnixMs",
            "retracted",
            "reactions",
            "readByPtids",
            "plaintext",
            "attachments",
        },
        optional={
            "eventId",
            "eventSequence",
            "replyToMessageId",
            "threadRootMessageId",
            "editedText",
            "editedAtUnixMs",
            "pinnedByPtid",
            "pinnedAtUnixMs",
        },
        label="Messaging message",
    )
    _response_nonempty_string(message["messageId"], label="Messaging message messageId")
    _response_ptid(message["senderPtid"], label="Messaging message senderPtid")
    if message["state"] not in {
        "draft",
        "pending",
        "prepared",
        "retry_wait",
        "submitted",
        "failed",
        "terminal",
        "accepted",
        "delivered",
        "read",
    }:
        raise EphemeralCapabilityBlocked(
            "Messaging message state is invalid",
            resource="mobile.native.appium-session:harness-response",
        )
    _response_integer(
        message["timestampUnixMs"],
        label="Messaging message timestampUnixMs",
        minimum=0,
    )
    if not isinstance(message["retracted"], bool):
        raise EphemeralCapabilityBlocked(
            "Messaging message retracted response field must be a boolean",
            resource="mobile.native.appium-session:harness-response",
        )
    _response_string(message["plaintext"], label="Messaging message plaintext")
    for field in (
        "eventId",
        "replyToMessageId",
        "threadRootMessageId",
        "pinnedByPtid",
    ):
        if field in message:
            if field == "pinnedByPtid":
                _response_ptid(message[field], label=f"Messaging message {field}")
            else:
                _response_nonempty_string(
                    message[field],
                    label=f"Messaging message {field}",
                )
    for field in ("eventSequence", "editedAtUnixMs", "pinnedAtUnixMs"):
        if field in message:
            _response_integer(
                message[field],
                label=f"Messaging message {field}",
                minimum=0,
            )
    if "editedText" in message:
        _response_string(message["editedText"], label="Messaging message editedText")
    _response_string_list(
        message["readByPtids"],
        label="Messaging message readByPtids",
        ptids=True,
    )
    reactions = message["reactions"]
    if not isinstance(reactions, list):
        raise EphemeralCapabilityBlocked(
            "Messaging message reactions response field must be a list",
            resource="mobile.native.appium-session:harness-response",
        )
    for reaction_value in reactions:
        reaction = _closed_mapping(
            reaction_value,
            required={"actorPtid", "reaction", "createdAtUnixMs"},
            label="Messaging reaction",
        )
        _response_ptid(reaction["actorPtid"], label="Messaging reaction actorPtid")
        _response_nonempty_string(
            reaction["reaction"],
            label="Messaging reaction reaction",
        )
        _response_integer(
            reaction["createdAtUnixMs"],
            label="Messaging reaction createdAtUnixMs",
            minimum=0,
        )
    attachments = message["attachments"]
    if not isinstance(attachments, list):
        raise EphemeralCapabilityBlocked(
            "Messaging message attachments response field must be a list",
            resource="mobile.native.appium-session:harness-response",
        )
    for attachment in attachments:
        _validate_messaging_attachment(attachment)


def _validate_messaging_submission(
    value: object,
    *,
    label: str,
    interaction: bool,
) -> None:
    result = _closed_mapping(
        value,
        required={"conversationId", "messageId", "attachmentIds", "state"},
        optional={"commandId"},
        label=label,
    )
    _response_nonempty_string(result["conversationId"], label=f"{label} conversationId")
    _response_nonempty_string(result["messageId"], label=f"{label} messageId")
    _response_string_list(result["attachmentIds"], label=f"{label} attachmentIds")
    allowed_states = {"pending"} if interaction else {"pending", "draft"}
    if result["state"] not in allowed_states:
        raise EphemeralCapabilityBlocked(
            f"{label} state is invalid",
            resource="mobile.native.appium-session:harness-response",
        )
    if "commandId" in result:
        _response_nonempty_string(result["commandId"], label=f"{label} commandId")
    if result["state"] == "pending" and "commandId" not in result:
        raise EphemeralCapabilityBlocked(
            f"{label} pending response requires commandId",
            resource="mobile.native.appium-session:harness-response",
        )
    if result["state"] == "draft" and (
        "commandId" in result or not result["attachmentIds"]
    ):
        raise EphemeralCapabilityBlocked(
            f"{label} draft response requires attachments and no commandId",
            resource="mobile.native.appium-session:harness-response",
        )
    if interaction and result["attachmentIds"]:
        raise EphemeralCapabilityBlocked(
            f"{label} response must not add attachments",
            resource="mobile.native.appium-session:harness-response",
        )


def _validate_messaging_projection(value: object) -> None:
    projection = _closed_mapping(
        value,
        required={"runtime", "conversations", "messages"},
        label="Messaging projection",
    )
    runtime = _closed_mapping(
        projection["runtime"],
        required={
            "active",
            "deviceEnrolled",
            "laneSequence",
            "consumerEpoch",
            "conversationCount",
            "activationGeneration",
            "workerPhase",
        },
        optional={"profileId", "stationPeerId", "actorPtid", "deviceId"},
        label="Messaging runtime",
    )
    for field in ("active", "deviceEnrolled"):
        if not isinstance(runtime[field], bool):
            raise EphemeralCapabilityBlocked(
                f"Messaging runtime {field} response field must be a boolean",
                resource="mobile.native.appium-session:harness-response",
            )
    for field in (
        "laneSequence",
        "consumerEpoch",
        "conversationCount",
        "activationGeneration",
    ):
        _response_integer(
            runtime[field],
            label=f"Messaging runtime {field}",
            minimum=0,
        )
    if runtime["workerPhase"] not in {"running", "suspended", "stopping"}:
        raise EphemeralCapabilityBlocked(
            "Messaging runtime workerPhase is invalid",
            resource="mobile.native.appium-session:harness-response",
        )
    for field in ("profileId", "stationPeerId", "deviceId"):
        if field in runtime:
            _response_nonempty_string(runtime[field], label=f"Messaging runtime {field}")
    if "actorPtid" in runtime:
        _response_ptid(runtime["actorPtid"], label="Messaging runtime actorPtid")

    conversations = projection["conversations"]
    if not isinstance(conversations, list):
        raise EphemeralCapabilityBlocked(
            "Messaging conversations response field must be a list",
            resource="mobile.native.appium-session:harness-response",
        )
    conversation_ids: set[str] = set()
    for conversation_value in conversations:
        conversation = _closed_mapping(
            conversation_value,
            required={
                "conversationId",
                "authorityStationId",
                "kind",
                "name",
                "ownerPtid",
                "memberPtids",
                "membershipEpoch",
                "mlsEpoch",
                "active",
                "updatedAtUnixMs",
            },
            label="Messaging conversation",
        )
        conversation_id = str(conversation["conversationId"])
        _response_nonempty_string(
            conversation["conversationId"],
            label="Messaging conversation conversationId",
        )
        if conversation_id in conversation_ids:
            raise EphemeralCapabilityBlocked(
                "Messaging projection contains duplicate conversations",
                resource="mobile.native.appium-session:harness-response",
            )
        conversation_ids.add(conversation_id)
        _response_nonempty_string(
            conversation["authorityStationId"],
            label="Messaging conversation authorityStationId",
        )
        _response_integer(conversation["kind"], label="Messaging conversation kind")
        if conversation["kind"] not in {1, 2}:
            raise EphemeralCapabilityBlocked(
                "Messaging conversation kind is invalid",
                resource="mobile.native.appium-session:harness-response",
            )
        _response_string(conversation["name"], label="Messaging conversation name")
        _response_ptid(
            conversation["ownerPtid"],
            label="Messaging conversation ownerPtid",
        )
        _response_string_list(
            conversation["memberPtids"],
            label="Messaging conversation memberPtids",
            ptids=True,
        )
        for field in ("membershipEpoch", "mlsEpoch", "updatedAtUnixMs"):
            _response_integer(
                conversation[field],
                label=f"Messaging conversation {field}",
                minimum=0,
            )
        if not isinstance(conversation["active"], bool):
            raise EphemeralCapabilityBlocked(
                "Messaging conversation active response field must be a boolean",
                resource="mobile.native.appium-session:harness-response",
            )

    messages = projection["messages"]
    if not isinstance(messages, Mapping) or any(
        not isinstance(key, str) or not key or key not in conversation_ids
        for key in messages
    ):
        raise EphemeralCapabilityBlocked(
            "Messaging projection message map has an invalid conversation key",
            resource="mobile.native.appium-session:harness-response",
        )
    for conversation_id, message_values in messages.items():
        if not isinstance(message_values, list):
            raise EphemeralCapabilityBlocked(
                f"Messaging projection messages for {conversation_id!r} must be a list",
                resource="mobile.native.appium-session:harness-response",
            )
        for message in message_values:
            _validate_messaging_message(message)


def _validate_social_projection(value: object) -> None:
    projection = _closed_mapping(
        value,
        required={
            "active",
            "activeSessionUlid",
            "friendRequests",
            "typingPeers",
            "peerOnline",
            "lastReconcileAt",
        },
        label="Social runtime projection",
    )
    if not isinstance(projection["active"], bool):
        raise EphemeralCapabilityBlocked(
            "Social runtime active response field must be a boolean",
            resource="mobile.native.appium-session:harness-response",
        )
    friend_requests = projection["friendRequests"]
    if not isinstance(friend_requests, list):
        raise EphemeralCapabilityBlocked(
            "Social runtime friendRequests response field must be a list",
            resource="mobile.native.appium-session:harness-response",
        )
    for raw_request in friend_requests:
        request = _closed_mapping(
            raw_request,
            required={"requestId", "senderPtid", "receiverPtid", "status"},
            label="Social friend request",
        )
        _response_nonempty_string(
            request["requestId"],
            label="Social friend request requestId",
        )
        _response_ptid(
            request["senderPtid"],
            label="Social friend request senderPtid",
        )
        _response_ptid(
            request["receiverPtid"],
            label="Social friend request receiverPtid",
        )
        _response_integer(
            request["status"],
            label="Social friend request status",
            minimum=0,
        )
    if projection["activeSessionUlid"] is not None:
        _response_nonempty_string(
            projection["activeSessionUlid"],
            label="Social runtime activeSessionUlid",
        )
    if projection["lastReconcileAt"] is not None:
        _response_integer(
            projection["lastReconcileAt"],
            label="Social runtime lastReconcileAt",
            minimum=0,
        )
    peer_online = projection["peerOnline"]
    if not isinstance(peer_online, Mapping):
        raise EphemeralCapabilityBlocked(
            "Social runtime peerOnline response field must be an object",
            resource="mobile.native.appium-session:harness-response",
        )
    for ptid, online in peer_online.items():
        _response_ptid(ptid, label="Social runtime peerOnline key")
        if not isinstance(online, bool):
            raise EphemeralCapabilityBlocked(
                "Social runtime peerOnline value must be a boolean",
                resource="mobile.native.appium-session:harness-response",
            )
    typing_peers = projection["typingPeers"]
    if not isinstance(typing_peers, Mapping):
        raise EphemeralCapabilityBlocked(
            "Social runtime typingPeers response field must be an object",
            resource="mobile.native.appium-session:harness-response",
        )
    for conversation_id, peers in typing_peers.items():
        _response_nonempty_string(
            conversation_id,
            label="Social runtime typingPeers conversation key",
        )
        if not isinstance(peers, Mapping):
            raise EphemeralCapabilityBlocked(
                "Social runtime typingPeers conversation value must be an object",
                resource="mobile.native.appium-session:harness-response",
            )
        for ptid, raw_entry in peers.items():
            _response_ptid(ptid, label="Social runtime typingPeers actor key")
            entry = _closed_mapping(
                raw_entry,
                required={"typing", "lastUpdate"},
                label="Social runtime typing entry",
            )
            if not isinstance(entry["typing"], bool):
                raise EphemeralCapabilityBlocked(
                    "Social runtime typing flag must be a boolean",
                    resource="mobile.native.appium-session:harness-response",
                )
            _response_integer(
                entry["lastUpdate"],
                label="Social runtime typing lastUpdate",
                minimum=0,
            )


def _validate_station_entry(value: object) -> None:
    entry = _closed_mapping(
        value,
        required={"stationPeerId", "url", "label"},
        optional={"online", "lastCheckedAt"},
        label="station entry",
    )
    for field in ("stationPeerId", "url", "label"):
        _response_string(entry[field], label=f"station entry {field}")
    if "online" in entry and not isinstance(entry["online"], bool):
        raise EphemeralCapabilityBlocked(
            "station entry online response field must be a boolean",
            resource="mobile.native.appium-session:harness-response",
        )
    if "lastCheckedAt" in entry:
        _response_number(
            entry["lastCheckedAt"],
            label="station entry lastCheckedAt",
        )


def _validate_access_decision(value: object, *, nullable: bool = False) -> None:
    if value is None and nullable:
        return
    decision = _closed_mapping(
        value,
        required={"state", "attemptId", "gates"},
        optional={"currentGateId", "accessGrantId"},
        label="access decision",
    )
    if isinstance(decision["state"], bool) or not isinstance(
        decision["state"], (str, int, float)
    ):
        raise EphemeralCapabilityBlocked(
            "access decision state has an invalid type",
            resource="mobile.native.appium-session:harness-response",
        )
    _response_string(decision["attemptId"], label="access decision attemptId")
    for field in ("currentGateId", "accessGrantId"):
        if field in decision:
            _response_string(decision[field], label=f"access decision {field}")
    gates = decision["gates"]
    if not isinstance(gates, list):
        raise EphemeralCapabilityBlocked(
            "access decision gates must be a list",
            resource="mobile.native.appium-session:harness-response",
        )
    for item in gates:
        gate = _closed_mapping(
            item,
            required={"gateId", "type", "state"},
            label="access gate",
        )
        _response_string(gate["gateId"], label="access gate gateId")
        for field in ("type", "state"):
            if isinstance(gate[field], bool) or not isinstance(
                gate[field], (str, int, float)
            ):
                raise EphemeralCapabilityBlocked(
                    f"access gate {field} has an invalid type",
                    resource="mobile.native.appium-session:harness-response",
                )


def _validate_session(
    value: object,
    *,
    include_station: bool,
) -> None:
    if value is None:
        return
    required = {"actorPtid"}
    if include_station:
        required.add("stationPeerId")
    session = _closed_mapping(
        value,
        required=required,
        optional={"expiresAt"},
        label="access session",
    )
    for field in required:
        _response_string(session[field], label=f"access session {field}")
    if "expiresAt" in session:
        _response_string(session["expiresAt"], label="access session expiresAt")


def _validate_oauth_projection(value: object) -> None:
    projection = _closed_mapping(
        value,
        required={
            "phase",
            "candidatePtid",
            "accessDecision",
            "session",
            "errorKey",
            "recovery",
        },
        optional={
            "stationPeerId",
            "provider",
            "accessAttemptId",
            "gateId",
            "expiresAtUnixMs",
            "result",
            "errorCode",
        },
        label="OAuth projection",
    )
    if projection["phase"] not in {
        "idle",
        "starting",
        "awaiting_provider",
        "callback_received",
        "exchanging",
        "following_gate",
        "credential_delivery",
        "active_session",
        "cancelled",
        "expired",
        "failed",
    }:
        raise EphemeralCapabilityBlocked(
            "OAuth projection phase is invalid",
            resource="mobile.native.appium-session:harness-response",
        )
    if projection["recovery"] not in {
        "none",
        "retry-provider",
        "check-status",
        "restart",
        "change-station",
    }:
        raise EphemeralCapabilityBlocked(
            "OAuth projection recovery is invalid",
            resource="mobile.native.appium-session:harness-response",
        )
    for field in (
        "candidatePtid",
        "errorKey",
    ):
        _response_string(
            projection[field],
            label=f"OAuth projection {field}",
            nullable=True,
        )
    for field in (
        "stationPeerId",
        "provider",
        "accessAttemptId",
        "gateId",
        "result",
        "errorCode",
    ):
        if field in projection:
            _response_string(
                projection[field],
                label=f"OAuth projection {field}",
            )
    if "expiresAtUnixMs" in projection:
        _response_number(
            projection["expiresAtUnixMs"],
            label="OAuth projection expiresAtUnixMs",
        )
    _validate_access_decision(projection["accessDecision"], nullable=True)
    _validate_session(projection["session"], include_station=False)


def _validate_lifecycle_snapshot(value: object) -> None:
    snapshot = _closed_mapping(
        value,
        required={
            "phase",
            "launchState",
            "generation",
            "bootOrder",
            "runtimes",
            "errorKey",
        },
        label="lifecycle snapshot",
    )
    if snapshot["phase"] not in {
        "COLD",
        "BOOTSTRAPPING",
        "ACTIVE",
        "SUSPENDING",
        "SUSPENDED",
        "RESUMING",
        "TEARDOWN",
    }:
        raise EphemeralCapabilityBlocked(
            "lifecycle snapshot phase is invalid",
            resource="mobile.native.appium-session:harness-response",
        )
    _response_string(
        snapshot["launchState"],
        label="lifecycle snapshot launchState",
    )
    _response_integer(
        snapshot["generation"],
        label="lifecycle snapshot generation",
        minimum=0,
    )
    boot_order = snapshot["bootOrder"]
    runtimes = snapshot["runtimes"]
    if (
        not isinstance(boot_order, list)
        or not boot_order
        or any(not isinstance(item, str) or not item for item in boot_order)
        or not isinstance(runtimes, list)
        or len(runtimes) != len(boot_order)
    ):
        raise EphemeralCapabilityBlocked(
            "lifecycle snapshot runtime graph is invalid",
            resource="mobile.native.appium-session:harness-response",
        )
    for runtime in runtimes:
        item = _closed_mapping(
            runtime,
            required={"id", "status", "errorKey"},
            label="lifecycle runtime",
        )
        _response_nonempty_string(item["id"], label="lifecycle runtime id")
        _response_nonempty_string(
            item["status"],
            label="lifecycle runtime status",
        )
        _response_string(
            item["errorKey"],
            label="lifecycle runtime errorKey",
            nullable=True,
        )
    _response_string(
        snapshot["errorKey"],
        label="lifecycle snapshot errorKey",
        nullable=True,
    )


def _validate_permission_result(value: object, *, requested: bool) -> None:
    boolean_field = "wasAlreadyGranted" if requested else "canRequest"
    result = _closed_mapping(
        value,
        required={"kind", "status", boolean_field},
        label="platform permission result",
    )
    if result["kind"] not in {
        "camera",
        "microphone",
        "storage",
        "notifications",
    } or result["status"] not in {
        "not_determined",
        "granted",
        "denied",
        "restricted",
        "unsupported",
    }:
        raise EphemeralCapabilityBlocked(
            "platform permission response is invalid",
            resource="mobile.native.appium-session:harness-response",
        )
    if not isinstance(result[boolean_field], bool):
        raise EphemeralCapabilityBlocked(
            "platform permission response flag is invalid",
            resource="mobile.native.appium-session:harness-response",
        )


def _validate_harness_action_result(action: str, value: object) -> None:
    if action in {"station.add", "station.replace"}:
        result = _closed_mapping(
            value,
            required={
                "activeStationPeerId",
                "verifiedStationPeerId",
                "canonicalOrigin",
                "entries",
            },
            label=action,
        )
        for field in (
            "activeStationPeerId",
            "verifiedStationPeerId",
            "canonicalOrigin",
        ):
            _response_string(result[field], label=f"{action} {field}")
        if not isinstance(result["entries"], list):
            raise EphemeralCapabilityBlocked(
                f"{action} entries must be a list",
                resource="mobile.native.appium-session:harness-response",
            )
        for entry in result["entries"]:
            _validate_station_entry(entry)
        return
    if action == "access.submit":
        result = _closed_mapping(
            value,
            required={"decision", "session"},
            label=action,
        )
        _validate_access_decision(result["decision"])
        _validate_session(result["session"], include_station=True)
        return
    if action in {"oauth.start", "oauth.status", "oauth.cancel"}:
        _validate_oauth_projection(value)
        return
    if action == "lifecycle.snapshot":
        _validate_lifecycle_snapshot(value)
        return
    if action in {"lifecycle.suspend", "lifecycle.resume"}:
        result = _closed_mapping(
            value,
            required={"snapshot"},
            label=action,
        )
        _validate_lifecycle_snapshot(result["snapshot"])
        return
    if action == "lifecycle.restart":
        result = _closed_mapping(
            value,
            required={"requested", "scope"},
            label=action,
        )
        if result != {"requested": True, "scope": "webview"}:
            raise EphemeralCapabilityBlocked(
                "lifecycle restart response is invalid",
                resource="mobile.native.appium-session:harness-response",
            )
        return
    if action == "platform.permission.check":
        _validate_permission_result(value, requested=False)
        return
    if action == "platform.permission.request":
        _validate_permission_result(value, requested=True)
        return
    if action == "platform.permission.checkAll":
        if not isinstance(value, list) or len(value) != 4:
            raise EphemeralCapabilityBlocked(
                "platform permission inventory is invalid",
                resource="mobile.native.appium-session:harness-response",
            )
        for permission in value:
            _validate_permission_result(permission, requested=False)
        return
    if action == "platform.network.read":
        result = _closed_mapping(
            value,
            required={"connected", "networkType", "updatedAtMs"},
            label=action,
        )
        if (
            not isinstance(result["connected"], bool)
            or result["networkType"]
            not in {"none", "wifi", "cellular", "ethernet", "unknown"}
            or (result["connected"] and result["networkType"] == "none")
            or (not result["connected"] and result["networkType"] != "none")
        ):
            raise EphemeralCapabilityBlocked(
                "platform network response is inconsistent",
                resource="mobile.native.appium-session:harness-response",
            )
        _response_integer(
            result["updatedAtMs"],
            label="platform network updatedAtMs",
            minimum=0,
        )
        return
    if action == "projection.read":
        result = _closed_mapping(
            value,
            required={"station", "access", "oauth"},
            label=action,
        )
        station = _closed_mapping(
            result["station"],
            required={"activeStationPeerId", "entries"},
            label="station projection",
        )
        _response_string(
            station["activeStationPeerId"],
            label="station projection activeStationPeerId",
        )
        if not isinstance(station["entries"], list):
            raise EphemeralCapabilityBlocked(
                "station projection entries must be a list",
                resource="mobile.native.appium-session:harness-response",
            )
        for entry in station["entries"]:
            _validate_station_entry(entry)
        access = _closed_mapping(
            result["access"],
            required={"decision", "session", "loading", "errorKey", "restored"},
            label="access projection",
        )
        _validate_access_decision(access["decision"], nullable=True)
        _validate_session(access["session"], include_station=True)
        if not isinstance(access["loading"], bool) or not isinstance(
            access["restored"], bool
        ):
            raise EphemeralCapabilityBlocked(
                "access projection flags must be booleans",
                resource="mobile.native.appium-session:harness-response",
            )
        _response_string(
            access["errorKey"],
            label="access projection errorKey",
            nullable=True,
        )
        _validate_oauth_projection(result["oauth"])
        return
    if action in {"messaging.createDirect", "messaging.createGroup"}:
        result = _closed_mapping(
            value,
            required={"conversationId", "state"},
            optional={"commandId"},
            label=action,
        )
        _response_nonempty_string(
            result["conversationId"],
            label=f"{action} conversationId",
        )
        allowed_states = (
            {"pending", "projected"}
            if action == "messaging.createDirect"
            else {"pending", "projected", "failed"}
        )
        if result["state"] not in allowed_states:
            raise EphemeralCapabilityBlocked(
                f"{action} state is invalid",
                resource="mobile.native.appium-session:harness-response",
            )
        if "commandId" in result:
            _response_nonempty_string(
                result["commandId"],
                label=f"{action} commandId",
            )
        if action == "messaging.createGroup" and "commandId" not in result:
            raise EphemeralCapabilityBlocked(
                "messaging.createGroup response requires commandId",
                resource="mobile.native.appium-session:harness-response",
            )
        return
    if action == "messaging.attachment.stage":
        result = _closed_mapping(
            value,
            required={
                "stageId",
                "filename",
                "mimeType",
                "plaintextSize",
                "completed",
            },
            label=action,
        )
        for field in ("stageId", "filename", "mimeType"):
            _response_nonempty_string(result[field], label=f"{action} {field}")
        _response_integer(
            result["plaintextSize"],
            label=f"{action} plaintextSize",
            minimum=0,
        )
        if result["completed"] is not True:
            raise EphemeralCapabilityBlocked(
                "messaging.attachment.stage response is incomplete",
                resource="mobile.native.appium-session:harness-response",
            )
        return
    if action == "messaging.attachment.open":
        result = _closed_mapping(
            value,
            required={"state", "available"},
            optional={"nextAttemptAtUnixMs"},
            label=action,
        )
        state = result["state"]
        if (
            state == "ready"
            and result["available"] is True
            and "nextAttemptAtUnixMs" not in result
        ):
            return
        if (
            state == "pending"
            and result["available"] is False
            and "nextAttemptAtUnixMs" in result
        ):
            _response_integer(
                result["nextAttemptAtUnixMs"],
                label=f"{action} nextAttemptAtUnixMs",
                minimum=0,
            )
            return
        raise EphemeralCapabilityBlocked(
            "messaging.attachment.open response is invalid",
            resource="mobile.native.appium-session:harness-response",
        )
    if action in {"messaging.send", "messaging.interact"}:
        _validate_messaging_submission(
            value,
            label=action,
            interaction=action == "messaging.interact",
        )
        return
    if action == "messaging.read":
        result = _closed_mapping(
            value,
            required={"conversationId", "lastReadSequence", "submitted"},
            label=action,
        )
        _response_nonempty_string(
            result["conversationId"],
            label=f"{action} conversationId",
        )
        _response_integer(
            result["lastReadSequence"],
            label=f"{action} lastReadSequence",
            minimum=1,
        )
        if result["submitted"] is not True:
            raise EphemeralCapabilityBlocked(
                "messaging.read response was not submitted",
                resource="mobile.native.appium-session:harness-response",
            )
        return
    if action == "messaging.typing":
        result = _closed_mapping(
            value,
            required={"conversationId", "isTyping", "submitted"},
            label=action,
        )
        _response_nonempty_string(
            result["conversationId"],
            label=f"{action} conversationId",
        )
        if not isinstance(result["isTyping"], bool) or result["submitted"] is not True:
            raise EphemeralCapabilityBlocked(
                "messaging.typing response is invalid",
                resource="mobile.native.appium-session:harness-response",
            )
        return
    if action == "messaging.reconcile":
        if value is None:
            return
        result = _closed_mapping(
            value,
            required={
                "deviceEnrolled",
                "processed",
                "cursor",
                "laneHead",
                "consumerEpoch",
                "deliveryReceiptSubmitted",
                "commandState",
            },
            optional={"commandId", "nextAttemptAtUnixMs"},
            label=action,
        )
        if not isinstance(result["deviceEnrolled"], bool) or not isinstance(
            result["deliveryReceiptSubmitted"],
            bool,
        ):
            raise EphemeralCapabilityBlocked(
                "messaging.reconcile boolean response fields are invalid",
                resource="mobile.native.appium-session:harness-response",
            )
        for field in ("processed", "cursor", "laneHead", "consumerEpoch"):
            _response_integer(
                result[field],
                label=f"{action} {field}",
                minimum=0,
            )
        if result["commandState"] not in {
            "idle",
            "submitted",
            "retry_scheduled",
            "failed",
            "stale_delivery_plan",
            "stale_authority_plan",
        }:
            raise EphemeralCapabilityBlocked(
                "messaging.reconcile commandState is invalid",
                resource="mobile.native.appium-session:harness-response",
            )
        command_state = result["commandState"]
        if "commandId" in result:
            _response_nonempty_string(
                result["commandId"],
                label=f"{action} commandId",
            )
        if "nextAttemptAtUnixMs" in result:
            _response_integer(
                result["nextAttemptAtUnixMs"],
                label=f"{action} nextAttemptAtUnixMs",
                minimum=0,
            )
        if command_state == "idle" and (
            "commandId" in result or "nextAttemptAtUnixMs" in result
        ):
            raise EphemeralCapabilityBlocked(
                "messaging.reconcile idle response has command metadata",
                resource="mobile.native.appium-session:harness-response",
            )
        if command_state == "retry_scheduled" and (
            "commandId" not in result or "nextAttemptAtUnixMs" not in result
        ):
            raise EphemeralCapabilityBlocked(
                "messaging.reconcile retry response is incomplete",
                resource="mobile.native.appium-session:harness-response",
            )
        if command_state not in {"idle", "retry_scheduled"} and (
            "commandId" not in result or "nextAttemptAtUnixMs" in result
        ):
            raise EphemeralCapabilityBlocked(
                "messaging.reconcile command response metadata is invalid",
                resource="mobile.native.appium-session:harness-response",
            )
        return
    if action == "messaging.command.read":
        result = _closed_mapping(
            value,
            required={"commandId", "conversationId", "state", "lastErrorCode"},
            label=action,
        )
        for field in ("commandId", "conversationId"):
            _response_nonempty_string(result[field], label=f"{action} {field}")
        if result["state"] not in {
            "pending",
            "retry_wait",
            "submitted",
            "failed",
            "superseded",
            "committed",
        }:
            raise EphemeralCapabilityBlocked(
                "messaging.command.read state is invalid",
                resource="mobile.native.appium-session:harness-response",
            )
        _response_string(
            result["lastErrorCode"],
            label=f"{action} lastErrorCode",
        )
        return
    if action == "messaging.search":
        if not isinstance(value, list):
            raise EphemeralCapabilityBlocked(
                "messaging.search response must be a list",
                resource="mobile.native.appium-session:harness-response",
            )
        for message in value:
            _validate_messaging_message(message)
        return
    if action == "messaging.projection.read":
        _validate_messaging_projection(value)
        return
    if action in {
        "social.request.send",
        "social.request.accept",
        "social.reconcile",
        "social.projection.read",
    }:
        _validate_social_projection(value)
        return
    if action == "cleanup":
        result = _closed_mapping(
            value,
            required={
                "oauthPurge",
                "webSessionProjectionCleared",
                "stationRegistryCleared",
            },
            label=action,
        )
        purge = _closed_mapping(
            result["oauthPurge"],
            required={"stationRevocation", "secureStorage"},
            label="OAuth purge",
        )
        if purge["stationRevocation"] not in {
            "not_required",
            "confirmed",
            "unconfirmed",
        }:
            raise EphemeralCapabilityBlocked(
                "OAuth purge Station revocation is invalid",
                resource="mobile.native.appium-session:harness-response",
            )
        secure_storage = _closed_mapping(
            purge["secureStorage"],
            required={
                "activeAttemptIndexAbsent",
                "attemptSecretRecordAbsent",
                "currentSessionIndexAbsent",
                "credentialRecordAbsent",
                "publicProjectionAbsent",
            },
            label="OAuth secure-storage absence",
        )
        if (
            any(value is not True for value in secure_storage.values())
            or result["webSessionProjectionCleared"] is not True
            or result["stationRegistryCleared"] is not True
        ):
            raise EphemeralCapabilityBlocked(
                "OAuth cleanup response did not prove absence",
                resource="mobile.native.appium-session:harness-response",
            )
        return
    raise EphemeralCapabilityBlocked(
        f"Mobile Harness action {action!r} has no response contract",
        resource="mobile.native.appium-session:harness-response",
    )


def _validate_negative_callback_result(
    value: object,
    *,
    expected_operation: object,
    expected_failure: object,
) -> None:
    result = _closed_mapping(
        value,
        required={"operation", "failure", "projection"},
        label="negative OAuth callback",
    )
    if (
        result["operation"] != expected_operation
        or result["failure"] != expected_failure
    ):
        raise EphemeralCapabilityBlocked(
            "negative OAuth callback result does not match its intent",
            resource="mobile.native.appium-session:harness-response",
        )
    projection = _closed_mapping(
        result["projection"],
        required={"phase", "accessDecision", "sessionPresent"},
        optional={
            "stationPeerId",
            "provider",
            "accessAttemptId",
            "gateId",
            "expiresAtUnixMs",
            "result",
            "errorCode",
            "candidatePtid",
        },
        label="negative OAuth projection",
    )
    if projection["phase"] not in {
        "idle",
        "starting",
        "awaiting_provider",
        "callback_received",
        "exchanging",
        "following_gate",
        "credential_delivery",
        "active_session",
        "cancelled",
        "expired",
        "failed",
    } or not isinstance(projection["sessionPresent"], bool):
        raise EphemeralCapabilityBlocked(
            "negative OAuth projection is invalid",
            resource="mobile.native.appium-session:harness-response",
        )
    for field in (
        "stationPeerId",
        "provider",
        "accessAttemptId",
        "gateId",
        "result",
        "errorCode",
        "candidatePtid",
    ):
        if field in projection:
            _response_string(
                projection[field],
                label=f"negative OAuth projection {field}",
            )
    if "expiresAtUnixMs" in projection:
        _response_number(
            projection["expiresAtUnixMs"],
            label="negative OAuth projection expiresAtUnixMs",
        )
    decision = projection["accessDecision"]
    if decision is not None:
        decision = _closed_mapping(
            decision,
            required=set(),
            optional={"state", "currentGateId"},
            label="negative OAuth access decision",
        )
        for field in decision:
            _response_string(
                decision[field],
                label=f"negative OAuth access decision {field}",
            )


class MobileNativeAppiumCapabilityHandler(EphemeralCapabilityHandler):
    """Own Appium sessions and expose only the frozen D-18 operation surface."""

    def __init__(
        self,
        *,
        session_factory: Callable[[str], _ParentAppiumSession],
        artifact_writer: RunHandle,
        broker: MobileResourceLeaseBroker,
        device_leases: Mapping[str, Mapping[str, Any]],
        allowed_client_ids: Sequence[str] = tuple(EXPECTED_CLIENTS),
        allowed_operations: Sequence[str] = (
            MOBILE_NATIVE_CAPABILITIES["mobile.native.appium-session"]
        ),
        harness_actions: Sequence[str] = (),
        parent_harness_actions: Sequence[str] = (),
        sensitive_values: Sequence[str] = (),
    ) -> None:
        self._session_factory = session_factory
        self._artifact_writer = artifact_writer
        self._broker = broker
        self._device_leases = {
            client_id: dict(lease)
            for client_id, lease in device_leases.items()
        }
        self._allowed_client_ids = frozenset(allowed_client_ids)
        self._allowed_operations = tuple(allowed_operations)
        self._harness_actions = frozenset(harness_actions)
        self._parent_harness_actions = frozenset(parent_harness_actions)
        self._sensitive_values = tuple(
            value for value in sensitive_values if value
        )
        self._sessions: dict[str, _ParentAppiumSession] = {}
        self._cleanup_sessions: list[_ParentAppiumSession] = []
        self._session_refs: dict[str, str] = {}
        self._install_refs: dict[str, ArtifactRef] = {}
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return self._allowed_operations

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return self._sensitive_values

    @property
    def sessions(self) -> Mapping[str, _ParentAppiumSession]:
        return dict(self._sessions)

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        self._require_active(deadline_monotonic, cancellation)
        client_id = _capability_text(
            payload,
            "clientId",
            resource="mobile.native.appium-session",
        )
        if client_id not in self._allowed_client_ids:
            raise EphemeralCapabilityBlocked(
                "Mobile native Appium client is not declared",
                resource=f"mobile.native.appium-session:{client_id}",
            )
        if operation == "start":
            if client_id in self._sessions:
                raise EphemeralCapabilityBlocked(
                    "Mobile native Appium session is already active",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            session = self._session_factory(client_id)
            physical_device_lease = ArtifactRef.from_dict(
                _capability_mapping(
                    payload,
                    "physicalDeviceLease",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            )
            build_attestation = ArtifactRef.from_dict(
                _capability_mapping(
                    payload,
                    "buildAttestation",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            )
            if (
                physical_device_lease != session.physical_device_lease_ref
                or build_attestation != session.build_attestation_ref
            ):
                raise EphemeralCapabilityBlocked(
                    "Mobile native Appium source refs do not match acquisition",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            try:
                session.start(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
            except BaseException:
                if getattr(session, "session_id", ""):
                    self._cleanup_sessions.append(session)
                raise
            session_ref = secrets.token_hex(16)
            self._sessions[client_id] = session
            self._session_refs[client_id] = session_ref
            try:
                reference = self._artifact_writer.write_json(
                    f"evidence/mobile/runtime/{client_id}/install.json",
                    session.fresh_install_trace,
                    role=f"mobile-fresh-install-trace/{client_id}",
                    redact=False,
                )
            except BaseException:
                try:
                    session.stop(
                        deadline_monotonic=deadline_monotonic,
                        cancellation=cancellation,
                    )
                except BaseException:
                    pass
                else:
                    self._sessions.pop(client_id, None)
                    self._session_refs.pop(client_id, None)
                raise
            self._install_refs[client_id] = reference
            return {
                "clientId": client_id,
                "sessionRef": session_ref,
                "applicationId": session._application_id,
                "freshInstallTrace": reference.to_dict(),
            }

        session = self._require_session(client_id)
        if payload.get("sessionRef") != self._session_refs.get(client_id):
            raise EphemeralCapabilityBlocked(
                "Mobile native Appium session reference is invalid",
                resource=f"mobile.native.appium-session:{client_id}",
            )
        if operation == "stop":
            session.stop(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            del self._sessions[client_id]
            self._session_refs.pop(client_id, None)
            return {"clientId": client_id, "stopped": True}
        if operation == "wait_ready":
            session.wait_for_ready(
                self._timeout(payload, deadline_monotonic),
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            return {"clientId": client_id, "ready": True}
        if operation == "is_alive":
            return {
                "clientId": client_id,
                "alive": session.is_alive(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                ),
            }
        if operation == "contexts":
            return {
                "clientId": client_id,
                "contexts": session.contexts(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                ),
            }
        if operation == "switch_context":
            session.switch_context(
                _capability_text(
                    payload,
                    "name",
                    resource=f"mobile.native.appium-session:{client_id}",
                ),
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            return {"clientId": client_id, "switched": True}
        if operation == "harness_inventory":
            inventory = session.harness_inventory(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            return {
                "clientId": client_id,
                "actions": sorted(
                    set(inventory).intersection(self._harness_actions)
                ),
            }
        if operation == "harness_action":
            action = _capability_text(
                payload,
                "action",
                resource=f"mobile.native.appium-session:{client_id}",
            )
            if (
                action not in self._harness_actions
                or action in self._parent_harness_actions
            ):
                raise EphemeralCapabilityBlocked(
                    "Mobile Acceptance Harness action is not allowlisted",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            action_payload = _capability_mapping(
                payload,
                "actionPayload",
                resource=f"mobile.native.appium-session:{client_id}",
            )
            value = session.call_action(
                action,
                action_payload,
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            _validate_harness_action_result(action, value)
            return {
                "clientId": client_id,
                "value": value,
            }
        if operation == "harness_negative_callback":
            if "oauth.negativeCallback" not in self._parent_harness_actions:
                raise EphemeralCapabilityBlocked(
                    "Mobile negative callback action is not parent-authorized",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            negative_payload = dict(
                _capability_mapping(
                    payload,
                    "negativePayload",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            )
            intent = dict(
                _capability_mapping(
                    negative_payload,
                    "intent",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            )
            intent_operation = intent.get("operation")
            if intent_operation == "replay":
                if "oauth.replayHandle" not in self._parent_harness_actions:
                    raise EphemeralCapabilityBlocked(
                        "Mobile replay action is not parent-authorized",
                        resource=f"mobile.native.appium-session:{client_id}",
                    )
                replay_payload = _capability_mapping(
                    payload,
                    "replayPayload",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
                replay = session.call_action(
                    "oauth.replayHandle",
                    replay_payload,
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                if (
                    not isinstance(replay, Mapping)
                    or set(replay) != {"callbackReplayHandle"}
                ):
                    raise EphemeralCapabilityBlocked(
                        "Mobile replay handle response is invalid",
                        resource=f"mobile.native.appium-session:{client_id}",
                    )
                callback_replay_handle = replay.get("callbackReplayHandle")
                if (
                    not isinstance(callback_replay_handle, str)
                    or not callback_replay_handle
                ):
                    raise EphemeralCapabilityBlocked(
                        "Mobile replay handle is unavailable",
                        resource=f"mobile.native.appium-session:{client_id}",
                    )
                intent["callbackReplayHandle"] = callback_replay_handle
            elif "replayPayload" in payload:
                raise EphemeralCapabilityBlocked(
                    "Mobile non-replay callback cannot carry replay input",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            try:
                negative_payload["intent"] = validate_contract_payload(
                    intent,
                    expected_kind="mobile-oauth-negative-callback-intent",
                    expected_run_id=session.build_attestation_ref.run_id,
                    expected_gate_id=MOBILE_OAUTH_PROOF_GATE_ID,
                    expected_workspace_id=(
                        session.build_attestation_ref.workspace_id
                    ),
                    durable=False,
                )
            except ProofContractError as error:
                raise EphemeralCapabilityBlocked(
                    "Mobile replay callback intent is invalid",
                    resource=f"mobile.native.appium-session:{client_id}",
                ) from error
            value = session.call_action(
                "oauth.negativeCallback",
                negative_payload,
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            _validate_negative_callback_result(
                value,
                expected_operation=intent_operation,
                expected_failure=intent.get("expectedFailure"),
            )
            return {"clientId": client_id, "value": value}
        if operation == "refresh_webview":
            session.refresh_webview(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            return {"clientId": client_id, "refreshed": True}
        if operation == "background_app":
            duration_seconds = payload.get("durationSeconds")
            if (
                not isinstance(duration_seconds, (int, float))
                or isinstance(duration_seconds, bool)
                or not math.isfinite(duration_seconds)
                or duration_seconds <= 0
                or duration_seconds > 30
            ):
                raise EphemeralCapabilityBlocked(
                    "Mobile native background duration is invalid",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            session.background_app(
                float(duration_seconds),
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            return {
                "clientId": client_id,
                "backgrounded": True,
                "durationSeconds": float(duration_seconds),
            }
        if operation == "find_element":
            element_ref = session.find_element(
                _capability_text(
                    payload,
                    "using",
                    resource=f"mobile.native.appium-session:{client_id}",
                ),
                _capability_text(
                    payload,
                    "value",
                    resource=f"mobile.native.appium-session:{client_id}",
                ),
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            return {"clientId": client_id, "elementRef": element_ref}
        if operation == "click":
            session.click(
                _capability_text(
                    payload,
                    "elementRef",
                    resource=f"mobile.native.appium-session:{client_id}",
                ),
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            return {"clientId": client_id, "clicked": True}
        if operation == "capture_page_source":
            capture_kind = _capability_text(
                payload,
                "captureKind",
                resource=f"mobile.native.appium-session:{client_id}",
            )
            if capture_kind == "native-ax":
                path = f"mobile/{client_id}/native-ax.xml"
                media_type = "application/xml"
                role = f"{client_id}-native-ax"
            elif capture_kind == "web-dom":
                variant_id = _mobile_capture_id(payload, client_id=client_id)
                path = (
                    f"evidence/mobile/{variant_id}/{client_id}/web-dom.html"
                )
                media_type = "text/html"
                role = None
            else:
                raise EphemeralCapabilityBlocked(
                    "Mobile page-source capture kind is invalid",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            page_source = session.get_page_source(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            _assert_mobile_channel_safe(page_source)
            reference = self._artifact_writer.write_bytes(
                path,
                page_source.encode("utf-8"),
                media_type=media_type,
                role=role,
            )
            return {
                "clientId": client_id,
                "pageSource": reference.to_dict(),
            }
        if operation == "capture_screenshot":
            variant_id = _mobile_capture_id(payload, client_id=client_id)
            screenshot = session.screenshot_bytes(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            if len(screenshot) > MAX_MOBILE_SCREENSHOT_BYTES:
                raise EphemeralCapabilityBlocked(
                    "Mobile native screenshot exceeds the evidence byte limit",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            reference = self._artifact_writer.write_bytes(
                (
                    f"evidence/mobile/{variant_id}/"
                    f"{client_id}/screenshot.png"
                ),
                screenshot,
                media_type="image/png",
            )
            return {
                "clientId": client_id,
                "screenshot": reference.to_dict(),
            }
        if operation == "verify_build_identity":
            if "build.identity" not in self._parent_harness_actions:
                raise EphemeralCapabilityBlocked(
                    "Mobile build identity action is not parent-authorized",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            install_ref = self._install_refs.get(client_id)
            if install_ref is None:
                raise EphemeralCapabilityBlocked(
                    "Mobile native fresh-install evidence is unavailable",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            requested_install_ref = ArtifactRef.from_dict(
                _capability_mapping(
                    payload,
                    "freshInstallTrace",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            )
            if requested_install_ref != install_ref:
                raise EphemeralCapabilityBlocked(
                    "Mobile native fresh-install ref does not match the session",
                    resource=f"mobile.native.appium-session:{client_id}",
                )
            identity = session.verify_installed_build_identity(
                install_ref,
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            reference = self._artifact_writer.write_json(
                f"evidence/mobile/runtime/{client_id}/build-identity.json",
                identity,
                role=f"mobile-installed-build-identity/{client_id}",
                redact=False,
            )
            return {
                "clientId": client_id,
                "installedBuildIdentity": reference.to_dict(),
            }
        raise EphemeralCapabilityBlocked(
            "Mobile native Appium operation is not implemented",
            resource=f"mobile.native.appium-session:{operation}",
        )

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        projected = dict(response)
        if projected.get("status") == "OK":
            result = projected.get("result")
            if not isinstance(result, Mapping):
                raise ValueError("Mobile Appium response result is invalid")
            expected_fields = {
                "start": {
                    "clientId",
                    "sessionRef",
                    "applicationId",
                    "freshInstallTrace",
                },
                "stop": {"clientId", "stopped"},
                "wait_ready": {"clientId", "ready"},
                "is_alive": {"clientId", "alive"},
                "contexts": {"clientId", "contexts"},
                "switch_context": {"clientId", "switched"},
                "harness_inventory": {"clientId", "actions"},
                "harness_action": {"clientId", "value"},
                "harness_negative_callback": {"clientId", "value"},
                "refresh_webview": {"clientId", "refreshed"},
                "background_app": {
                    "clientId",
                    "backgrounded",
                    "durationSeconds",
                },
                "find_element": {"clientId", "elementRef"},
                "click": {"clientId", "clicked"},
                "capture_page_source": {"clientId", "pageSource"},
                "capture_screenshot": {"clientId", "screenshot"},
                "verify_build_identity": {
                    "clientId",
                    "installedBuildIdentity",
                },
            }
            if operation not in expected_fields or set(result) != expected_fields[
                operation
            ]:
                raise ValueError(
                    "Mobile Appium response does not match its closed operation schema"
                )
        _assert_mobile_channel_safe(projected)
        return projected

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        cancellation = threading.Event()
        succeeded = self._stop_all(
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        for lease in reversed(tuple(self._device_leases.values())):
            try:
                if not _quarantine_broker_lease(
                    self._broker,
                    lease,
                    "EPHEMERAL_CAPABILITY_QUARANTINED",
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                ):
                    succeeded = False
            except BaseException:
                succeeded = False
            if time.monotonic() >= deadline_monotonic:
                succeeded = False
        return succeeded

    def close(self) -> EphemeralHandlerCleanup:
        deadline = (
            time.monotonic() + MOBILE_NATIVE_PARENT_CLEANUP_TIMEOUT_SECONDS
        )
        return EphemeralHandlerCleanup(
            closed=self._stop_all(
                deadline_monotonic=deadline,
                cancellation=threading.Event(),
            ),
            secrets_zeroized=True,
        )

    def _stop_all(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> bool:
        deadline = deadline_monotonic or (
            time.monotonic() + MOBILE_NATIVE_PARENT_CLEANUP_TIMEOUT_SECONDS
        )
        stop_signal = cancellation or threading.Event()
        failures = False
        for client_id, session in reversed(tuple(self._sessions.items())):
            try:
                _require_cleanup_budget(deadline, stop_signal)
                session.stop(
                    deadline_monotonic=deadline,
                    cancellation=stop_signal,
                )
            except Exception:
                failures = True
            else:
                self._sessions.pop(client_id, None)
                self._session_refs.pop(client_id, None)
        for session in reversed(self._cleanup_sessions):
            try:
                _require_cleanup_budget(deadline, stop_signal)
                session.stop(
                    deadline_monotonic=deadline,
                    cancellation=stop_signal,
                )
            except Exception:
                failures = True
            else:
                self._cleanup_sessions.remove(session)
        self._closed = True
        return not failures

    def _require_session(self, client_id: str) -> _ParentAppiumSession:
        session = self._sessions.get(client_id)
        if session is None:
            raise EphemeralCapabilityBlocked(
                "Mobile native Appium session is not active",
                resource=f"mobile.native.appium-session:{client_id}",
            )
        return session

    def _require_active(
        self,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> None:
        if self._closed or cancellation.is_set() or time.monotonic() >= deadline_monotonic:
            raise EphemeralCapabilityBlocked(
                "Mobile native Appium capability is unavailable",
                resource="mobile.native.appium-session",
            )

    @staticmethod
    def _timeout(
        payload: Mapping[str, object],
        deadline_monotonic: float,
    ) -> float:
        requested = payload.get("timeoutSeconds", 30.0)
        if (
            not isinstance(requested, (int, float))
            or isinstance(requested, bool)
            or not math.isfinite(requested)
            or requested <= 0
        ):
            raise EphemeralCapabilityBlocked(
                "Mobile native Appium timeout is invalid",
                resource="mobile.native.appium-session",
            )
        return min(float(requested), max(0.001, deadline_monotonic - time.monotonic()))


class MobileNativeProviderAuthorizationHandler(EphemeralCapabilityHandler):
    """Keep provider credentials and account serialization in the parent."""

    def __init__(
        self,
        *,
        broker: MobileResourceLeaseBroker,
        account_leases: Mapping[str, Mapping[str, Any]],
        browser_leases: Mapping[str, Mapping[str, Any]],
        credential_values: Mapping[str, str],
        appium_handler: MobileNativeAppiumCapabilityHandler,
    ) -> None:
        self._broker = broker
        self._account_leases = {
            provider: dict(lease) for provider, lease in account_leases.items()
        }
        self._browser_leases = {
            client_id: dict(lease)
            for client_id, lease in browser_leases.items()
        }
        self._credentials = {
            provider: bytearray(value.encode("utf-8"))
            for provider, value in credential_values.items()
        }
        self._appium_handler = appium_handler
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return MOBILE_NATIVE_CAPABILITIES[
            "mobile.native.provider-authorization"
        ]

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return tuple(
            value.decode("utf-8", errors="strict")
            for value in self._credentials.values()
            if value
        )

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        if (
            self._closed
            or operation != "authorize"
            or cancellation.is_set()
            or time.monotonic() >= deadline_monotonic
        ):
            raise EphemeralCapabilityBlocked(
                "Mobile native provider authorization is unavailable",
                resource="mobile.native.provider-authorization",
            )
        client_id = _capability_text(
            payload,
            "clientId",
            resource="mobile.native.provider-authorization",
        )
        provider = CLIENT_PROVIDER.get(client_id)
        if provider is None:
            raise EphemeralCapabilityBlocked(
                "Mobile native provider client is not declared",
                resource=f"mobile.native.provider-authorization:{client_id}",
            )
        if payload.get("provider") != provider:
            raise EphemeralCapabilityBlocked(
                "Mobile native provider does not match the client binding",
                resource=f"mobile.native.provider-authorization:{client_id}",
            )
        raw_credential = self._credentials.get(provider)
        account_lease = self._account_leases.get(provider)
        session = self._appium_handler.sessions.get(client_id)
        if raw_credential is None or account_lease is None or session is None:
            raise EphemeralCapabilityBlocked(
                "Mobile native provider authority is incomplete",
                resource=f"mobile.native.provider-authorization:{client_id}",
            )
        try:
            credential = json.loads(raw_credential.decode("utf-8"))
            steps = credential["steps"]
            if (
                credential.get("provider") != provider
                or not isinstance(steps, list)
                or not steps
            ):
                raise ValueError("provider credential shape is invalid")
        except (KeyError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            raise EphemeralCapabilityBlocked(
                "Mobile native provider credential is invalid",
                resource=f"mobile.native.provider-authorization:{provider}",
            ) from error

        def authorize() -> None:
            session.switch_to_native(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            for step in steps:
                if (
                    not isinstance(step, Mapping)
                    or step.get("action") != "click"
                    or not isinstance(step.get("using"), str)
                    or not isinstance(step.get("selector"), str)
                ):
                    raise EphemeralCapabilityBlocked(
                        "Mobile native provider step is invalid",
                        resource=f"mobile.native.provider-authorization:{provider}",
                    )
                element_ref = session.find_element(
                    str(step["using"]),
                    str(step["selector"]),
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                session.click(
                    element_ref,
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
            session.switch_to_app_webview(
                min(90.0, max(0.001, deadline_monotonic - time.monotonic())),
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )

        self._broker.authorize_provider(
            account_lease,
            client_id=client_id,
            operation=authorize,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        return {"clientId": client_id, "provider": provider, "authorized": True}

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        del operation
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason
        succeeded = True
        for leases in (self._browser_leases, self._account_leases):
            for lease in reversed(tuple(leases.values())):
                try:
                    if not _quarantine_broker_lease(
                        self._broker,
                        lease,
                        "EPHEMERAL_CAPABILITY_QUARANTINED",
                        deadline_monotonic=deadline_monotonic,
                    ):
                        succeeded = False
                except BaseException:
                    succeeded = False
                if time.monotonic() >= deadline_monotonic:
                    succeeded = False
        self._zeroize()
        return succeeded

    def close(self) -> EphemeralHandlerCleanup:
        self._zeroize()
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)

    def _zeroize(self) -> None:
        for value in self._credentials.values():
            for index in range(len(value)):
                value[index] = 0
        self._credentials.clear()
        self._closed = True


class MobileNativeStationFixtureCapabilityHandler(EphemeralCapabilityHandler):
    """Expose only the three frozen Station Fixture operations."""

    def __init__(self, fixture: MobileOAuthStationFixture) -> None:
        self._fixture = fixture
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return MOBILE_NATIVE_CAPABILITIES["mobile.native.station-fixture"]

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return ()

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        if self._closed or cancellation.is_set() or time.monotonic() >= deadline_monotonic:
            raise EphemeralCapabilityBlocked(
                "Mobile native Station Fixture is unavailable",
                resource="mobile.native.station-fixture",
            )
        service_id = _capability_text(
            payload,
            "serviceId",
            resource="mobile.native.station-fixture",
        )
        if service_id not in MOBILE_OAUTH_FIXTURE_SERVICES:
            raise EphemeralCapabilityBlocked(
                "Mobile native Station Fixture service is not declared",
                resource=f"mobile.native.station-fixture:{service_id}",
            )
        operation_id = _capability_text(
            payload,
            "operationId",
            resource="mobile.native.station-fixture",
        )
        variant_id = _capability_text(
            payload,
            "variantId",
            resource="mobile.native.station-fixture",
        )
        target = _capability_mapping(
            payload,
            "target",
            resource="mobile.native.station-fixture",
        )
        expected_provider = _capability_text(
            payload,
            "expectedProvider",
            resource="mobile.native.station-fixture",
        )
        if operation == "read_proof_snapshot":
            reference = self._fixture.snapshot(
                service_id,
                operation_id=operation_id,
                variant_id=variant_id,
                snapshot_phase=_capability_text(
                    payload,
                    "snapshotPhase",
                    resource="mobile.native.station-fixture",
                ),
                target=target,
                expected_provider=expected_provider,
                path=(
                    f"evidence/mobile/{variant_id}/station/{service_id}.json"
                ),
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            return {"artifactRef": reference.to_dict()}
        receipt = self._fixture.execute(
            service_id,
            operation_id=operation_id,
            variant_id=variant_id,
            operation=operation,
            target=target,
            oauth_state="OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER",
            expected_provider=expected_provider,
            invite_code=str(payload.get("inviteCode") or ""),
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        return {
            "completed": (
                receipt.get("journalState") == "COMMITTED"
                and receipt.get("preconditionMatched") is True
                and receipt.get("affectedRows") == 1
            )
        }

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        del operation
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        succeeded = True
        for service_id in reversed(MOBILE_OAUTH_FIXTURE_SERVICES):
            try:
                if not _quarantine_fixture_lease(
                    self._fixture,
                    service_id,
                    reason,
                        deadline_monotonic=deadline_monotonic,
                ):
                    succeeded = False
            except BaseException:
                succeeded = False
            if time.monotonic() >= deadline_monotonic:
                succeeded = False
        self._fixture.close()
        self._closed = True
        return succeeded

    def close(self) -> EphemeralHandlerCleanup:
        self._fixture.close()
        self._closed = True
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)


class MobileNativeProvisioner(EnvironmentProvisioner):
    environment_id = "mobile-native"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)
        self._artifact_session: RunHandle | None = None
        self._artifact_store: EvidenceStore | None = None
        self._native_spec: MobileNativePreflightSpec | None = None
        self._native_inputs: dict[str, Any] = {}
        self._physical_devices: dict[
            str,
            ResolvedPhysicalDeviceHandle,
        ] = {}
        self._client_resources: dict[str, dict[str, Any]] = {}
        self._source_projection: (
            MobileNativeSourceProjection
            | MobileNativeScenarioSourceProjection
            | None
        ) = None
        self._station_fixture: MobileOAuthStationFixture | None = None
        self._lease_broker: MobileResourceLeaseBroker | None = None
        self._heartbeat_owner: MobileResourceLeaseHeartbeatOwner | None = None
        self._account_leases: dict[str, dict[str, Any]] = {}
        self._device_leases: dict[str, dict[str, Any]] = {}
        self._browser_leases: dict[str, dict[str, Any]] = {}
        self._resource_leases: list[dict[str, Any]] = []
        self._fixture_heartbeat_leases: list[dict[str, Any]] = []
        self._restore_callbacks: dict[
            str,
            Callable[[float, threading.Event], BaselineRestoreResult],
        ] = {}
        self._service_bindings: dict[str, tuple[str, str]] = {}
        self._fixture_refs: dict[str, ArtifactRef] = {}
        self._actor_manifest_ref: dict[str, Any] | None = None
        self._credential_values_by_provider: dict[str, str] = {}
        self._provider_subjects: dict[str, str] = {}
        self._appium_handler: MobileNativeAppiumCapabilityHandler | None = None
        self._port_reservations: list[_PortReservation] = []
        self._storage_roots: list[Path] = []
        self._cleanup_registered = False

    def prepare_credentials(
        self,
    ) -> tuple[tuple[str, ...], dict[str, str]]:
        if self._native_spec is None:
            gate_id = self.evidence_run.gate_id
            self._native_spec = load_mobile_native_preflight_spec(
                gate_id=gate_id
            )
            self._select_scenario_contract(self._native_spec.scenario)
        return super().prepare_credentials()

    def create_gate_launch_context(
        self,
        *,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
        required_capabilities: tuple[str, ...],
    ) -> EphemeralGateLaunchContext:
        scenario = (
            getattr(self._native_spec, "scenario", None)
            if self._native_spec
            else None
        )
        scenario_id = scenario.id if scenario is not None else "access"
        expected = (
            scenario.ephemeral_capabilities
            if scenario is not None
            else tuple(MOBILE_NATIVE_CAPABILITIES)
        )
        if (
            gate_id
            != (
                scenario.gate_id
                if scenario is not None
                else MOBILE_OAUTH_PROOF_GATE_ID
            )
            or tuple(required_capabilities) != expected
        ):
            raise BlockedError(
                reason=(
                    "Mobile native Gate capabilities do not match its "
                    "scenario resource manifest"
                ),
                resource=f"ephemeral-capabilities:{gate_id}",
            )
        if (
            self._artifact_session is None
            or self._artifact_store is None
            or self._native_spec is None
            or self._source_projection is None
            or self._lease_broker is None
        ):
            raise BlockedError(
                reason="Mobile native parent authorities are not ready",
                resource=f"ephemeral-capabilities:{gate_id}",
            )
        if scenario_id == "access":
            if self._station_fixture is None:
                raise BlockedError(
                    reason="Mobile native OAuth parent authorities are not ready",
                    resource=f"ephemeral-capabilities:{gate_id}",
                )
        self._require_heartbeat_healthy()
        run_identities = (
            self._manifest.mobile_resources.get("runIdentities")
            if isinstance(self._manifest, MobileNativeRuntimeManifest)
            else None
        )
        authority_refs = [
            *(
                values["buildAttestation"]
                for values in self._source_projection.applications.values()
            ),
        ]
        if isinstance(self._source_projection, MobileNativeSourceProjection):
            authority_refs.extend(
                self._source_projection.provider_account_leases.values()
            )
            authority_refs.extend(
                values[field]
                for values in self._source_projection.clients.values()
                for field in ("physicalDeviceLease", "browserSessionLease")
            )
            authority_refs.extend(self._fixture_refs.values())
        else:
            authority_refs.extend(
                values["physicalDeviceLease"]
                for values in self._source_projection.clients.values()
            )
        if (
            not isinstance(run_identities, Mapping)
            or evidence_run_id == provisioning_run_id
            or evidence_run_id != self._artifact_session.run_id
            or provisioning_run_id != self._manifest.run_id
            or run_identities.get("evidenceRunId") != evidence_run_id
            or run_identities.get("provisioningRunId") != provisioning_run_id
            or any(
                reference.run_id != evidence_run_id
                for reference in authority_refs
            )
        ):
            raise BlockedError(
                reason="Mobile native run identity projection is invalid",
                resource=f"ephemeral-capabilities:{gate_id}:run-identities",
            )
        appium_handler = MobileNativeAppiumCapabilityHandler(
            session_factory=self._new_appium_session,
            artifact_writer=self._artifact_session,
            broker=self._lease_broker,
            device_leases=self._device_leases,
            allowed_client_ids=tuple(
                client.id for client in self._native_spec.clients
            ),
            allowed_operations=(
                scenario.appium_operations
                if scenario is not None
                else MOBILE_NATIVE_CAPABILITIES[
                    "mobile.native.appium-session"
                ]
            ),
            harness_actions=self._native_spec.harness_actions,
            parent_harness_actions=self._native_spec.parent_harness_actions,
            sensitive_values=tuple(
                dict.fromkeys(
                    (
                        *self._credential_values_by_provider.values(),
                        *self._provider_subjects.values(),
                    )
                )
            ),
        )
        context = EphemeralGateLaunchContext(
            required_capabilities=required_capabilities
        )
        context.register_capability(
            "mobile.native.appium-session",
            appium_handler,
        )
        if scenario_id == "access":
            assert self._lease_broker is not None
            assert self._station_fixture is not None
            context.register_capability(
                "mobile.native.provider-authorization",
                MobileNativeProviderAuthorizationHandler(
                    broker=self._lease_broker,
                    account_leases=self._account_leases,
                    browser_leases=self._browser_leases,
                    credential_values=self._credential_values_by_provider,
                    appium_handler=appium_handler,
                ),
            )
            context.register_capability(
                "mobile.native.station-fixture",
                MobileNativeStationFixtureCapabilityHandler(
                    self._station_fixture
                ),
            )
        self._appium_handler = appium_handler
        return context

    def _new_appium_session(self, client_id: str) -> _ParentAppiumSession:
        if (
            self._artifact_store is None
            or self._lease_broker is None
            or self._native_spec is None
            or self._source_projection is None
        ):
            raise BlockedError(
                reason="Mobile native Appium parent authority is unavailable",
                resource=f"mobile.native.appium-session:{client_id}",
            )
        client = next(
            item for item in self._native_spec.clients if item.id == client_id
        )
        resources = self._client_resources[client_id]
        return _ParentAppiumSession(
            _ParentAppiumTransport(str(self._native_inputs["appiumUrl"])),
            client_id=client_id,
            platform_name=client.platform,
            automation_name=self._native_spec.drivers[
                client.platform
            ].automation_name,
            artifact_reader=self._artifact_store,
            device_broker=self._lease_broker,
            physical_device_lease=self._source_projection.clients[client_id][
                "physicalDeviceLease"
            ],
            build_attestation=self._source_projection.applications[
                client.platform
            ]["buildAttestation"],
            ports=resources["ports"],
            source_gate_id=getattr(
                getattr(self._native_spec, "scenario", None),
                "gate_id",
                MOBILE_OAUTH_PROOF_GATE_ID,
            ),
            auto_accept_alerts=(
                getattr(
                    getattr(self._native_spec, "scenario", None),
                    "id",
                    "access",
                )
                == "platform"
            ),
            chromedriver_executable=(
                str(self._native_inputs["chromedriver"]["executable"])
                if client.platform == "android"
                else ""
            ),
        )

    def _prepare_parent_authorities(
        self,
        *,
        gate_id: str,
        runtime_root: Path,
        credential_values: Mapping[str, str],
        profile_environment: Mapping[str, str],
    ) -> MobileNativeSourceProjection:
        if self._manifest is None or self._native_spec is None:
            raise BlockedError(
                reason="Mobile native source preparation has no manifest",
                resource="mobile-source:manifest",
            )
        self._register_parent_cleanup()
        if self.evidence_run.gate_id != gate_id:
            raise BlockedError(
                reason="Mobile native evidence run does not match the Gate",
                resource=f"mobile-source:evidence-run:{gate_id}",
            )
        self._artifact_session = self.evidence_run
        self._artifact_store = EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        build_refs: dict[str, ArtifactRef] = {}
        for platform_name in EXPECTED_DRIVER_IDENTITIES:
            receipt = orchestrate_source_bound_build(
                root=REPO_ROOT,
                platform=platform_name,
                run_root=runtime_root / "source-builds" / platform_name,
            )
            _, build_refs[platform_name] = produce_build_attestation(
                run=self._artifact_session,
                receipt=receipt,
                created_at=utc_now(),
            )

        self._actor_manifest_ref = self._prepare_actor_manifest(
            profile_environment
        )
        correlation_key = secrets.token_bytes(32)
        self._station_fixture = MobileOAuthStationFixture.from_environment(
            run_handle=self._artifact_session,
            correlation_key=correlation_key,
        )
        self._station_fixture.bootstrap()
        for service_id in MOBILE_OAUTH_FIXTURE_SERVICES:
            self._fixture_heartbeat_leases.append(
                self._station_fixture.acquire(service_id)
            )

        provider_subjects, browser_baselines = self._credential_authorities(
            credential_values
        )
        self._provider_subjects = dict(provider_subjects)
        self._credential_values_by_provider = {
            provider: credential_values[f"{provider}-disposable-account"]
            for provider in PROVIDER_CLIENTS
        }
        physical_devices = self._native_inputs.get("physicalDevices")
        if not isinstance(physical_devices, Mapping):
            raise BlockedError(
                reason="Mobile native physical-device authority is unavailable",
                resource="mobile-source:physical-devices",
            )
        lease_authentication_key = self._native_inputs.pop(
            "leaseAuthenticationKey",
            None,
        )
        if not isinstance(lease_authentication_key, bytearray):
            raise BlockedError(
                reason="Mobile resource lease authentication key is unavailable",
                resource="mobile-runtime:resource-lease-authentication",
            )
        try:
            self._lease_broker = MobileResourceLeaseBroker(
                run_handle=self._artifact_session,
                correlation_secret=RunScopedCorrelationSecret(correlation_key),
                physical_identity_key=lease_authentication_key,
                artifact_writer_resolver=self._resolve_artifact_writer,
                physical_device_resolver=lambda client_id: physical_devices[client_id],
                provider_expected_subjects=provider_subjects,
                artifact_workspace_id=self._artifact_store.workspace_id,
            )
        finally:
            for index in range(len(lease_authentication_key)):
                lease_authentication_key[index] = 0

        for client_id in EXPECTED_CLIENTS:
            lease = self._lease_broker.acquire_physical_device(client_id)
            self._device_leases[client_id] = lease
            self._resource_leases.append(lease)
            self._restore_callbacks[str(lease["resourceKey"])] = (
                lambda deadline, cancellation, lease=lease: self._restore_device(
                    lease,
                    deadline_monotonic=deadline,
                    cancellation=cancellation,
                )
            )
        for provider in PROVIDER_CLIENTS:
            lease = self._lease_broker.acquire_provider_account(provider)
            self._lease_broker.provider_identity_assertion(
                lease,
                observed_subject=provider_subjects[provider],
            )
            self._account_leases[provider] = lease
            self._resource_leases.append(lease)
            self._restore_callbacks[str(lease["resourceKey"])] = (
                lambda deadline, cancellation, provider=provider, lease=lease: self._restore_account(
                    provider,
                    lease,
                    provider_subjects[provider],
                    deadline_monotonic=deadline,
                    cancellation=cancellation,
                )
            )
        for client_id in EXPECTED_CLIENTS:
            provider = CLIENT_PROVIDER[client_id]
            self._browser_leases[client_id] = (
                self._lease_broker.acquire_browser_session(
                    client_id,
                    physical_device_lease=self._device_leases[client_id],
                    provider_account_lease=self._account_leases[provider],
                    verify_baseline=lambda _device, _account, client_id=client_id: (
                        browser_baselines[client_id]
                    ),
                )
            )
            lease = self._browser_leases[client_id]
            self._resource_leases.append(lease)
            baseline = browser_baselines[client_id]
            self._restore_callbacks[
                str(lease["resourceKey"])
            ] = lambda deadline, cancellation, baseline=baseline: (
                _require_cleanup_budget(deadline, cancellation)
                or BaselineRestoreResult(
                    cleanup_completed=True,
                    baseline_restored=(
                        baseline.mobile_oauth_state_absent
                        and baseline.station_run_state_absent
                    ),
                    identity_reverified=baseline.expected_identity_matched,
                )
            )

        self._heartbeat_owner = MobileResourceLeaseHeartbeatOwner(
            self._lease_broker,
            interval_seconds=300,
        )
        for lease in self._resource_leases:
            self._heartbeat_owner.register(lease)
        for service_id, lease in zip(
            MOBILE_OAUTH_FIXTURE_SERVICES,
            self._fixture_heartbeat_leases,
        ):
            self._heartbeat_owner.register_external(
                lease,
                lambda service_id=service_id: self._station_fixture.heartbeat(
                    service_id
                ),
            )
        self._heartbeat_owner.start()

        fixture_refs = self._station_fixture.lease_refs
        artifacts = MobileNativeSourceArtifactRefs(
            build_attestations=build_refs,
            provider_account_leases={
                provider: self._lease_broker.acquisition_reference(lease)
                for provider, lease in self._account_leases.items()
            },
            physical_device_leases={
                client_id: self._lease_broker.acquisition_reference(lease)
                for client_id, lease in self._device_leases.items()
            },
            browser_session_leases={
                client_id: self._lease_broker.acquisition_reference(lease)
                for client_id, lease in self._browser_leases.items()
            },
        )
        projection = build_mobile_native_source_projection(
            artifacts,
            reader=self._artifact_store,
            expected_workspace_id=self._artifact_store.workspace_id,
            expected_run_id=self._artifact_session.run_id,
        )
        self._fixture_refs = {
            service_id: fixture_refs[service_id]
            for service_id in MOBILE_OAUTH_FIXTURE_SERVICES
        }
        self._source_projection = projection
        return projection

    def _prepare_scenario_parent_authorities(
        self,
        *,
        gate_id: str,
        runtime_root: Path,
    ) -> MobileNativeScenarioSourceProjection:
        if self._manifest is None or self._native_spec is None:
            raise BlockedError(
                reason="Mobile native scenario preparation has no manifest",
                resource="mobile-source:manifest",
            )
        self._register_parent_cleanup()
        if self.evidence_run.gate_id != gate_id:
            raise BlockedError(
                reason="Mobile native evidence run does not match the Gate",
                resource=f"mobile-source:evidence-run:{gate_id}",
            )
        physical_devices = self._native_inputs.get("physicalDevices")
        if not isinstance(physical_devices, Mapping):
            raise BlockedError(
                reason="Mobile native physical-device authority is unavailable",
                resource="mobile-source:physical-devices",
            )
        self._physical_devices = {
            client.id: physical_devices[client.id]
            for client in self._native_spec.clients
        }
        self._artifact_session = self.evidence_run
        self._artifact_store = EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        build_refs: dict[str, ArtifactRef] = {}
        for platform_name in sorted(
            {client.platform for client in self._native_spec.clients}
        ):
            receipt = orchestrate_source_bound_build(
                root=REPO_ROOT,
                platform=platform_name,
                run_root=runtime_root / "source-builds" / platform_name,
            )
            _, build_refs[platform_name] = (
                produce_scenario_build_attestation(
                    run=self._artifact_session,
                    receipt=receipt,
                    created_at=utc_now(),
                )
            )
        lease_authentication_key = self._native_inputs.pop(
            "leaseAuthenticationKey",
            None,
        )
        if not isinstance(lease_authentication_key, bytearray):
            raise BlockedError(
                reason="Mobile resource lease authentication key is unavailable",
                resource="mobile-runtime:resource-lease-authentication",
            )
        correlation_key = secrets.token_bytes(32)
        try:
            self._lease_broker = MobileResourceLeaseBroker(
                run_handle=self._artifact_session,
                correlation_secret=RunScopedCorrelationSecret(correlation_key),
                physical_identity_key=lease_authentication_key,
                artifact_writer_resolver=self._resolve_artifact_writer,
                physical_device_resolver=(
                    lambda client_id: self._physical_devices[client_id]
                ),
                artifact_workspace_id=self._artifact_store.workspace_id,
                gate_id=gate_id,
            )
        finally:
            for index in range(len(lease_authentication_key)):
                lease_authentication_key[index] = 0

        for client in self._native_spec.clients:
            lease = self._lease_broker.acquire_physical_device(client.id)
            self._device_leases[client.id] = lease
            self._resource_leases.append(lease)
            self._restore_callbacks[str(lease["resourceKey"])] = (
                lambda deadline, cancellation, lease=lease: self._restore_device(
                    lease,
                    deadline_monotonic=deadline,
                    cancellation=cancellation,
                )
            )
        self._heartbeat_owner = MobileResourceLeaseHeartbeatOwner(
            self._lease_broker,
            interval_seconds=300,
        )
        for lease in self._resource_leases:
            self._heartbeat_owner.register(lease)
        self._heartbeat_owner.start()
        projection = MobileNativeScenarioSourceProjection(
            applications={
                platform: {"buildAttestation": reference}
                for platform, reference in build_refs.items()
            },
            clients={
                client.id: {
                    "physicalDeviceLease": (
                        self._lease_broker.acquisition_reference(
                            self._device_leases[client.id]
                        )
                    ),
                }
                for client in self._native_spec.clients
            },
        )
        self._source_projection = projection
        return projection

    def _prepare_actor_manifest(
        self,
        profile_environment: Mapping[str, str],
    ) -> dict[str, Any]:
        if os.environ.get("MOBILE_ACCEPTANCE_RESET") != "1":
            raise BlockedError(
                reason=(
                    "Mobile native actor reset requires "
                    "MOBILE_ACCEPTANCE_RESET=1"
                ),
                resource="fixture-authorization:MOBILE_ACCEPTANCE_RESET",
            )
        if self._artifact_session is None or self._native_spec is None:
            raise BlockedError(
                reason="Mobile native actor Fixture has no artifact authority",
                resource="fixture-artifact-authority",
            )

        stations: dict[str, dict[str, Any]] = {}
        for service_id, (url_name, deploy_name) in SERVICE_CONFIG.items():
            station_url = str(profile_environment.get(url_name) or "")
            deployment_environment = str(
                profile_environment.get(deploy_name) or ""
            )
            if not station_url or not deployment_environment:
                raise BlockedError(
                    reason=(
                        f"Mobile native actor Fixture requires {url_name} "
                        f"and {deploy_name}"
                    ),
                    resource=f"fixture-environment:{service_id}",
                )
            verify_reset_target(station_url, deployment_environment)
            reset_fixture(deployment_environment, ROLES)
            actors = [
                resolve_actor_identity(station_url, role, ACTOR_PASSWORD)
                for role in ROLES
            ]
            stations[service_id] = {
                "actors": [
                    {
                        "role": actor.role,
                        "accountRef": actor.account_ref,
                        "ptid": actor.ptid,
                        "devicePolicy": actor.device_policy,
                    }
                    for actor in actors
                ],
                "targetVerified": True,
            }
            self._service_bindings[service_id] = (
                station_url,
                deployment_environment,
            )

        payload = {
            "artifactKind": "mobile-native-actor-manifest",
            "fixtureId": "mobile-native-actors",
            "environmentId": self.environment_id,
            "runId": self._artifact_session.run_id,
            "createdAt": utc_now(),
            "initialState": "ready",
            "stations": stations,
            "clients": [
                {
                    "id": client.id,
                    "platform": client.platform,
                    "actor": client.actor,
                    "deviceRole": client.device_role,
                    "profile": client.profile,
                    "sessionLease": client.session_lease,
                }
                for client in self._native_spec.clients
            ],
            "reset": {"authorized": True, "targetVerified": True},
            "cleanup": {
                "deterministic": True,
                "action": "reset disposable actors and revoke fixture sessions",
            },
        }
        return self._artifact_session.write_json(
            "runtime/mobile-actor-manifest.json",
            payload,
        ).to_dict()

    def _resolve_artifact_writer(self, reference: ArtifactRef) -> object | None:
        if (
            self._artifact_session is not None
            and reference.run_id == self._artifact_session.run_id
            and reference.gate_id == self._artifact_session.gate_id
        ):
            return self._artifact_session
        return None

    @staticmethod
    def _credential_authorities(
        credential_values: Mapping[str, str],
    ) -> tuple[dict[str, str], dict[str, BrowserBaselineVerificationResult]]:
        subjects: dict[str, str] = {}
        baselines: dict[str, BrowserBaselineVerificationResult] = {}
        for provider, clients in PROVIDER_CLIENTS.items():
            credential_id = f"{provider}-disposable-account"
            raw = credential_values.get(credential_id, "")
            try:
                value = json.loads(raw)
                subject = value["subject"]
                observed = value["browserBaselines"]
                if (
                    value.get("provider") != provider
                    or not isinstance(subject, str)
                    or not subject
                    or not isinstance(observed, Mapping)
                    or set(observed) != set(clients)
                ):
                    raise ValueError("credential authority shape is invalid")
                subjects[provider] = subject
                for client_id in clients:
                    baseline = observed[client_id]
                    if not isinstance(baseline, Mapping):
                        raise ValueError("browser baseline is invalid")
                    result = BrowserBaselineVerificationResult(
                        expected_identity_matched=(
                            baseline.get("expectedIdentityMatched") is True
                        ),
                        authorization_in_progress=(
                            baseline.get("authorizationInProgress") is True
                        ),
                        mobile_oauth_state_absent=(
                            baseline.get("mobileOAuthStateAbsent") is True
                        ),
                        station_run_state_absent=(
                            baseline.get("stationRunStateAbsent") is True
                        ),
                    )
                    if (
                        not result.expected_identity_matched
                        or result.authorization_in_progress
                        or not result.mobile_oauth_state_absent
                        or not result.station_run_state_absent
                    ):
                        raise ValueError("browser baseline is not clean")
                    baselines[client_id] = result
            except (
                KeyError,
                TypeError,
                ValueError,
                json.JSONDecodeError,
            ) as error:
                raise BlockedError(
                    reason=(
                        f"Mobile native {provider} account authority is "
                        "missing an exact subject/browser baseline"
                    ),
                    resource=f"mobile-source:provider-account:{provider}",
                ) from error
        return subjects, baselines

    def _register_parent_cleanup(self) -> None:
        if self._cleanup_registered:
            return
        self.register_cleanup("mobile-native-parent-authorities", self._cleanup_parent)
        self._cleanup_registered = True

    def _zeroize_pending_lease_authentication_key(self) -> bool:
        key = self._native_inputs.pop("leaseAuthenticationKey", None)
        if key is None:
            return True
        if not isinstance(key, bytearray):
            return False
        for index in range(len(key)):
            key[index] = 0
        return not any(key)

    def _require_heartbeat_healthy(self) -> None:
        owner = self._heartbeat_owner
        if owner is None:
            raise BlockedError(
                reason="Mobile native heartbeat owner is unavailable",
                resource="mobile-source:heartbeat-owner",
            )
        try:
            owner.raise_if_failed()
        except BaseException as error:
            quarantine_failures = self._quarantine_parent_authorities(
                "LEASE_HEARTBEAT_OWNER_FAILED"
            )
            detail = (
                f"; quarantine failures: {', '.join(quarantine_failures)}"
                if quarantine_failures
                else ""
            )
            raise BlockedError(
                reason=f"Mobile native heartbeat owner failed{detail}",
                resource="mobile-source:heartbeat-owner",
            ) from error

    def _quarantine_parent_authorities(self, reason: str) -> list[str]:
        deadline = (
            time.monotonic() + MOBILE_NATIVE_PARENT_CLEANUP_TIMEOUT_SECONDS
        )
        cancellation = threading.Event()
        failures: list[str] = []
        broker = self._lease_broker
        if self._appium_handler is not None:
            try:
                if not self._appium_handler._stop_all(
                    deadline_monotonic=deadline,
                    cancellation=cancellation,
                ):
                    failures.append("appium sessions")
            except BaseException as error:
                failures.append(f"appium sessions: {type(error).__name__}")
        if broker is not None:
            failures.extend(
                self._quarantine_leases(
                    broker,
                    self._browser_leases,
                    reason,
                    deadline_monotonic=deadline,
                    cancellation=cancellation,
                )
            )
        if self._station_fixture is not None:
            for service_id in reversed(MOBILE_OAUTH_FIXTURE_SERVICES):
                try:
                    if not _quarantine_fixture_lease(
                        self._station_fixture,
                        service_id,
                        reason,
                        deadline_monotonic=deadline,
                        cancellation=cancellation,
                    ):
                        failures.append(
                            f"station fixture {service_id}: not quarantined"
                        )
                except BaseException as error:
                    failures.append(
                        f"station fixture {service_id}: {type(error).__name__}"
                    )
        if broker is not None:
            failures.extend(
                self._quarantine_leases(
                    broker,
                    self._account_leases,
                    reason,
                    deadline_monotonic=deadline,
                    cancellation=cancellation,
                )
            )
            failures.extend(
                self._quarantine_leases(
                    broker,
                    self._device_leases,
                    reason,
                    deadline_monotonic=deadline,
                    cancellation=cancellation,
                )
            )
        return failures

    @staticmethod
    def _quarantine_leases(
        broker: MobileResourceLeaseBroker,
        leases: Mapping[str, Mapping[str, Any]],
        reason: str,
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> list[str]:
        failures: list[str] = []
        for lease in reversed(tuple(leases.values())):
            resource_key = str(lease.get("resourceKey") or "unknown")
            try:
                if not _quarantine_broker_lease(
                    broker,
                    lease,
                    reason,
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                ):
                    failures.append(f"{resource_key}: not quarantined")
            except BaseException as error:
                failures.append(f"{resource_key}: {type(error).__name__}")
        return failures

    def _restore_account(
        self,
        provider: str,
        lease: Mapping[str, Any],
        expected_subject: str,
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> BaselineRestoreResult:
        assert self._lease_broker is not None
        assertion = self._lease_broker.provider_identity_assertion(
            lease,
            observed_subject=expected_subject,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        return BaselineRestoreResult(
            cleanup_completed=True,
            baseline_restored=True,
            identity_reverified=(
                assertion.get("provider") == provider
                and assertion.get("identityMatched") is True
            ),
        )

    def _restore_device(
        self,
        lease: Mapping[str, Any],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> BaselineRestoreResult:
        assert self._lease_broker is not None
        verified = self._lease_broker.with_physical_device(
            lease,
            lambda handle: (
                handle.connected and handle.physical and not handle.simulator
            ),
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        return BaselineRestoreResult(
            cleanup_completed=True,
            baseline_restored=True,
            identity_reverified=bool(verified),
        )

    def _cleanup_parent(self) -> None:
        deadline = (
            time.monotonic() + MOBILE_NATIVE_PARENT_CLEANUP_TIMEOUT_SECONDS
        )
        cancellation = threading.Event()
        failures: list[str] = []
        if not self._zeroize_pending_lease_authentication_key():
            failures.append("pending lease authentication key")
        heartbeat_failed = False
        if self._heartbeat_owner is not None:
            try:
                self._heartbeat_owner.close()
                self._heartbeat_owner.raise_if_failed()
            except BaseException as error:
                heartbeat_failed = True
                failures.append(f"heartbeat owner: {type(error).__name__}")
        if self._appium_handler is not None:
            try:
                if not self._appium_handler._stop_all(
                    deadline_monotonic=deadline,
                    cancellation=cancellation,
                ):
                    failures.append("appium sessions")
            except BaseException as error:
                failures.append(f"appium sessions: {type(error).__name__}")
        broker = self._lease_broker
        if broker is not None:
            if heartbeat_failed:
                failures.extend(
                    self._quarantine_leases(
                        broker,
                        self._browser_leases,
                        "LEASE_HEARTBEAT_OWNER_FAILED",
                        deadline_monotonic=deadline,
                        cancellation=cancellation,
                    )
                )
            else:
                failures.extend(
                    self._release_leases(
                        broker,
                        self._browser_leases,
                        deadline_monotonic=deadline,
                        cancellation=cancellation,
                    )
                )
        if self._station_fixture is not None:
            try:
                if heartbeat_failed:
                    for service_id in reversed(MOBILE_OAUTH_FIXTURE_SERVICES):
                        if not _quarantine_fixture_lease(
                            self._station_fixture,
                            service_id,
                            "LEASE_HEARTBEAT_OWNER_FAILED",
                            deadline_monotonic=deadline,
                            cancellation=cancellation,
                        ):
                            failures.append(
                                f"station fixture {service_id}: not quarantined"
                            )
                else:
                    for service_id in reversed(tuple(self._service_bindings)):
                        _require_cleanup_budget(deadline, cancellation)
                        station_url, deployment_environment = (
                            self._service_bindings[service_id]
                        )
                        verify_reset_target(
                            station_url,
                            deployment_environment,
                            deadline_monotonic=deadline,
                            cancellation=cancellation,
                        )
                        reset_fixture(
                            deployment_environment,
                            ROLES,
                            deadline_monotonic=deadline,
                            cancellation=cancellation,
                        )
                    self._station_fixture.cleanup(
                        deadline_monotonic=deadline,
                        cancellation=cancellation,
                    )
                    _require_cleanup_budget(deadline, cancellation)
                    _write_fixture_outcomes(self._station_fixture)
            except BaseException as error:
                failures.append(f"station fixture: {type(error).__name__}")
        if broker is not None:
            if heartbeat_failed:
                failures.extend(
                    self._quarantine_leases(
                        broker,
                        self._account_leases,
                        "LEASE_HEARTBEAT_OWNER_FAILED",
                        deadline_monotonic=deadline,
                        cancellation=cancellation,
                    )
                )
                failures.extend(
                    self._quarantine_leases(
                        broker,
                        self._device_leases,
                        "LEASE_HEARTBEAT_OWNER_FAILED",
                        deadline_monotonic=deadline,
                        cancellation=cancellation,
                    )
                )
            else:
                failures.extend(
                    self._release_leases(
                        broker,
                        self._account_leases,
                        deadline_monotonic=deadline,
                        cancellation=cancellation,
                    )
                )
                failures.extend(
                    self._release_leases(
                        broker,
                        self._device_leases,
                        deadline_monotonic=deadline,
                        cancellation=cancellation,
                    )
                )
        if self._heartbeat_owner is not None:
            for lease in reversed(
                (*self._resource_leases, *self._fixture_heartbeat_leases)
            ):
                try:
                    _require_cleanup_budget(deadline, cancellation)
                    self._heartbeat_owner.unregister(lease)
                except BaseException as error:
                    failures.append(
                        "heartbeat unregister "
                        f"{lease.get('resourceKey')}: {type(error).__name__}"
                    )
        if broker is not None:
            try:
                cleanup = broker.close()
                if not all(cleanup.values()):
                    failures.append("resource lease broker")
            except BaseException as error:
                failures.append(
                    f"resource lease broker: {type(error).__name__}"
                )
        for storage_root in reversed(self._storage_roots):
            try:
                _require_cleanup_budget(deadline, cancellation)
                shutil.rmtree(storage_root)
            except FileNotFoundError:
                continue
            except BaseException as error:
                failures.append(
                    f"storage {storage_root.name}: {type(error).__name__}"
                )
        for reservation in reversed(self._port_reservations):
            try:
                _require_cleanup_budget(deadline, cancellation)
                reservation.release()
            except BaseException as error:
                failures.append(f"port reservation: {type(error).__name__}")
        if failures:
            raise ProvisioningError(
                "Mobile native parent cleanup failed: " + "; ".join(failures)
            )

    def _release_leases(
        self,
        broker: MobileResourceLeaseBroker,
        leases: Mapping[str, Mapping[str, Any]],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> list[str]:
        failures: list[str] = []
        for lease in reversed(tuple(leases.values())):
            resource_key = str(lease["resourceKey"])
            restore = self._restore_callbacks.get(resource_key)
            if restore is None:
                broker.quarantine(
                    lease,
                    "LEASE_CLEANUP_FAILED",
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                failures.append(f"{resource_key}: restore callback missing")
                continue
            try:
                broker.release(
                    lease,
                    restore=lambda restore=restore: restore(
                        deadline_monotonic,
                        cancellation,
                    ),
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
            except BaseException as error:
                try:
                    broker.quarantine(
                        lease,
                        "LEASE_CLEANUP_FAILED",
                        deadline_monotonic=deadline_monotonic,
                        cancellation=cancellation,
                    )
                except BaseException as quarantine_error:
                    failures.append(
                        f"{resource_key}: quarantine "
                        f"{type(quarantine_error).__name__}"
                    )
                failures.append(f"{resource_key}: {type(error).__name__}")
        return failures

    def _select_scenario_contract(
        self,
        scenario: MobileNativeScenarioSpec,
    ) -> None:
        services = {
            service_id: self.contract.services[service_id]
            for service_id in scenario.service_ids
        }
        credentials_by_id = {
            credential.id: credential
            for credential in self.contract.credentials
        }
        fixtures_by_id = {
            fixture.id: fixture for fixture in self.contract.fixtures
        }
        self.contract = dataclasses.replace(
            self.contract,
            services=services,
            credentials=tuple(
                credentials_by_id[credential_id]
                for credential_id in scenario.credential_ids
            ),
            fixtures=tuple(
                fixtures_by_id[fixture_id]
                for fixture_id in scenario.fixture_ids
            ),
            cleanup=dataclasses.replace(
                self.contract.cleanup,
                resources=scenario.cleanup_resources,
            ),
        )

    def _provision_device_scenario(
        self,
        gate_id: str,
        native_spec: MobileNativePreflightSpec,
        native_inputs: Mapping[str, Any],
    ) -> RuntimeManifest:
        assert self._manifest is not None
        profile_name, _, slot, _ = self._resolve_active_profile()
        manifest = self._preflighted(
            self._manifest,
            profile_name=profile_name,
            slot=slot,
        )
        owner_prefix = f"acceptance:{gate_id}:{manifest.run_id}"
        self.acquire_profile_lease(profile_name, owner_prefix)
        manifest = dataclasses.replace(
            manifest,
            state=ProvisioningState.PROVISIONED,
            services={},
            credential_refs=(),
            cleanup_resources=native_spec.scenario.cleanup_resources,
        )
        self._manifest = manifest

        runtime_root = (
            Path(str(native_inputs["storageRoot"])).expanduser()
            / manifest.run_id
        )
        client_resources: dict[str, dict[str, Any]] = {}
        for client in native_spec.clients:
            owner = f"{owner_prefix}:{client.id}"
            self.acquire_profile_lease(client.profile, owner)
            self.acquire_profile_lease(client.session_lease, owner)
            reservations = [_PortReservation() for _ in client.port_roles]
            self._port_reservations.extend(reservations)
            storage_root = runtime_root / client.id
            storage_root.mkdir(parents=True, exist_ok=False)
            self._storage_roots.append(storage_root)
            self.acquire_profile_lease(
                f"mobile-native-storage-{client.id}",
                owner,
            )
            client_resources[client.id] = {
                "platform": client.platform,
                "runtime": client.runtime,
                "deviceRole": client.device_role,
                "profile": client.profile,
                "sessionLease": client.session_lease,
                "ports": {
                    role: reservation.port
                    for role, reservation in zip(
                        client.port_roles,
                        reservations,
                        strict=True,
                    )
                },
            }
            for reservation in reservations:
                reservation.release()

        self._client_resources = client_resources
        source_projection = self._prepare_scenario_parent_authorities(
            gate_id=gate_id,
            runtime_root=runtime_root,
        )
        manifest = _with_mobile_resources(
            manifest,
            _mobile_native_scenario_manifest_resources(
                source_projection,
                native_spec,
                client_resources,
                evidence_run_id=self._artifact_session.run_id,
                provisioning_run_id=manifest.run_id,
            ),
        )
        self._manifest = manifest
        return self._ready(manifest)

    def provision(self, gate_id: str) -> RuntimeManifest:
        native_spec = self._native_spec
        selected_gate_id = getattr(
            getattr(native_spec, "scenario", None),
            "gate_id",
            MOBILE_OAUTH_PROOF_GATE_ID,
        )
        if native_spec is None or selected_gate_id != gate_id:
            native_spec = load_mobile_native_preflight_spec(gate_id=gate_id)
            self._select_scenario_contract(native_spec.scenario)
            self._native_spec = native_spec
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if (
                self._manifest.source_commit == "unknown"
                or self._manifest.workspace_digest == "unknown"
            ):
                raise BlockedError(
                    reason="Mobile native source identity is unavailable",
                    resource="mobile-runtime:source-identity",
                )
            native_inputs = preflight_mobile_native_inputs(
                native_spec,
                environment={
                    **os.environ,
                    **getattr(native_spec, "build_environment", {}),
                },
            )
            self._native_spec = native_spec
            self._native_inputs = native_inputs
            self._register_parent_cleanup()
            if (
                getattr(
                    getattr(native_spec, "scenario", None),
                    "id",
                    "access",
                )
                != "access"
            ):
                return self._provision_device_scenario(
                    gate_id,
                    native_spec,
                    native_inputs,
                )
            credential_refs, credential_values = self.prepare_credentials()

            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            self.acquire_profile_lease(
                profile_name,
                f"acceptance:{gate_id}:{manifest.run_id}",
            )

            required_profile_keys = (
                "PT_MOBILE_STATION_PRIMARY_URL",
                "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV",
                "PT_MOBILE_STATION_SECONDARY_URL",
                "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV",
                "PT_RELAY_URL",
                "PT_RELAY_DEPLOY_ENV",
            )
            missing = [
                key for key in required_profile_keys if not profile_env.get(key)
            ]
            if missing:
                raise BlockedError(
                    reason=(
                        "Mobile native profile is missing required service "
                        f"bindings: {', '.join(missing)}"
                    ),
                    resource="profile:mobile-native-services",
                )

            service_specs = {
                "station-primary": (
                    "station",
                    profile_env["PT_MOBILE_STATION_PRIMARY_URL"],
                    profile_env["PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV"],
                    "station-deployment",
                ),
                "station-secondary": (
                    "station",
                    profile_env["PT_MOBILE_STATION_SECONDARY_URL"],
                    profile_env["PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV"],
                    "station-deployment",
                ),
                "relay": (
                    "relay",
                    profile_env["PT_RELAY_URL"],
                    profile_env["PT_RELAY_DEPLOY_ENV"],
                    "relay-deployment",
                ),
            }
            for _, _, deployment_environment, _ in service_specs.values():
                self.acquire_remote_git_source_lease(
                    deployment_environment,
                    f"acceptance:{gate_id}:{manifest.run_id}",
                )

            services = {}
            for service_id, (
                service_kind,
                endpoint,
                deployment_environment,
                producer,
            ) in service_specs.items():
                health_url = (
                    profile_env.get("PT_RELAY_HEALTH_URL", "")
                    if service_kind == "relay"
                    else ""
                )
                if not self._station_ready(endpoint, health_url):
                    raise BlockedError(
                        reason=f"Required Mobile service {service_id!r} is unhealthy",
                        resource=f"service-health:{service_id}",
                    )
                if service_kind == "station":
                    attestation = produce_station_attestation(
                        environment_id=self.environment_id,
                        run_id=manifest.run_id,
                        service_id=service_id,
                        station_url=endpoint,
                        profile_env={
                            "PT_STATION_MODE": "remote",
                            "PT_STATION_DEPLOY_ENV": deployment_environment,
                        },
                        require_runtime_identity=True,
                        remote_source_identity_provider=(
                            resolve_remote_source_identity
                        ),
                    )
                else:
                    attestation = produce_service_attestation(
                        environment_id=self.environment_id,
                        run_id=manifest.run_id,
                        service_id=service_id,
                        service_kind=service_kind,
                        endpoint=endpoint,
                        mode="remote",
                        deployment_environment=deployment_environment,
                        producer=producer,
                        require_runtime_identity=True,
                        remote_source_identity_provider=(
                            resolve_remote_source_identity
                        ),
                    )
                if not attestation.runtime_identity:
                    raise BlockedError(
                        reason=(
                            f"Required Mobile service {service_id!r} does not "
                            "expose a stable runtime identity"
                        ),
                        resource=f"service-identity:{service_id}",
                    )
                services[service_id] = attestation

            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services=services,
                credential_refs=credential_refs,
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest

            runtime_root = (
                Path(native_inputs["storageRoot"]).expanduser()
                / manifest.run_id
            )
            client_resources: dict[str, dict[str, Any]] = {}
            for client in native_spec.clients:
                owner = f"acceptance:{gate_id}:{manifest.run_id}:{client.id}"
                self.acquire_profile_lease(client.profile, owner)
                self.acquire_profile_lease(client.session_lease, owner)
                reservations: list[_PortReservation] = []
                for role in client.port_roles:
                    reservation = _PortReservation()
                    reservations.append(reservation)
                    self._port_reservations.append(reservation)
                storage_root = runtime_root / client.id
                storage_root.mkdir(parents=True, exist_ok=False)
                self._storage_roots.append(storage_root)
                self.acquire_profile_lease(
                    f"mobile-native-storage-{client.id}",
                    owner,
                )
                client_resources[client.id] = {
                    "platform": client.platform,
                    "actor": client.actor,
                    "runtime": client.runtime,
                    "deviceRole": client.device_role,
                    "profile": client.profile,
                    "sessionLease": client.session_lease,
                    "ports": {
                        role: reservation.port
                        for role, reservation in zip(
                            client.port_roles,
                            reservations,
                            strict=True,
                        )
                    },
                }
                for reservation in reservations:
                    reservation.release()

            self._client_resources = client_resources
            source_projection = self._prepare_parent_authorities(
                gate_id=gate_id,
                runtime_root=runtime_root,
                credential_values=credential_values,
                profile_environment=profile_env,
            )
            manifest = dataclasses.replace(
                manifest,
                actor_manifest_ref=self._actor_manifest_ref,
            )
            manifest = _with_mobile_resources(
                manifest,
                _mobile_native_manifest_resources(
                    source_projection,
                    self._fixture_refs,
                    native_spec,
                    evidence_run_id=self._artifact_session.run_id,
                    provisioning_run_id=manifest.run_id,
                ),
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (BlockedError, ProvisioningError, ValueError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Mobile native profile is invalid: {error}",
                    resource="profile:mobile-native",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
        finally:
            if self._lease_broker is None:
                self._zeroize_pending_lease_authentication_key()
