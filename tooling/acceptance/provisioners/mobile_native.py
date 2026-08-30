from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from tooling.acceptance.core._paths import ENVIRONMENTS_DIR, REPO_ROOT
from tooling.acceptance.core.attestation import (
    produce_service_attestation,
    produce_station_attestation,
)
from tooling.acceptance.core.errors import (
    BlockedError,
    EvidenceError,
    ProvisioningError,
)
from tooling.acceptance.core.evidence_store import ArtifactRef
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
)
from tooling.acceptance.core.redaction import redact_value
from tooling.acceptance.fixtures.mobile_native_reset import (
    cleanup_fixture,
    prepare_fixture,
)
from tooling.acceptance.fixtures.mobile_resource_lease import (
    CLIENT_PLATFORM,
    CLIENT_PROVIDER,
    PROVIDER_CLIENTS,
)
from tooling.acceptance.gates.mobile.proof_contracts import (
    GATE_ID as MOBILE_OAUTH_PROOF_GATE_ID,
    ProofContractError,
    validate_contract_payload,
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
    clean_start: str
    readback: str
    cleanup: str


@dataclass(frozen=True)
class NativeClientSpec:
    id: str
    platform: str
    actor: str
    runtime: str
    destination_ref: str
    device_ref: str
    device_role: str
    profile: str
    port_roles: tuple[str, ...]
    storage_root: str
    session_lease: str
    browser_session: BrowserSessionSpec


@dataclass(frozen=True)
class MobileNativePreflightSpec:
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
    artifact_refs: dict[str, str]
    application_ids: dict[str, str]
    callback_schemes: dict[str, str]
    build_environment: dict[str, str]
    clients: tuple[NativeClientSpec, ...]
    harness_namespace: str
    harness_actions: tuple[str, ...]
    storage_root_ref: str


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
) -> dict[str, Any]:
    if (
        reference.artifact_kind != "acceptance-artifact-ref"
        or reference.workspace_id != expected_workspace_id
        or reference.gate_id != MOBILE_OAUTH_PROOF_GATE_ID
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
            expected_gate_id=MOBILE_OAUTH_PROOF_GATE_ID,
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


def load_mobile_native_preflight_spec(
    path: Path = ENVIRONMENTS_DIR / "mobile-native.yaml",
) -> MobileNativePreflightSpec:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BlockedError(
            reason=f"Cannot load Mobile native environment contract: {error}",
            resource="mobile-contract:environment",
        ) from error

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
    artifacts = _required_object(build, "artifacts", "mobile-contract:artifacts")
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
    clients = tuple(
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
            destination_ref=_required_text(
                client,
                "destination_ref",
                "mobile-contract:client",
            )
            if isinstance(client, dict)
            else "",
            device_ref=_required_text(
                client,
                "device_ref",
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
                clean_start=_required_text(
                    _required_object(
                        client,
                        "browser_session",
                        "mobile-contract:browser-session",
                    ),
                    "clean_start",
                    "mobile-contract:browser-session",
                ),
                readback=_required_text(
                    _required_object(
                        client,
                        "browser_session",
                        "mobile-contract:browser-session",
                    ),
                    "readback",
                    "mobile-contract:browser-session",
                ),
                cleanup=_required_text(
                    _required_object(
                        client,
                        "browser_session",
                        "mobile-contract:browser-session",
                    ),
                    "cleanup",
                    "mobile-contract:browser-session",
                ),
            )
            if isinstance(client, dict)
            else BrowserSessionSpec("", "", "", "", "", ""),
        )
        for client in raw_clients
    )
    actual_clients = {
        client.id: (client.platform, client.actor) for client in clients
    }
    if actual_clients != EXPECTED_CLIENTS or len(clients) != 4:
        raise BlockedError(
            reason=(
                "Mobile native contract requires isolated alice/bob clients "
                "for both iOS and Android"
            ),
            resource="mobile-contract:clients",
        )
    if len({client.profile for client in clients}) != 4:
        raise BlockedError(
            reason="Mobile native client profiles must be unique",
            resource="mobile-contract:client-profiles",
        )
    if len({client.device_ref for client in clients}) != 4:
        raise BlockedError(
            reason="Mobile native client device references must be unique",
            resource="mobile-contract:client-devices",
        )
    if any(len(client.port_roles) != 3 for client in clients):
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
    for client in clients:
        browser = client.browser_session
        if (
            browser.owner != client.id
            or (browser.provider, browser.credential_ref)
            != expected_browser_sessions[client.id]
            or {browser.clean_start, browser.readback, browser.cleanup}
            != {"required"}
        ):
            raise BlockedError(
                reason=(
                    f"Mobile native client {client.id!r} requires owned "
                    "clean-start/readback/cleanup browser session semantics"
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
    leases = _required_object(payload, "leases", "mobile-contract:leases")
    return MobileNativePreflightSpec(
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
        artifact_refs={
            platform: _required_text(
                artifacts,
                platform,
                f"mobile-contract:artifact:{platform}",
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
        harness_actions=tuple(actions),
        storage_root_ref=_required_text(
            leases,
            "storage_root_ref",
            "mobile-contract:storage",
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
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (
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

    build_artifacts: dict[str, str] = {}
    for platform, reference in spec.artifact_refs.items():
        _, artifact = _required_env_ref(
            reference,
            f"mobile-runtime:{platform}-build",
        )
        if not Path(artifact).is_file():
            raise BlockedError(
                reason=f"Mobile native {platform} build artifact is missing",
                resource=f"mobile-runtime:{platform}-build",
            )
        build_artifacts[platform] = artifact

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
    client_inputs: dict[str, dict[str, str]] = {}
    for client in spec.clients:
        destination_variable, destination = _required_env_ref(
            client.destination_ref,
            f"mobile-runtime:destination:{client.id}",
        )
        device_variable, device = _required_env_ref(
            client.device_ref,
            f"mobile-runtime:device:{client.id}",
        )
        client_inputs[client.id] = {
            "destinationVariable": destination_variable,
            "destination": destination,
            "deviceVariable": device_variable,
            "device": device,
        }
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
    for platform_name, clients in (
        ("ios", ios_clients),
        ("android", android_clients),
    ):
        devices = [client_inputs[client.id]["device"] for client in clients]
        if len(set(devices)) != 2:
            raise BlockedError(
                reason=(
                    f"Mobile native {platform_name} clients require two "
                    "distinct physical devices"
                ),
                resource=f"mobile-runtime:{platform_name}-device-isolation",
            )

    ios_inventory = _run_checked(
        executor,
        spec.ios_device_inventory_command,
        repo_root=repo_root,
        environment=command_environment,
        resource="mobile-runtime:ios-device-inventory",
    )
    connected_ios = _connected_ios_devices(ios_inventory.stdout)
    for client in ios_clients:
        device = client_inputs[client.id]["device"]
        destination = client_inputs[client.id]["destination"].lower()
        if device not in connected_ios or "simulator" in destination:
            raise BlockedError(
                reason=(
                    f"iOS client {client.id!r} is not a connected physical "
                    "device"
                ),
                resource=f"mobile-runtime:physical-device:{client.id}",
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
    android_abis: set[str] = set()
    browser_details: dict[str, dict[str, Any]] = {}
    browser_majors: set[int] = set()
    for client in android_clients:
        device = client_inputs[client.id]["device"]
        destination = client_inputs[client.id]["destination"].lower()
        if (
            device not in connected_android
            or device.startswith("emulator-")
            or "emulator" in destination
            or "avd" in destination
        ):
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
    required_actions = set(spec.harness_actions)
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
        "buildArtifacts": build_artifacts,
        "clients": client_inputs,
        "storageRoot": storage_root,
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


class MobileNativeProvisioner(EnvironmentProvisioner):
    environment_id = "mobile-native"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

    def provision(self, gate_id: str) -> RuntimeManifest:
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
            native_spec = load_mobile_native_preflight_spec()
            native_inputs = preflight_mobile_native_inputs(native_spec)
            credential_refs = require_mobile_native_credentials(self.contract)

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
            clients: list[ClientRuntime] = []
            client_resources: dict[str, dict[str, Any]] = {}
            for client in native_spec.clients:
                owner = f"acceptance:{gate_id}:{manifest.run_id}:{client.id}"
                self.acquire_profile_lease(client.profile, owner)
                self.acquire_profile_lease(client.session_lease, owner)
                reservations: list[_PortReservation] = []
                for role in client.port_roles:
                    reservation = _PortReservation()
                    reservations.append(reservation)
                    self.register_cleanup(
                        f"port:{client.id}:{role}",
                        reservation.release,
                    )
                storage_root = runtime_root / client.id
                storage_root.mkdir(parents=True, exist_ok=False)
                self.acquire_profile_lease(
                    f"mobile-native-storage-{client.id}",
                    owner,
                )
                self.register_cleanup(
                    f"storage:{client.id}",
                    lambda path=storage_root: shutil.rmtree(path),
                )
                clients.append(
                    ClientRuntime(
                        actor=client.actor,
                        runtime=client.runtime,
                        worktree=str(REPO_ROOT),
                        gateway_port=reservations[0].port,
                        renderer_port=reservations[1].port,
                        webdriver_port=reservations[2].port,
                        profile=client.profile,
                        storage_root=str(storage_root),
                    )
                )
                client_resources[client.id] = {
                    "platform": client.platform,
                    "actor": client.actor,
                    "runtime": client.runtime,
                    "destination": native_inputs["clients"][client.id]["destination"],
                    "device": native_inputs["clients"][client.id]["device"],
                    "deviceRole": client.device_role,
                    "profile": client.profile,
                    "storageRoot": str(storage_root),
                    "sessionLease": client.session_lease,
                    "browserSession": {
                        "owner": client.browser_session.owner,
                        "provider": client.browser_session.provider,
                        "credentialRef": client.browser_session.credential_ref,
                        "cleanStart": client.browser_session.clean_start,
                        "readback": client.browser_session.readback,
                        "cleanup": client.browser_session.cleanup,
                    },
                    "ports": {
                        role: reservation.port
                        for role, reservation in zip(
                            client.port_roles,
                            reservations,
                            strict=True,
                        )
                    },
                }
                if client.platform == "ios":
                    client_resources[client.id]["readiness"] = dict(
                        native_inputs["iosReadiness"]
                    )
                    client_resources[client.id]["appiumCapabilities"] = {
                        "appium:updatedWDABundleId": native_inputs[
                            "iosReadiness"
                        ]["wdaBundleId"],
                        "appium:additionalWebviewBundleIds": [
                            native_inputs["iosReadiness"]["webviewBundleId"]
                        ],
                    }
                else:
                    client_resources[client.id]["browser"] = (
                        native_inputs["androidBrowsers"][client.id]
                    )
                    client_resources[client.id]["appiumCapabilities"] = {
                        "appium:chromedriverExecutable": native_inputs[
                            "chromedriver"
                        ]["executable"],
                        "chromedriverExecutableReference": native_inputs[
                            "chromedriver"
                        ]["executableReference"],
                    }
                for reservation in reservations:
                    reservation.release()

            fixture_ref = prepare_fixture(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                client_specs=native_spec.clients,
            )
            self.register_cleanup("mobile-native-actors", cleanup_fixture)
            manifest = dataclasses.replace(
                manifest,
                actor_manifest_ref=fixture_ref,
                clients=tuple(clients),
            )
            manifest = _with_mobile_resources(
                manifest,
                {
                    "appium": {
                        "serverUrl": native_inputs["appiumUrl"],
                        "serverVersion": native_inputs["appiumVersion"],
                        "expectedServerVersion": native_spec.appium_expected_version,
                        "drivers": {
                            platform: {
                                "identity": native_spec.drivers[platform].identity,
                                "installedName": (
                                    native_spec.drivers[platform].installed_name
                                ),
                                "automationName": (
                                    native_spec.drivers[platform].automation_name
                                ),
                                "version": native_inputs["driverVersions"][platform],
                                "expectedVersion": (
                                    native_spec.drivers[platform].expected_version
                                ),
                            }
                            for platform in EXPECTED_DRIVER_IDENTITIES
                        },
                    },
                    "chromedriver": native_inputs["chromedriver"],
                    "applications": {
                        platform: {
                            "artifact": native_inputs["buildArtifacts"][platform],
                            "id": native_spec.application_ids[platform],
                            "callbackScheme": native_spec.callback_schemes[platform],
                        }
                        for platform in EXPECTED_DRIVER_IDENTITIES
                    },
                    "clients": client_resources,
                    "harness": {
                        "namespace": native_spec.harness_namespace,
                        "requiredActions": list(native_spec.harness_actions),
                    },
                    "credentialRefs": {
                        credential.id: credential.source_ref
                        for credential in self.contract.credentials
                    },
                },
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
