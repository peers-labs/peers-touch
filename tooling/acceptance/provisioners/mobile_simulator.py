from __future__ import annotations

import dataclasses
import glob
import hashlib
import json
import os
import platform
import re
import signal
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Any, Protocol, TextIO

from tooling.acceptance.core import (
    BlockedError,
    ClientBindingError,
    ClientRuntimeIdentity,
    ClientRuntime,
    EnvironmentContract,
    EnvironmentProvisioner,
    EphemeralCapabilityBlocked,
    EphemeralCapabilityHandler,
    EphemeralGateLaunchContext,
    EphemeralHandlerCleanup,
    ProvisioningError,
    ProvisioningState,
    RuntimeManifest,
    require_runtime_client_service,
    verify_client_binding_observation,
)
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR, REPO_ROOT
from tooling.acceptance.core.attestation import (
    produce_service_attestation,
    produce_station_attestation,
)
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.core.redaction import (
    is_sensitive_key,
    redact_text,
    redact_value,
)
from tooling.acceptance.fixtures.chat_native_actors import (
    ACTOR_ACCOUNTS,
    ACTOR_PASSWORD,
    reset_fixture,
    resolve_actor_identity,
    verify_reset_target,
)
from tooling.acceptance.fixtures.chat_native_reset import (
    fixture_federation_id_from_station_ids,
)

from .remote_source_identity import resolve_remote_source_identity


IOS_RUNTIME = "iOS 17.4"
IOS_DEVICE_NAME = "iPhone 15 Pro"
IOS_LAYOUT_ENVIRONMENT_ID = "mobile-ios-layout-simulator"
STATION_LIFECYCLE_ENVIRONMENT_ID = "mobile-station-lifecycle-simulator"
STATION_LIFECYCLE_GATE_ID = "mobile-simulator-station-lifecycle-e2e"
SIMULATOR_APPIUM_CAPABILITY_ID = "mobile.simulator.appium-session"
SIMULATOR_BINDING_PROOF_MECHANISM = (
    "mobile-simulator-active-station-peer-id"
)
STATION_LIFECYCLE_SERVICES = (
    "station-primary",
    "station-secondary",
)
MOBILE_SOCIAL_STATION_PROFILE_KEYS = {
    "station-primary": (
        "PT_MOBILE_STATION_PRIMARY_URL",
        "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV",
    ),
    "station-secondary": (
        "PT_MOBILE_STATION_SECONDARY_URL",
        "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV",
    ),
}
MOBILE_SOCIAL_SERVICE_PROFILE_KEYS = {
    "relay": (
        "PT_RELAY_URL",
        "PT_RELAY_DEPLOY_ENV",
    ),
}
PROFILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
IOS_LAYOUT_CLIENTS = {
    "sim-ios-compact": (
        "iPhone SE (3rd generation)",
        "compact",
    ),
    "sim-ios-large": (
        "iPhone 15 Pro Max",
        "large",
    ),
}
ANDROID_AVD_NAME = "peers_touch_applet_l3_e2e"
ANDROID_ABI = "arm64-v8a"
ANDROID_BROWSER_PACKAGES = (
    "com.android.chrome",
    "com.google.android.webview",
)
ANDROID_MANIFEST_RELATIVE_PATH = Path(
    "apps/mobile/src-tauri/gen/android/app/src/main/AndroidManifest.xml"
)
ANDROID_DEEP_LINK_MARKER = (
    "<!-- DEEP LINK PLUGIN. AUTO-GENERATED. DO NOT REMOVE. -->"
)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
VERSION_PATTERN = re.compile(r"(?<!\d)(\d+)(?:\.\d+){1,3}(?!\d)")
EXPECTED_CLIENTS = {
    "sim-ios": ("ios", "simulator", "tauri-ios-simulator"),
    "sim-android": ("android", "emulator", "tauri-android-emulator"),
}
EXPECTED_DRIVERS = {
    "ios": ("appium-xcuitest-driver", "xcuitest", "XCUITest"),
    "android": (
        "appium-uiautomator2-driver",
        "uiautomator2",
        "UiAutomator2",
    ),
}
BASE_SIMULATOR_HARNESS_ACTIONS = {
    "lifecycle.snapshot",
    "lifecycle.suspend",
    "lifecycle.resume",
    "lifecycle.restart",
    "native.deliverDeepLink",
    "projection.read",
    "cleanup",
}
STATION_LIFECYCLE_HARNESS_ACTIONS = BASE_SIMULATOR_HARNESS_ACTIONS | {
    "station.add",
    "station.select",
    "access.submit",
    "lifecycle.scope.read",
    "session.logout",
}


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


class ManagedProcess(Protocol):
    def poll(self) -> int | None:
        ...

    def stop(self) -> None:
        ...


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

    def start(
        self,
        command: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str],
        log_path: Path,
    ) -> ManagedProcess:
        ...


def _resolve_command(
    command: Sequence[str],
    env: Mapping[str, str],
) -> list[str]:
    resolved = list(command)
    if not resolved or shutil.which(resolved[0], path=env.get("PATH")):
        return resolved

    android_tool_paths = {
        "adb": Path("platform-tools") / "adb",
        "emulator": Path("emulator") / "emulator",
    }
    relative_path = android_tool_paths.get(resolved[0])
    if relative_path is None:
        return resolved

    sdk_root = env.get("ANDROID_HOME") or env.get("ANDROID_SDK_ROOT")
    if not sdk_root:
        return resolved
    executable = Path(sdk_root) / relative_path
    if executable.is_file() and os.access(executable, os.X_OK):
        resolved[0] = str(executable)
    return resolved


def _is_valid_android_ndk(path: Path) -> bool:
    try:
        prebuilt_root = path / "toolchains" / "llvm" / "prebuilt"
        return (
            path.is_dir()
            and (path / "source.properties").is_file()
            and prebuilt_root.is_dir()
            and any(child.is_dir() for child in prebuilt_root.iterdir())
        )
    except OSError:
        return False


def _resolve_android_ndk_home(env: Mapping[str, str]) -> str:
    explicit = env.get("NDK_HOME", "").strip()
    if explicit:
        try:
            ndk_home = Path(explicit).expanduser().resolve(strict=True)
        except OSError as error:
            raise BlockedError(
                reason="Configured NDK_HOME does not resolve to an installed NDK",
                resource="mobile-simulator:android-ndk-home",
            ) from error
        if not _is_valid_android_ndk(ndk_home):
            raise BlockedError(
                reason="Configured NDK_HOME is not a valid Android NDK",
                resource="mobile-simulator:android-ndk-home",
            )
        return str(ndk_home)

    sdk_root_value = (
        env.get("ANDROID_HOME", "").strip()
        or env.get("ANDROID_SDK_ROOT", "").strip()
    )
    if not sdk_root_value:
        raise BlockedError(
            reason=(
                "Android NDK discovery requires NDK_HOME, ANDROID_HOME, or "
                "ANDROID_SDK_ROOT"
            ),
            resource="mobile-simulator:android-ndk-discovery",
        )

    ndk_root = Path(sdk_root_value).expanduser() / "ndk"
    try:
        candidates = sorted(
            {
                child.resolve(strict=True)
                for child in ndk_root.iterdir()
                if _is_valid_android_ndk(child)
            },
            key=lambda path: path.as_posix(),
        )
    except OSError as error:
        raise BlockedError(
            reason="Configured Android SDK contains no readable NDK directory",
            resource="mobile-simulator:android-ndk-discovery",
        ) from error

    if not candidates:
        raise BlockedError(
            reason="Configured Android SDK contains no valid NDK installation",
            resource="mobile-simulator:android-ndk-discovery",
        )
    if len(candidates) != 1:
        raise BlockedError(
            reason=(
                "Configured Android SDK contains multiple valid NDK "
                "installations; set NDK_HOME explicitly"
            ),
            resource="mobile-simulator:android-ndk-discovery",
        )
    return str(candidates[0])


def _resolve_android_ndk_tool(ndk_home: str, tool_name: str) -> str:
    prebuilt_root = Path(ndk_home) / "toolchains" / "llvm" / "prebuilt"
    try:
        candidates = sorted(
            {
                candidate.absolute()
                for candidate in prebuilt_root.glob(f"*/bin/{tool_name}")
                if candidate.is_file() and os.access(candidate, os.X_OK)
            },
            key=lambda path: path.as_posix(),
        )
    except OSError as error:
        raise BlockedError(
            reason=f"Android NDK tool {tool_name!r} is unreadable",
            resource=f"mobile-simulator:android-ndk-tool:{tool_name}",
        ) from error
    if len(candidates) != 1:
        raise BlockedError(
            reason=(
                f"Android NDK must contain exactly one executable "
                f"{tool_name!r}, found {len(candidates)}"
            ),
            resource=f"mobile-simulator:android-ndk-tool:{tool_name}",
        )
    return str(candidates[0])


def _normalize_android_manifest_generator_whitespace(content: bytes) -> bytes:
    try:
        lines = content.decode("utf-8").splitlines(keepends=True)
    except UnicodeDecodeError:
        return content

    normalized: list[str] = []
    inside_deep_link_block = False
    marker_count = 0
    for line in lines:
        if ANDROID_DEEP_LINK_MARKER in line:
            marker_count += 1
            inside_deep_link_block = not inside_deep_link_block
            normalized.append(line)
            continue
        if inside_deep_link_block and not line.strip():
            continue
        normalized.append(line)

    if marker_count == 0 or marker_count % 2 != 0:
        return content
    return "".join(normalized).encode("utf-8")


class _GeneratedAndroidManifestGuard:
    def __init__(self, path: Path) -> None:
        self.path = path
        try:
            self.baseline = path.read_bytes()
        except OSError as error:
            raise BlockedError(
                reason="Android build manifest is unavailable",
                resource="mobile-simulator:android-manifest",
            ) from error
        if (
            _normalize_android_manifest_generator_whitespace(self.baseline)
            != self.baseline
        ):
            raise BlockedError(
                reason=(
                    "Android build manifest contains generated whitespace "
                    "drift before the build"
                ),
                resource="mobile-simulator:android-manifest",
            )

    def restore(self) -> None:
        try:
            current = self.path.read_bytes()
        except OSError as error:
            raise ProvisioningError(
                "Android build manifest is unavailable during restoration"
            ) from error
        if current == self.baseline:
            return
        if (
            _normalize_android_manifest_generator_whitespace(current)
            != self.baseline
        ):
            raise ProvisioningError(
                "Android build changed the manifest beyond generated whitespace"
            )

        temporary_path = self.path.with_name(
            f".{self.path.name}.{os.getpid()}.restore"
        )
        try:
            temporary_path.write_bytes(self.baseline)
            temporary_path.chmod(self.path.stat().st_mode)
            os.replace(temporary_path, self.path)
        except OSError as error:
            raise ProvisioningError(
                "Android build manifest restoration failed"
            ) from error
        finally:
            temporary_path.unlink(missing_ok=True)


class _SubprocessHandle:
    def __init__(
        self,
        process: subprocess.Popen[str],
        output: TextIO,
    ) -> None:
        self._process = process
        self._output = output

    def poll(self) -> int | None:
        return self._process.poll()

    def stop(self) -> None:
        descendants = self._descendant_pids()
        try:
            if self._process.poll() is None:
                os.killpg(self._process.pid, signal.SIGTERM)
                for pid in reversed(descendants):
                    self._signal_process(pid, signal.SIGTERM)
                try:
                    self._process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(self._process.pid, signal.SIGKILL)
                    self._process.wait(timeout=10)
            for pid in reversed(descendants):
                self._signal_process(pid, signal.SIGKILL)
        finally:
            self._output.close()

    def _descendant_pids(self) -> list[int]:
        completed = subprocess.run(
            ["ps", "-axo", "pid=,ppid="],
            capture_output=True,
            text=True,
            check=False,
        )
        children: dict[int, list[int]] = {}
        for line in completed.stdout.splitlines():
            fields = line.split()
            if len(fields) != 2:
                continue
            try:
                pid, parent_pid = (int(field) for field in fields)
            except ValueError:
                continue
            children.setdefault(parent_pid, []).append(pid)

        descendants: list[int] = []
        pending = list(children.get(self._process.pid, ()))
        while pending:
            pid = pending.pop()
            descendants.append(pid)
            pending.extend(children.get(pid, ()))
        return descendants

    @staticmethod
    def _signal_process(pid: int, process_signal: signal.Signals) -> None:
        try:
            os.kill(pid, process_signal)
        except ProcessLookupError:
            return


class SubprocessExecutor:
    def run(
        self,
        command: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str],
        timeout: float,
    ) -> CommandResult:
        resolved_command = _resolve_command(command, env)
        try:
            completed = subprocess.run(
                resolved_command,
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
                    "Mobile simulator command could not complete: "
                    f"{command[0]}: {type(error).__name__}"
                ),
                resource=f"mobile-simulator:command:{command[0]}",
            ) from error
        return CommandResult(
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )

    def start(
        self,
        command: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str],
        log_path: Path,
    ) -> ManagedProcess:
        resolved_command = _resolve_command(command, env)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        output = log_path.open("w", encoding="utf-8")
        try:
            process = subprocess.Popen(
                resolved_command,
                cwd=cwd,
                env=dict(env),
                stdout=output,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
        except OSError as error:
            output.close()
            raise BlockedError(
                reason=(
                    "Mobile simulator process could not start: "
                    f"{command[0]}: {type(error).__name__}"
                ),
                resource=f"mobile-simulator:process:{command[0]}",
            ) from error
        return _SubprocessHandle(process, output)


class _PortReservation:
    def __init__(self, port: int = 0) -> None:
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._socket.bind(("127.0.0.1", port))
        self.port = int(self._socket.getsockname()[1])
        self._released = False

    def release(self) -> None:
        if self._released:
            return
        self._socket.close()
        self._released = True


@dataclass(frozen=True)
class SimulatorClientSpec:
    id: str
    platform: str
    role: str
    runtime: str
    port_roles: tuple[str, ...]
    storage_root: str


@dataclass(frozen=True)
class IOSLayoutClientSpec:
    id: str
    device_name: str
    viewport_role: str
    port_roles: tuple[str, ...]
    storage_root: str


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
    artifact_kind: str
    executable_member: str
    executable_target: str


@dataclass(frozen=True)
class ChromedriverSpec:
    browser_packages: tuple[str, ...]
    cache_root: str
    acquisition_enabled: bool
    acquisition_mode: str
    artifacts: tuple[ChromedriverArtifactSpec, ...]


@dataclass(frozen=True)
class MobileSimulatorSpec:
    ios_runtime: str
    ios_device_name: str
    android_avd_name: str
    android_abi: str
    build_environment: dict[str, str]
    build_commands: dict[str, tuple[str, ...]]
    artifact_patterns: dict[str, str]
    application_ids: dict[str, str]
    callback_schemes: dict[str, str]
    appium_ownership: str
    appium_executable: str
    appium_expected_version: str
    appium_host: str
    appium_status_path: str
    appium_startup_timeout_seconds: float
    appium_external_url_ref: str
    drivers: dict[str, AppiumDriverSpec]
    chromedriver: ChromedriverSpec
    clients: tuple[SimulatorClientSpec, ...]
    harness_namespace: str
    harness_actions: tuple[str, ...]
    proof_scope: dict[str, tuple[str, ...]]


@dataclass(frozen=True)
class MobileIOSLayoutSimulatorSpec:
    base: MobileSimulatorSpec
    clients: tuple[IOSLayoutClientSpec, ...]
    harness_actions: tuple[str, ...]
    proof_scope: dict[str, tuple[str, ...]]


@dataclass(frozen=True)
class MobileStationLifecycleSimulatorSpec:
    base: MobileSimulatorSpec
    harness_actions: tuple[str, ...]
    proof_scope: dict[str, tuple[str, ...]]


@dataclass(frozen=True)
class MobileSimulatorRuntimeManifest(RuntimeManifest):
    simulator_resources: dict[str, Any] = dataclasses.field(
        default_factory=dict
    )

    def to_dict(self) -> dict[str, Any]:
        payload = super().to_dict()
        payload["mobileSimulator"] = redact_value(self.simulator_resources)
        return payload


def _required_object(
    owner: Mapping[str, Any],
    name: str,
    resource: str,
) -> dict[str, Any]:
    value = owner.get(name)
    if not isinstance(value, dict):
        raise BlockedError(
            reason=f"Mobile simulator contract requires object {name!r}",
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
            reason=f"Mobile simulator contract requires list {name!r}",
            resource=resource,
        )
    return value


def _required_text(
    owner: Mapping[str, Any],
    name: str,
    resource: str,
) -> str:
    value = owner.get(name)
    if not isinstance(value, str) or not value.strip():
        raise BlockedError(
            reason=f"Mobile simulator contract requires {name!r}",
            resource=resource,
        )
    return value.strip()


def _command(
    owner: Mapping[str, Any],
    name: str,
) -> tuple[str, ...]:
    raw_command = _required_list(
        owner,
        name,
        f"mobile-simulator:build-command:{name}",
    )
    if not raw_command or any(
        not isinstance(item, str) or not item for item in raw_command
    ):
        raise BlockedError(
            reason=f"Mobile simulator build command {name!r} is invalid",
            resource=f"mobile-simulator:build-command:{name}",
        )
    return tuple(raw_command)


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


def _load_chromedriver_spec(appium: Mapping[str, Any]) -> ChromedriverSpec:
    raw = _required_object(
        appium,
        "chromedriver",
        "mobile-simulator:chromedriver",
    )
    packages = _required_list(
        raw,
        "browser_packages",
        "mobile-simulator:chromedriver-browser-packages",
    )
    if (
        any(not isinstance(item, str) for item in packages)
        or tuple(packages) != ANDROID_BROWSER_PACKAGES
        or len(set(packages)) != len(packages)
    ):
        raise BlockedError(
            reason=(
                "Mobile simulator Chromedriver browser packages must declare "
                "Chrome and Android System WebView in deterministic order"
            ),
            resource="mobile-simulator:chromedriver-browser-packages",
        )
    cache_root = _required_text(
        raw,
        "cache_root",
        "mobile-simulator:chromedriver-cache-root",
    )
    if cache_root != "<runtime-cache>/chromedriver":
        raise BlockedError(
            reason=(
                "Mobile simulator Chromedriver cache must use the external "
                "<runtime-cache>/chromedriver root"
            ),
            resource="mobile-simulator:chromedriver-cache-root",
        )
    acquisition = _required_object(
        raw,
        "acquisition",
        "mobile-simulator:chromedriver-acquisition",
    )
    enabled = acquisition.get("enabled")
    if not isinstance(enabled, bool):
        raise BlockedError(
            reason="Chromedriver acquisition.enabled must be a boolean",
            resource="mobile-simulator:chromedriver-acquisition",
        )
    mode = _required_text(
        acquisition,
        "mode",
        "mobile-simulator:chromedriver-acquisition",
    )
    if mode != "explicit":
        raise BlockedError(
            reason="Chromedriver acquisition mode must be explicit",
            resource="mobile-simulator:chromedriver-acquisition",
        )

    raw_artifacts = _required_list(
        raw,
        "artifacts",
        "mobile-simulator:chromedriver-artifacts",
    )
    artifacts: list[ChromedriverArtifactSpec] = []
    identities: set[tuple[int, str, str]] = set()
    for raw_artifact in raw_artifacts:
        if not isinstance(raw_artifact, dict):
            raise BlockedError(
                reason="Chromedriver artifact entries must be objects",
                resource="mobile-simulator:chromedriver-artifacts",
            )
        resource = "mobile-simulator:chromedriver-artifact"
        browser_major = raw_artifact.get("browser_major")
        if not isinstance(browser_major, int) or browser_major <= 0:
            raise BlockedError(
                reason="Chromedriver browser_major must be a positive integer",
                resource=resource,
            )
        driver_version = _required_text(
            raw_artifact,
            "driver_version",
            resource,
        )
        _, driver_major = _parse_version(driver_version, resource)
        if driver_major != browser_major:
            raise BlockedError(
                reason=(
                    f"Chromedriver {driver_version!r} does not match declared "
                    f"browser major {browser_major}"
                ),
                resource=resource,
            )
        source = _required_text(raw_artifact, "source", resource)
        if urllib.parse.urlparse(source).scheme != "https":
            raise BlockedError(
                reason="Chromedriver source must use HTTPS",
                resource=resource,
            )
        artifact_platform = _required_text(
            raw_artifact,
            "platform",
            resource,
        )
        artifact_arch = _required_text(raw_artifact, "arch", resource)
        raw_abis = _required_list(raw_artifact, "android_abis", resource)
        if not raw_abis or any(
            not isinstance(abi, str) or not abi for abi in raw_abis
        ):
            raise BlockedError(
                reason="Chromedriver android_abis must contain strings",
                resource=resource,
            )
        sha256 = _required_text(raw_artifact, "sha256", resource).lower()
        if not SHA256_PATTERN.fullmatch(sha256):
            raise BlockedError(
                reason="Chromedriver sha256 must contain 64 lowercase hex characters",
                resource=resource,
            )
        artifact_kind = _required_text(
            raw_artifact,
            "artifact_kind",
            resource,
        )
        if artifact_kind not in {"executable", "zip"}:
            raise BlockedError(
                reason="Chromedriver artifact_kind must be executable or zip",
                resource=resource,
            )
        cache_target = _relative_cache_path(
            _required_text(raw_artifact, "cache_target", resource),
            resource,
        )
        executable_target = _relative_cache_path(
            _required_text(raw_artifact, "executable_target", resource),
            resource,
        )
        executable_member = str(
            raw_artifact.get("executable_member") or ""
        ).strip()
        if artifact_kind == "zip" and not executable_member:
            raise BlockedError(
                reason="Zip Chromedriver artifact requires executable_member",
                resource=resource,
            )
        if artifact_kind == "executable" and (
            executable_member or executable_target != cache_target
        ):
            raise BlockedError(
                reason=(
                    "Executable Chromedriver artifact must use cache_target as "
                    "executable_target and omit executable_member"
                ),
                resource=resource,
            )
        identity = (browser_major, artifact_platform, artifact_arch)
        if identity in identities:
            raise BlockedError(
                reason=f"Chromedriver artifact identity is ambiguous: {identity}",
                resource=resource,
            )
        identities.add(identity)
        artifacts.append(
            ChromedriverArtifactSpec(
                browser_major=browser_major,
                driver_version=driver_version,
                source=source,
                platform=artifact_platform,
                arch=artifact_arch,
                android_abis=tuple(str(abi) for abi in raw_abis),
                sha256=sha256,
                cache_target=cache_target,
                artifact_kind=artifact_kind,
                executable_member=executable_member,
                executable_target=executable_target,
            )
        )
    return ChromedriverSpec(
        browser_packages=tuple(str(item) for item in packages),
        cache_root=cache_root,
        acquisition_enabled=enabled,
        acquisition_mode=mode,
        artifacts=tuple(artifacts),
    )


def load_mobile_simulator_spec(
    path: Path = ENVIRONMENTS_DIR / "mobile-simulator.yaml",
) -> MobileSimulatorSpec:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BlockedError(
            reason=f"Cannot load Mobile simulator environment contract: {error}",
            resource="mobile-simulator:environment",
        ) from error
    if not isinstance(payload, dict):
        raise BlockedError(
            reason="Mobile simulator environment contract must be an object",
            resource="mobile-simulator:environment",
        )
    if payload.get("id") != "mobile-simulator":
        raise BlockedError(
            reason="Mobile simulator environment id must be 'mobile-simulator'",
            resource="mobile-simulator:environment-id",
        )
    if any(payload.get(name) for name in ("services", "fixtures", "credentials")):
        raise BlockedError(
            reason=(
                "Mobile simulator environment must not declare services, "
                "fixtures, or credentials"
            ),
            resource="mobile-simulator:scope",
        )

    selectors = _required_object(
        payload,
        "selectors",
        "mobile-simulator:selectors",
    )
    ios_selector = _required_object(
        selectors,
        "ios",
        "mobile-simulator:selector:ios",
    )
    android_selector = _required_object(
        selectors,
        "android",
        "mobile-simulator:selector:android",
    )
    ios_runtime = _required_text(
        ios_selector,
        "preferred_runtime",
        "mobile-simulator:selector:ios",
    )
    ios_device_name = _required_text(
        ios_selector,
        "preferred_device_name",
        "mobile-simulator:selector:ios",
    )
    android_avd_name = _required_text(
        android_selector,
        "avd_name",
        "mobile-simulator:selector:android",
    )
    android_abi = _required_text(
        android_selector,
        "abi",
        "mobile-simulator:selector:android",
    )
    if (
        ios_runtime != IOS_RUNTIME
        or ios_device_name != IOS_DEVICE_NAME
        or android_avd_name != ANDROID_AVD_NAME
        or android_abi != ANDROID_ABI
    ):
        raise BlockedError(
            reason=(
                "Mobile simulator selectors must remain pinned to "
                f"{IOS_RUNTIME}/{IOS_DEVICE_NAME} and "
                f"{ANDROID_AVD_NAME}/{ANDROID_ABI}"
            ),
            resource="mobile-simulator:selectors",
        )

    build = _required_object(payload, "build", "mobile-simulator:build")
    environment = _required_object(
        build,
        "environment",
        "mobile-simulator:build-environment",
    )
    build_environment = {
        str(name): str(value) for name, value in environment.items()
    }
    if build_environment.get("VITE_ACCEPTANCE_HARNESS") != "1":
        raise BlockedError(
            reason=(
                "Mobile simulator build must declare "
                "VITE_ACCEPTANCE_HARNESS=1"
            ),
            resource="mobile-simulator:harness-build-flag",
        )
    commands = _required_object(
        build,
        "commands",
        "mobile-simulator:build-commands",
    )
    artifacts = _required_object(
        build,
        "artifacts",
        "mobile-simulator:artifacts",
    )
    applications = _required_object(
        build,
        "applications",
        "mobile-simulator:applications",
    )

    appium = _required_object(payload, "appium", "mobile-simulator:appium")
    server = _required_object(
        appium,
        "server",
        "mobile-simulator:appium-server",
    )
    ownership = _required_text(
        server,
        "ownership",
        "mobile-simulator:appium-server",
    )
    if ownership not in {"provisioner", "external"}:
        raise BlockedError(
            reason="Mobile simulator Appium ownership is invalid",
            resource="mobile-simulator:appium-ownership",
        )
    if ownership == "provisioner" and server.get("port") != "dynamic":
        raise BlockedError(
            reason="Provisioner-owned Appium must use a dynamic port",
            resource="mobile-simulator:appium-port",
        )
    external_url_ref = str(server.get("url_ref") or "").strip()
    if ownership == "external" and not external_url_ref.startswith("env:"):
        raise BlockedError(
            reason="External Appium requires an env: URL reference",
            resource="mobile-simulator:appium-url",
        )
    appium_expected_version = _required_text(
        server,
        "expected_version",
        "mobile-simulator:appium-server",
    )
    _parse_version(
        appium_expected_version,
        "mobile-simulator:appium-server-version",
    )

    raw_drivers = _required_object(
        appium,
        "drivers",
        "mobile-simulator:appium-drivers",
    )
    drivers: dict[str, AppiumDriverSpec] = {}
    for platform, expected in EXPECTED_DRIVERS.items():
        driver = _required_object(
            raw_drivers,
            platform,
            f"mobile-simulator:appium-driver:{platform}",
        )
        actual = (
            _required_text(
                driver,
                "identity",
                f"mobile-simulator:appium-driver:{platform}",
            ),
            _required_text(
                driver,
                "installed_name",
                f"mobile-simulator:appium-driver:{platform}",
            ),
            _required_text(
                driver,
                "automation_name",
                f"mobile-simulator:appium-driver:{platform}",
            ),
        )
        if actual != expected:
            raise BlockedError(
                reason=(
                    f"Mobile simulator {platform} Appium driver must be "
                    f"{'/'.join(expected)}"
                ),
                resource=f"mobile-simulator:appium-driver:{platform}",
            )
        expected_version = _required_text(
            driver,
            "expected_version",
            f"mobile-simulator:appium-driver:{platform}",
        )
        _parse_version(
            expected_version,
            f"mobile-simulator:appium-driver-version:{platform}",
        )
        drivers[platform] = AppiumDriverSpec(
            *actual,
            expected_version=expected_version,
        )

    raw_clients = _required_list(
        payload,
        "clients",
        "mobile-simulator:clients",
    )
    clients: list[SimulatorClientSpec] = []
    for raw_client in raw_clients:
        if not isinstance(raw_client, dict):
            raise BlockedError(
                reason="Mobile simulator client entries must be objects",
                resource="mobile-simulator:clients",
            )
        ports = _required_list(
            raw_client,
            "port_roles",
            "mobile-simulator:client-ports",
        )
        if len(ports) != 3 or any(
            not isinstance(port, str) or not port for port in ports
        ):
            raise BlockedError(
                reason="Every Mobile simulator client requires three port roles",
                resource="mobile-simulator:client-ports",
            )
        clients.append(
            SimulatorClientSpec(
                id=_required_text(
                    raw_client,
                    "id",
                    "mobile-simulator:client",
                ),
                platform=_required_text(
                    raw_client,
                    "platform",
                    "mobile-simulator:client",
                ),
                role=_required_text(
                    raw_client,
                    "role",
                    "mobile-simulator:client",
                ),
                runtime=_required_text(
                    raw_client,
                    "runtime",
                    "mobile-simulator:client",
                ),
                port_roles=tuple(ports),
                storage_root=_required_text(
                    raw_client,
                    "storage_root",
                    "mobile-simulator:client",
                ),
            )
        )
    actual_clients = {
        client.id: (client.platform, client.role, client.runtime)
        for client in clients
    }
    if actual_clients != EXPECTED_CLIENTS or len(clients) != 2:
        raise BlockedError(
            reason=(
                "Mobile simulator clients must be sim-ios/simulator and "
                "sim-android/emulator with simulator-only runtime kinds"
            ),
            resource="mobile-simulator:clients",
        )

    harness = _required_object(
        payload,
        "harness",
        "mobile-simulator:harness",
    )
    harness_actions = _required_list(
        harness,
        "required_actions",
        "mobile-simulator:harness-actions",
    )
    if set(harness_actions) != BASE_SIMULATOR_HARNESS_ACTIONS:
        raise BlockedError(
            reason=(
                "Mobile simulator Harness actions must cover lifecycle "
                "observation/transitions, native deep-link delivery, "
                "projection readback, and cleanup"
            ),
            resource="mobile-simulator:harness-actions",
        )
    proof_scope = _required_object(
        payload,
        "proof_scope",
        "mobile-simulator:proof-scope",
    )
    proves = _required_list(
        proof_scope,
        "proves",
        "mobile-simulator:proof-scope",
    )
    does_not_prove = _required_list(
        proof_scope,
        "does_not_prove",
        "mobile-simulator:proof-scope",
    )
    if not any("physical-device MS-AG03" in item for item in does_not_prove):
        raise BlockedError(
            reason="Mobile simulator proof scope must exclude physical MS-AG03",
            resource="mobile-simulator:proof-scope",
        )

    return MobileSimulatorSpec(
        ios_runtime=ios_runtime,
        ios_device_name=ios_device_name,
        android_avd_name=android_avd_name,
        android_abi=android_abi,
        build_environment=build_environment,
        build_commands={
            name: _command(commands, name)
            for name in ("web", "ios", "android")
        },
        artifact_patterns={
            platform: _required_text(
                artifacts,
                platform,
                f"mobile-simulator:artifact:{platform}",
            )
            for platform in EXPECTED_DRIVERS
        },
        application_ids={
            platform: _required_text(
                _required_object(
                    applications,
                    platform,
                    f"mobile-simulator:application:{platform}",
                ),
                "id",
                f"mobile-simulator:application:{platform}",
            )
            for platform in EXPECTED_DRIVERS
        },
        callback_schemes={
            platform: _required_text(
                _required_object(
                    applications,
                    platform,
                    f"mobile-simulator:application:{platform}",
                ),
                "callback_scheme",
                f"mobile-simulator:application:{platform}",
            )
            for platform in EXPECTED_DRIVERS
        },
        appium_ownership=ownership,
        appium_executable=_required_text(
            server,
            "executable",
            "mobile-simulator:appium-server",
        ),
        appium_expected_version=appium_expected_version,
        appium_host=_required_text(
            server,
            "host",
            "mobile-simulator:appium-server",
        ),
        appium_status_path=_required_text(
            server,
            "status_path",
            "mobile-simulator:appium-server",
        ),
        appium_startup_timeout_seconds=float(
            server.get("startup_timeout_seconds") or 30
        ),
        appium_external_url_ref=external_url_ref,
        drivers=drivers,
        chromedriver=_load_chromedriver_spec(appium),
        clients=tuple(clients),
        harness_namespace=_required_text(
            harness,
            "namespace",
            "mobile-simulator:harness",
        ),
        harness_actions=tuple(str(action) for action in harness_actions),
        proof_scope={
            "proves": tuple(str(item) for item in proves),
            "doesNotProve": tuple(str(item) for item in does_not_prove),
        },
    )


def load_mobile_ios_layout_simulator_spec(
    path: Path = ENVIRONMENTS_DIR / "mobile-ios-layout-simulator.yaml",
    *,
    base_path: Path = ENVIRONMENTS_DIR / "mobile-simulator.yaml",
) -> MobileIOSLayoutSimulatorSpec:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BlockedError(
            reason=f"Cannot load Mobile iOS layout environment contract: {error}",
            resource=f"{IOS_LAYOUT_ENVIRONMENT_ID}:environment",
        ) from error
    if not isinstance(payload, dict) or payload.get("id") != IOS_LAYOUT_ENVIRONMENT_ID:
        raise BlockedError(
            reason=(
                "Mobile iOS layout environment id must be "
                f"{IOS_LAYOUT_ENVIRONMENT_ID!r}"
            ),
            resource=f"{IOS_LAYOUT_ENVIRONMENT_ID}:environment-id",
        )
    if payload.get("base_environment") != "mobile-simulator":
        raise BlockedError(
            reason="Mobile iOS layout environment must extend mobile-simulator",
            resource=f"{IOS_LAYOUT_ENVIRONMENT_ID}:base-environment",
        )
    if any(payload.get(name) for name in ("services", "fixtures", "credentials")):
        raise BlockedError(
            reason=(
                "Mobile iOS layout environment must not declare services, "
                "fixtures, or credentials"
            ),
            resource=f"{IOS_LAYOUT_ENVIRONMENT_ID}:scope",
        )

    base = load_mobile_simulator_spec(base_path)
    selectors = _required_object(
        payload,
        "selectors",
        f"{IOS_LAYOUT_ENVIRONMENT_ID}:selectors",
    )
    ios_selector = _required_object(
        selectors,
        "ios",
        f"{IOS_LAYOUT_ENVIRONMENT_ID}:selector:ios",
    )
    ios_runtime = _required_text(
        ios_selector,
        "runtime",
        f"{IOS_LAYOUT_ENVIRONMENT_ID}:selector:ios",
    )
    if ios_runtime != base.ios_runtime:
        raise BlockedError(
            reason=(
                "Mobile iOS layout runtime must match the base simulator "
                f"runtime {base.ios_runtime!r}"
            ),
            resource=f"{IOS_LAYOUT_ENVIRONMENT_ID}:selector:ios",
        )

    raw_clients = _required_list(
        payload,
        "clients",
        f"{IOS_LAYOUT_ENVIRONMENT_ID}:clients",
    )
    clients: list[IOSLayoutClientSpec] = []
    for raw_client in raw_clients:
        if not isinstance(raw_client, dict):
            raise BlockedError(
                reason="Mobile iOS layout clients must be objects",
                resource=f"{IOS_LAYOUT_ENVIRONMENT_ID}:clients",
            )
        client_id = _required_text(
            raw_client,
            "id",
            f"{IOS_LAYOUT_ENVIRONMENT_ID}:client",
        )
        platform_name = _required_text(
            raw_client,
            "platform",
            f"{IOS_LAYOUT_ENVIRONMENT_ID}:client:{client_id}",
        )
        runtime = _required_text(
            raw_client,
            "runtime",
            f"{IOS_LAYOUT_ENVIRONMENT_ID}:client:{client_id}",
        )
        device_name = _required_text(
            raw_client,
            "device_name",
            f"{IOS_LAYOUT_ENVIRONMENT_ID}:client:{client_id}",
        )
        viewport_role = _required_text(
            raw_client,
            "viewport_role",
            f"{IOS_LAYOUT_ENVIRONMENT_ID}:client:{client_id}",
        )
        port_roles = _required_list(
            raw_client,
            "port_roles",
            f"{IOS_LAYOUT_ENVIRONMENT_ID}:client:{client_id}",
        )
        if (
            platform_name != "ios"
            or runtime != "tauri-ios-simulator"
            or len(port_roles) != 3
            or set(port_roles) != {"wda-local", "mjpeg", "webview"}
            or any(not isinstance(role, str) for role in port_roles)
        ):
            raise BlockedError(
                reason=(
                    "Mobile iOS layout clients require the iOS simulator "
                    "runtime and exact Appium port roles"
                ),
                resource=f"{IOS_LAYOUT_ENVIRONMENT_ID}:client:{client_id}",
            )
        clients.append(
            IOSLayoutClientSpec(
                id=client_id,
                device_name=device_name,
                viewport_role=viewport_role,
                port_roles=tuple(port_roles),
                storage_root=_required_text(
                    raw_client,
                    "storage_root",
                    f"{IOS_LAYOUT_ENVIRONMENT_ID}:client:{client_id}",
                ),
            )
        )
    actual_clients = {
        client.id: (client.device_name, client.viewport_role)
        for client in clients
    }
    if actual_clients != IOS_LAYOUT_CLIENTS or len(clients) != 2:
        raise BlockedError(
            reason=(
                "Mobile iOS layout clients must pin the compact iPhone SE "
                "and large iPhone Pro Max cells"
            ),
            resource=f"{IOS_LAYOUT_ENVIRONMENT_ID}:clients",
        )

    harness = _required_object(
        payload,
        "harness",
        f"{IOS_LAYOUT_ENVIRONMENT_ID}:harness",
    )
    harness_actions = _required_list(
        harness,
        "required_actions",
        f"{IOS_LAYOUT_ENVIRONMENT_ID}:harness-actions",
    )
    if set(harness_actions) != {"projection.read"}:
        raise BlockedError(
            reason=(
                "Mobile iOS layout Harness must expose exactly projection.read"
            ),
            resource=f"{IOS_LAYOUT_ENVIRONMENT_ID}:harness-actions",
        )

    proof_scope = _required_object(
        payload,
        "proof_scope",
        f"{IOS_LAYOUT_ENVIRONMENT_ID}:proof-scope",
    )
    proves = _required_list(
        proof_scope,
        "proves",
        f"{IOS_LAYOUT_ENVIRONMENT_ID}:proof-scope",
    )
    does_not_prove = _required_list(
        proof_scope,
        "does_not_prove",
        f"{IOS_LAYOUT_ENVIRONMENT_ID}:proof-scope",
    )
    if not proves or not all(isinstance(item, str) and item for item in proves):
        raise BlockedError(
            reason="Mobile iOS layout proof scope must declare proven cells",
            resource=f"{IOS_LAYOUT_ENVIRONMENT_ID}:proof-scope",
        )
    required_exclusions = {
        "Android",
        "VoiceOver or TalkBack",
        "physical-device performance",
    }
    if not required_exclusions.issubset(set(does_not_prove)):
        raise BlockedError(
            reason=(
                "Mobile iOS layout proof scope must preserve Android, "
                "screen-reader, and physical-performance exclusions"
            ),
            resource=f"{IOS_LAYOUT_ENVIRONMENT_ID}:proof-scope",
        )

    return MobileIOSLayoutSimulatorSpec(
        base=base,
        clients=tuple(clients),
        harness_actions=tuple(str(action) for action in harness_actions),
        proof_scope={
            "proves": tuple(str(item) for item in proves),
            "doesNotProve": tuple(str(item) for item in does_not_prove),
        },
    )


def load_mobile_station_lifecycle_simulator_spec(
    path: Path = (
        ENVIRONMENTS_DIR / "mobile-station-lifecycle-simulator.yaml"
    ),
    *,
    base_path: Path = ENVIRONMENTS_DIR / "mobile-simulator.yaml",
) -> MobileStationLifecycleSimulatorSpec:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        contract = EnvironmentContract.from_yaml(path)
    except (OSError, json.JSONDecodeError, ProvisioningError) as error:
        raise BlockedError(
            reason=(
                "Cannot load Mobile Station lifecycle simulator environment "
                f"contract: {error}"
            ),
            resource=f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:environment",
        ) from error
    if (
        not isinstance(payload, dict)
        or payload.get("id") != STATION_LIFECYCLE_ENVIRONMENT_ID
        or payload.get("base_environment") != "mobile-simulator"
    ):
        raise BlockedError(
            reason=(
                "Mobile Station lifecycle environment must extend "
                "mobile-simulator with the canonical environment id"
            ),
            resource=f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:environment",
        )
    if not contract.profile.required or not contract.profile.identity_match:
        raise BlockedError(
            reason=(
                "Mobile Station lifecycle environment requires an "
                "identity-matched profile"
            ),
            resource=f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:profile",
        )
    if (
        tuple(contract.services) != STATION_LIFECYCLE_SERVICES
        or any(
            requirement.kind != "station" or not requirement.required
            for requirement in contract.services.values()
        )
    ):
        raise BlockedError(
            reason=(
                "Mobile Station lifecycle environment requires exactly "
                "station-primary and station-secondary with kind station"
            ),
            resource=f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:services",
        )
    if contract.credentials:
        raise BlockedError(
            reason=(
                "Mobile Station lifecycle environment must not declare "
                "credentials"
            ),
            resource=f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:credentials",
        )
    if (
        len(contract.fixtures) != 1
        or contract.fixtures[0].id != "mobile-station-lifecycle-alice"
        or not contract.fixtures[0].authorization_required
        or contract.fixtures[0].authorization_ref
        != "env:MOBILE_ACCEPTANCE_RESET"
    ):
        raise BlockedError(
            reason=(
                "Mobile Station lifecycle environment requires the "
                "authorized Alice-only fixture"
            ),
            resource=f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:fixture",
        )

    clients = {client.id: client for client in contract.clients}
    if set(clients) != {"sim-ios", "sim-android"}:
        raise BlockedError(
            reason=(
                "Mobile Station lifecycle environment requires exactly the "
                "sim-ios and sim-android clients"
            ),
            resource=f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:clients",
        )
    expected_roles = {
        "sim-ios": ("station-primary", "station-secondary"),
        "sim-android": ("station-primary",),
    }
    for client_id, roles in expected_roles.items():
        client = clients[client_id]
        if (
            client.actor != "alice"
            or client.required_service_roles != roles
            or tuple(client.service_bindings) != roles
            or any(
                binding.service_id != role
                or binding.required_kind != "station"
                for role, binding in client.service_bindings.items()
            )
        ):
            raise BlockedError(
                reason=(
                    f"Mobile Station lifecycle client {client_id!r} has an "
                    "invalid Alice Station binding contract"
                ),
                resource=(
                    f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:client:{client_id}"
                ),
            )

    harness = _required_object(
        payload,
        "harness",
        f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:harness",
    )
    harness_actions = _required_list(
        harness,
        "required_actions",
        f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:harness-actions",
    )
    if (
        len(harness_actions) != len(STATION_LIFECYCLE_HARNESS_ACTIONS)
        or set(harness_actions) != STATION_LIFECYCLE_HARNESS_ACTIONS
    ):
        raise BlockedError(
            reason=(
                "Mobile Station lifecycle Harness actions must be the base "
                "simulator actions plus Station, access, scope, and logout"
            ),
            resource=f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:harness-actions",
        )

    proof_scope = _required_object(
        payload,
        "proof_scope",
        f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:proof-scope",
    )
    proves = _required_list(
        proof_scope,
        "proves",
        f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:proof-scope",
    )
    does_not_prove = _required_list(
        proof_scope,
        "does_not_prove",
        f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:proof-scope",
    )
    required_proven = {
        "AS-04 simulator valid-session restore and same-account revocation",
        (
            "AS-10 simulator Station switching, generation fencing, "
            "old-scope absence, and logout"
        ),
    }
    required_unproven = {
        "physical-device lifecycle behavior",
        "W4 command and draft recovery",
        "W5 event-ingress projection convergence",
    }
    if set(proves) != required_proven or not required_unproven.issubset(
        set(does_not_prove)
    ):
        raise BlockedError(
            reason=(
                "Mobile Station lifecycle proof scope must remain limited to "
                "the declared simulator AS-04 and AS-10 slice"
            ),
            resource=f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:proof-scope",
        )

    return MobileStationLifecycleSimulatorSpec(
        base=load_mobile_simulator_spec(base_path),
        harness_actions=tuple(str(action) for action in harness_actions),
        proof_scope={
            "proves": tuple(str(item) for item in proves),
            "doesNotProve": tuple(str(item) for item in does_not_prove),
        },
    )


def _with_simulator_resources(
    manifest: RuntimeManifest,
    resources: dict[str, Any],
) -> MobileSimulatorRuntimeManifest:
    values = {
        field.name: getattr(manifest, field.name)
        for field in dataclasses.fields(RuntimeManifest)
    }
    return MobileSimulatorRuntimeManifest(
        **values,
        simulator_resources=resources,
    )


def _artifact_digest(path: Path) -> str:
    digest = hashlib.sha256()
    if path.is_file():
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    if not path.is_dir():
        raise BlockedError(
            reason=f"Mobile simulator artifact is missing: {path}",
            resource="mobile-simulator:build-artifact",
        )
    for child in sorted(item for item in path.rglob("*") if item.is_file()):
        digest.update(child.relative_to(path).as_posix().encode("utf-8"))
        with child.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


class MobileSimulatorProvisioner(EnvironmentProvisioner):
    environment_id = "mobile-simulator"

    def __init__(
        self,
        contract: EnvironmentContract,
        *,
        executor: CommandExecutor | None = None,
        repo_root: Path = REPO_ROOT,
        runtime_base: Path | None = None,
        runtime_cache_base: Path | None = None,
        contract_path: Path | None = None,
        artifact_fetcher: Any | None = None,
        status_reader: Any | None = None,
        sleep: Any = time.sleep,
        monotonic: Any = time.monotonic,
    ) -> None:
        super().__init__(contract)
        self.executor = executor or SubprocessExecutor()
        self.repo_root = repo_root
        self.runtime_base = runtime_base or (
            Path(tempfile.gettempdir())
            / "peers-touch"
            / "acceptance"
            / "mobile-simulator"
        )
        self.runtime_cache_base = runtime_cache_base or (
            self.runtime_base.parent / "mobile-simulator-cache"
        )
        self.contract_path = contract_path or (
            ENVIRONMENTS_DIR / "mobile-simulator.yaml"
        )
        self.artifact_fetcher = artifact_fetcher or self._fetch_artifact
        self.status_reader = status_reader or self._read_json_url
        self.sleep = sleep
        self.monotonic = monotonic

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if (
                self._manifest.source_commit == "unknown"
                or self._manifest.workspace_digest == "unknown"
            ):
                raise BlockedError(
                    reason="Mobile simulator source identity is unavailable",
                    resource="mobile-simulator:source-identity",
                )
            spec = load_mobile_simulator_spec(self.contract_path)
            command_env = {
                **os.environ,
                **spec.build_environment,
            }
            command_env["NDK_HOME"] = _resolve_android_ndk_home(command_env)
            command_env["TARGET_RANLIB"] = _resolve_android_ndk_tool(
                command_env["NDK_HOME"],
                "llvm-ranlib",
            )
            android_manifest_guard = _GeneratedAndroidManifestGuard(
                self.repo_root / ANDROID_MANIFEST_RELATIVE_PATH
            )
            manifest = self._preflighted(
                self._manifest,
                profile_name="mobile-simulator",
                slot=0,
            )
            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease("mobile-simulator", owner)
            self.register_cleanup(
                "source:android-manifest",
                android_manifest_guard.restore,
            )

            runtime_root = self.runtime_base / manifest.run_id
            runtime_root.mkdir(parents=True, exist_ok=False)
            self.register_cleanup(
                "storage:mobile-simulator",
                lambda: shutil.rmtree(runtime_root),
            )

            ios_device, ios_owned = self._ready_ios_simulator(
                spec,
                command_env,
            )
            android_device, android_owned = self._ready_android_emulator(
                spec,
                command_env,
                runtime_root,
            )
            chromedriver = self._prepare_chromedriver(
                spec.chromedriver,
                android_device,
                command_env,
            )

            substitutions = {
                "ios_udid": ios_device["udid"],
                "runtime_root": str(runtime_root),
            }
            for name in ("web", "ios", "android"):
                if name in spec.artifact_patterns:
                    self._remove_artifact_matches(
                        spec,
                        name,
                        runtime_root,
                    )
                    self.register_cleanup(
                        f"build-artifact:{name}",
                        lambda platform=name: self._remove_artifact_matches(
                            spec,
                            platform,
                            runtime_root,
                        ),
                    )
                command = tuple(
                    item.replace(
                        "{ios_udid}",
                        substitutions["ios_udid"],
                    ).replace(
                        "{runtime_root}",
                        substitutions["runtime_root"],
                    )
                    for item in spec.build_commands[name]
                )
                try:
                    self._run_checked(
                        command,
                        env=command_env,
                        timeout=1800,
                        resource=f"mobile-simulator:build:{name}",
                    )
                    if name == "web":
                        self._stage_ios_static_assets()
                finally:
                    if name == "android":
                        android_manifest_guard.restore()

            applications = {
                platform: self._stage_application(
                    spec,
                    platform,
                    runtime_root,
                )
                for platform in ("ios", "android")
            }
            self._deploy_ios(
                ios_device["udid"],
                applications["ios"]["artifact"],
                spec.application_ids["ios"],
                command_env,
            )
            self._deploy_android(
                android_device["serial"],
                applications["android"]["artifact"],
                spec.application_ids["android"],
                command_env,
            )

            client_devices = {
                "sim-ios": {
                    "device": ios_device["udid"],
                    "deviceName": ios_device["name"],
                    "runtimeName": ios_device["runtime"],
                    "destination": (
                        f"platform=iOS Simulator,id={ios_device['udid']}"
                    ),
                    "ownedBoot": ios_owned,
                },
                "sim-android": {
                    "device": android_device["serial"],
                    "deviceName": android_device["avd"],
                    "runtimeName": "Android Emulator",
                    "destination": android_device["avd"],
                    "ownedBoot": android_owned,
                    "abi": android_device["abi"],
                    "browser": chromedriver["browser"],
                },
            }
            clients: list[ClientRuntime] = []
            client_resources: dict[str, dict[str, Any]] = {}
            for client in spec.clients:
                reservations = [
                    _PortReservation() for _ in client.port_roles
                ]
                for role, reservation in zip(
                    client.port_roles,
                    reservations,
                ):
                    self.register_cleanup(
                        f"port:{client.id}:{role}",
                        reservation.release,
                    )
                storage_root = runtime_root / "clients" / client.id
                storage_root.mkdir(parents=True, exist_ok=False)
                ports = {
                    role: reservation.port
                    for role, reservation in zip(
                        client.port_roles,
                        reservations,
                    )
                }
                clients.append(
                    ClientRuntime(
                        actor=client.role,
                        runtime=client.runtime,
                        worktree=str(self.repo_root),
                        gateway_port=reservations[0].port,
                        renderer_port=reservations[1].port,
                        webdriver_port=reservations[2].port,
                        profile=client.id,
                        storage_root=str(storage_root),
                    )
                )
                client_resources[client.id] = {
                    "platform": client.platform,
                    "role": client.role,
                    "runtime": client.runtime,
                    "deviceRole": client.role,
                    "profile": client.id,
                    "storageRoot": str(storage_root),
                    "ports": ports,
                    **client_devices[client.id],
                }
                if client.platform == "android":
                    client_resources[client.id]["appiumCapabilities"] = {
                        "appium:chromedriverExecutable": chromedriver[
                            "executable"
                        ],
                        "chromedriverExecutableReference": chromedriver[
                            "executableReference"
                        ],
                    }
                for reservation in reservations:
                    reservation.release()

            driver_versions = self._discover_appium_drivers(spec, command_env)
            appium_url, appium_owned, appium_version = self._ready_appium(
                spec,
                command_env,
                runtime_root,
            )

            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                clients=tuple(clients),
                cleanup_resources=self.contract.cleanup.resources,
            )
            manifest = _with_simulator_resources(
                manifest,
                {
                    "appium": {
                        "serverUrl": appium_url,
                        "owned": appium_owned,
                        "serverVersion": appium_version,
                        "expectedServerVersion": spec.appium_expected_version,
                        "drivers": {
                            platform: {
                                "identity": spec.drivers[platform].identity,
                                "automationName": (
                                    spec.drivers[platform].automation_name
                                ),
                                "version": driver_versions[platform],
                                "expectedVersion": (
                                    spec.drivers[platform].expected_version
                                ),
                                **(
                                    {
                                        "chromedriverExecutable": (
                                            chromedriver[
                                                "executable"
                                            ]
                                        ),
                                        "chromedriverExecutableReference": (
                                            chromedriver[
                                                "executableReference"
                                            ]
                                        ),
                                    }
                                    if platform == "android"
                                    else {}
                                ),
                            }
                            for platform in ("ios", "android")
                        },
                    },
                    "chromedriver": dict(chromedriver),
                    "applications": applications,
                    "clients": client_resources,
                    "harness": {
                        "namespace": spec.harness_namespace,
                        "requiredActions": list(spec.harness_actions),
                    },
                    "proofScope": {
                        key: list(value)
                        for key, value in spec.proof_scope.items()
                    },
                },
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (BlockedError, ProvisioningError, ValueError, OSError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Mobile simulator provisioning failed: {error}",
                    resource="mobile-simulator:provisioning",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )

    def _ready_ios_simulator(
        self,
        spec: MobileSimulatorSpec,
        env: Mapping[str, str],
        *,
        device_name: str | None = None,
    ) -> tuple[dict[str, str], bool]:
        target_device_name = device_name or spec.ios_device_name
        payload = self._run_json(
            ("xcrun", "simctl", "list", "--json"),
            env=env,
            timeout=30,
            resource="mobile-simulator:ios-discovery",
        )
        runtimes = payload.get("runtimes")
        devices = payload.get("devices")
        if not isinstance(runtimes, list) or not isinstance(devices, dict):
            raise BlockedError(
                reason="simctl discovery returned an invalid device inventory",
                resource="mobile-simulator:ios-discovery",
            )
        matching_runtimes = [
            runtime
            for runtime in runtimes
            if isinstance(runtime, dict)
            and runtime.get("name") == spec.ios_runtime
            and runtime.get("isAvailable", True)
        ]
        if len(matching_runtimes) != 1:
            raise BlockedError(
                reason=(
                    f"Required iOS Simulator runtime {spec.ios_runtime!r} "
                    "is unavailable or ambiguous"
                ),
                resource="mobile-simulator:ios-runtime",
            )
        runtime_id = str(matching_runtimes[0].get("identifier") or "")
        runtime_devices = devices.get(runtime_id)
        if not isinstance(runtime_devices, list):
            raise BlockedError(
                reason=(
                    f"Required iOS Simulator runtime {spec.ios_runtime!r} "
                    "has no devices"
                ),
                resource="mobile-simulator:ios-devices",
            )
        matches = [
            device
            for device in runtime_devices
            if isinstance(device, dict)
            and device.get("name") == target_device_name
            and device.get("isAvailable", True)
        ]
        if len(matches) != 1:
            raise BlockedError(
                reason=(
                    f"Required iOS Simulator {target_device_name!r} on "
                    f"{spec.ios_runtime!r} is unavailable or ambiguous"
                ),
                resource="mobile-simulator:ios-device",
            )
        udid = str(matches[0].get("udid") or "").strip()
        state = str(matches[0].get("state") or "").strip()
        if not udid:
            raise BlockedError(
                reason="Selected iOS Simulator has no UDID",
                resource="mobile-simulator:ios-device",
            )
        owned = state != "Booted"
        if owned:
            self._run_checked(
                ("xcrun", "simctl", "boot", udid),
                env=env,
                timeout=60,
                resource="mobile-simulator:ios-boot",
            )
            self.register_cleanup(
                f"simulator-shutdown:{udid}",
                lambda: self._run_cleanup(
                    ("xcrun", "simctl", "shutdown", udid),
                    env=env,
                    resource="mobile-simulator:ios-shutdown",
                ),
            )
        self._run_checked(
            ("xcrun", "simctl", "bootstatus", udid, "-b"),
            env=env,
            timeout=180,
            resource="mobile-simulator:ios-ready",
        )
        return {
            "udid": udid,
            "name": target_device_name,
            "runtime": spec.ios_runtime,
        }, owned

    def _ready_android_emulator(
        self,
        spec: MobileSimulatorSpec,
        env: Mapping[str, str],
        runtime_root: Path,
    ) -> tuple[dict[str, str], bool]:
        avds = self._run_checked(
            ("emulator", "-list-avds"),
            env=env,
            timeout=30,
            resource="mobile-simulator:android-avd-discovery",
        ).stdout.splitlines()
        if [item.strip() for item in avds].count(spec.android_avd_name) != 1:
            raise BlockedError(
                reason=(
                    f"Required Android AVD {spec.android_avd_name!r} "
                    "is unavailable or ambiguous"
                ),
                resource="mobile-simulator:android-avd",
            )

        running = self._running_emulators(spec.android_avd_name, env)
        if len(running) > 1:
            raise BlockedError(
                reason=(
                    f"Android AVD {spec.android_avd_name!r} has multiple "
                    "running emulator instances"
                ),
                resource="mobile-simulator:android-emulator",
            )
        process: ManagedProcess | None = None
        if running:
            serial = running[0]
            owned = False
        else:
            console_reservations = self._reserve_emulator_port_pair()
            console_port = console_reservations[0].port
            for reservation in console_reservations:
                reservation.release()
            serial = f"emulator-{console_port}"
            process = self.executor.start(
                (
                    "emulator",
                    "-avd",
                    spec.android_avd_name,
                    "-port",
                    str(console_port),
                    "-no-window",
                    "-no-audio",
                    "-no-boot-anim",
                    "-no-snapshot-save",
                ),
                cwd=self.repo_root,
                env=env,
                log_path=runtime_root / "logs" / "android-emulator.log",
            )
            self.register_cleanup(
                f"emulator-process:{serial}",
                process.stop,
            )
            owned = True

        self._run_checked(
            ("adb", "-s", serial, "wait-for-device"),
            env=env,
            timeout=180,
            resource="mobile-simulator:android-device-ready",
        )
        deadline = self.monotonic() + 180
        while self.monotonic() < deadline:
            if process is not None and process.poll() is not None:
                raise BlockedError(
                    reason="Android emulator exited before boot completed",
                    resource="mobile-simulator:android-emulator",
                )
            completed = self.executor.run(
                (
                    "adb",
                    "-s",
                    serial,
                    "shell",
                    "getprop",
                    "sys.boot_completed",
                ),
                cwd=self.repo_root,
                env=env,
                timeout=10,
            )
            if completed.returncode == 0 and completed.stdout.strip() == "1":
                abi = self._run_checked(
                    (
                        "adb",
                        "-s",
                        serial,
                        "shell",
                        "getprop",
                        "ro.product.cpu.abi",
                    ),
                    env=env,
                    timeout=10,
                    resource="mobile-simulator:android-abi",
                ).stdout.strip()
                if abi != spec.android_abi:
                    raise BlockedError(
                        reason=(
                            f"Android AVD {spec.android_avd_name!r} ABI "
                            f"{abi!r} does not match {spec.android_abi!r}"
                        ),
                        resource="mobile-simulator:android-abi",
                    )
                return {
                    "serial": serial,
                    "avd": spec.android_avd_name,
                    "abi": abi,
                }, owned
            self.sleep(0.5)
        raise BlockedError(
            reason=(
                f"Android AVD {spec.android_avd_name!r} did not become ready"
            ),
            resource="mobile-simulator:android-ready",
        )

    def _prepare_chromedriver(
        self,
        spec: ChromedriverSpec,
        android_device: Mapping[str, str],
        env: Mapping[str, str],
    ) -> dict[str, Any]:
        serial = android_device["serial"]
        abi = android_device["abi"]
        browser = self._discover_android_browser(spec, serial, env)
        host_platform, host_arch = self._host_platform_identity()
        matching_major = [
            artifact
            for artifact in spec.artifacts
            if artifact.browser_major == browser["major"]
        ]
        if not matching_major:
            raise BlockedError(
                reason=(
                    "No exact Chromedriver artifact is declared for Android "
                    f"browser major {browser['major']}"
                ),
                resource=(
                    "mobile-simulator:chromedriver-browser-mismatch:"
                    f"{browser['major']}"
                ),
            )
        matching_host = [
            artifact
            for artifact in matching_major
            if artifact.platform == host_platform
            and artifact.arch == host_arch
            and abi in artifact.android_abis
        ]
        if len(matching_host) != 1:
            raise BlockedError(
                reason=(
                    "No unambiguous Chromedriver artifact supports host "
                    f"{host_platform}/{host_arch} and emulator ABI {abi}"
                ),
                resource="mobile-simulator:chromedriver-unsupported-arch",
            )
        artifact = matching_host[0]
        cache_root = (self.runtime_cache_base / "chromedriver").resolve()
        repository_root = self.repo_root.resolve()
        if (
            cache_root == repository_root
            or repository_root in cache_root.parents
        ):
            raise BlockedError(
                reason="Chromedriver cache must be outside the source tree",
                resource="mobile-simulator:chromedriver-cache-root",
            )
        artifact_path = self._contained_cache_path(
            cache_root,
            artifact.cache_target,
        )
        executable_path = self._contained_cache_path(
            cache_root,
            artifact.executable_target,
        )
        acquired = False
        if not artifact_path.is_file():
            if not spec.acquisition_enabled:
                raise BlockedError(
                    reason=(
                        "Chromedriver artifact is absent and declarative "
                        "acquisition is disabled"
                    ),
                    resource="mobile-simulator:chromedriver-artifact-absent",
                )
            self._acquire_chromedriver_artifact(artifact, artifact_path)
            acquired = True
        actual_sha256 = _artifact_digest(artifact_path)
        if actual_sha256 != artifact.sha256:
            raise BlockedError(
                reason=(
                    "Chromedriver artifact checksum mismatch: expected "
                    f"{artifact.sha256}, got {actual_sha256}"
                ),
                resource="mobile-simulator:chromedriver-checksum",
            )
        if artifact.artifact_kind == "zip":
            self._extract_chromedriver(
                artifact,
                artifact_path,
                executable_path,
            )
        if not executable_path.is_file():
            raise BlockedError(
                reason=(
                    "Chromedriver executable is absent after artifact "
                    "verification"
                ),
                resource="mobile-simulator:chromedriver-executable",
            )
        executable_path.chmod(executable_path.stat().st_mode | 0o111)
        version_result = self._run_checked(
            (str(executable_path), "--version"),
            env=env,
            timeout=30,
            resource="mobile-simulator:chromedriver-version",
        )
        actual_driver_version, driver_major = _parse_version(
            version_result.stdout,
            "mobile-simulator:chromedriver-version",
        )
        if (
            actual_driver_version != artifact.driver_version
            or driver_major != browser["major"]
        ):
            raise BlockedError(
                reason=(
                    f"Chromedriver {actual_driver_version!r} is incompatible "
                    f"with browser {browser['version']!r}; contract requires "
                    f"{artifact.driver_version!r}"
                ),
                resource="mobile-simulator:chromedriver-browser-mismatch",
            )
        executable_reference = (
            f"<runtime-cache>/chromedriver/{artifact.executable_target}"
        )
        return {
            "version": actual_driver_version,
            "source": artifact.source,
            "sha256": artifact.sha256,
            "platform": artifact.platform,
            "arch": artifact.arch,
            "emulatorAbi": abi,
            "cacheTarget": (
                f"<runtime-cache>/chromedriver/{artifact.cache_target}"
            ),
            "executable": str(executable_path),
            "executableReference": executable_reference,
            "browser": browser,
            "acquisition": {
                "mode": spec.acquisition_mode,
                "enabled": spec.acquisition_enabled,
                "performed": acquired,
            },
        }

    def _discover_android_browser(
        self,
        spec: ChromedriverSpec,
        serial: str,
        env: Mapping[str, str],
    ) -> dict[str, Any]:
        packages: dict[str, dict[str, Any]] = {}
        for package_name in spec.browser_packages:
            result = self.executor.run(
                (
                    "adb",
                    "-s",
                    serial,
                    "shell",
                    "dumpsys",
                    "package",
                    package_name,
                ),
                cwd=self.repo_root,
                env=env,
                timeout=30,
            )
            version_match = re.search(
                r"(?m)^\s*versionName=(\S+)\s*$",
                result.stdout,
            )
            if result.returncode == 0 and version_match is not None:
                version, major = _parse_version(
                    version_match.group(1),
                    "mobile-simulator:android-browser-version",
                )
                packages[package_name] = {
                    "installed": True,
                    "version": version,
                    "major": major,
                }
            else:
                packages[package_name] = {"installed": False}
        if not any(item["installed"] for item in packages.values()):
            raise BlockedError(
                reason=(
                    "Android emulator has neither declared Chrome nor WebView "
                    "package installed"
                ),
                resource="mobile-simulator:android-browser-absent",
            )

        provider_result = self._run_checked(
            (
                "adb",
                "-s",
                serial,
                "shell",
                "dumpsys",
                "webviewupdate",
            ),
            env=env,
            timeout=30,
            resource="mobile-simulator:android-webview-provider",
        )
        provider_line = next(
            (
                line
                for line in provider_result.stdout.splitlines()
                if "Current WebView package" in line
            ),
            "",
        )
        provider_package = next(
            (
                package_name
                for package_name in spec.browser_packages
                if package_name in provider_line
            ),
            "",
        )
        provider_version_match = VERSION_PATTERN.search(provider_line)
        if not provider_package or provider_version_match is None:
            raise BlockedError(
                reason="Android active WebView provider is missing or ambiguous",
                resource="mobile-simulator:android-webview-provider",
            )
        provider_version, provider_major = _parse_version(
            provider_version_match.group(0),
            "mobile-simulator:android-webview-provider",
        )
        inventory_version = packages.get(provider_package, {}).get("version")
        if inventory_version != provider_version:
            raise BlockedError(
                reason=(
                    f"Active WebView provider {provider_package!r} reports "
                    f"{provider_version!r}, but package inventory reports "
                    f"{inventory_version!r}"
                ),
                resource="mobile-simulator:android-browser-mismatch",
            )
        return {
            "activePackage": provider_package,
            "version": provider_version,
            "major": provider_major,
            "discovery": "adb-shell-dumpsys-webviewupdate",
            "packages": packages,
        }

    @staticmethod
    def _host_platform_identity() -> tuple[str, str]:
        platforms = {
            "darwin": "darwin",
            "linux": "linux",
            "win32": "windows",
        }
        arches = {
            "arm64": "arm64",
            "aarch64": "arm64",
            "x86_64": "x86_64",
            "amd64": "x86_64",
        }
        host_platform = platforms.get(os.sys.platform)
        host_arch = arches.get(platform.machine().lower())
        if not host_platform or not host_arch:
            raise BlockedError(
                reason=(
                    f"Chromedriver host {os.sys.platform}/"
                    f"{platform.machine()} is unsupported"
                ),
                resource="mobile-simulator:chromedriver-unsupported-arch",
            )
        return host_platform, host_arch

    @staticmethod
    def _contained_cache_path(cache_root: Path, relative: str) -> Path:
        target = (cache_root / relative).resolve()
        if cache_root != target and cache_root not in target.parents:
            raise BlockedError(
                reason="Chromedriver cache target escaped the external cache",
                resource="mobile-simulator:chromedriver-cache-target",
            )
        return target

    def _acquire_chromedriver_artifact(
        self,
        artifact: ChromedriverArtifactSpec,
        artifact_path: Path,
    ) -> None:
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = artifact_path.with_name(
            f".{artifact_path.name}.{os.getpid()}.tmp"
        )
        try:
            self.artifact_fetcher(artifact.source, temporary_path)
            if not temporary_path.is_file():
                raise BlockedError(
                    reason="Chromedriver acquisition produced no artifact",
                    resource="mobile-simulator:chromedriver-acquisition",
                )
            actual_sha256 = _artifact_digest(temporary_path)
            if actual_sha256 != artifact.sha256:
                raise BlockedError(
                    reason=(
                        "Acquired Chromedriver checksum mismatch: expected "
                        f"{artifact.sha256}, got {actual_sha256}"
                    ),
                    resource="mobile-simulator:chromedriver-checksum",
                )
            os.replace(temporary_path, artifact_path)
        finally:
            temporary_path.unlink(missing_ok=True)

    @staticmethod
    def _extract_chromedriver(
        artifact: ChromedriverArtifactSpec,
        artifact_path: Path,
        executable_path: Path,
    ) -> None:
        try:
            with zipfile.ZipFile(artifact_path) as archive:
                member = archive.getinfo(artifact.executable_member)
                if member.is_dir():
                    raise KeyError(artifact.executable_member)
                executable_path.parent.mkdir(parents=True, exist_ok=True)
                temporary_path = executable_path.with_name(
                    f".{executable_path.name}.{os.getpid()}.tmp"
                )
                try:
                    with archive.open(member) as source:
                        with temporary_path.open("wb") as destination:
                            shutil.copyfileobj(source, destination)
                    os.replace(temporary_path, executable_path)
                finally:
                    temporary_path.unlink(missing_ok=True)
        except (KeyError, OSError, zipfile.BadZipFile) as error:
            raise BlockedError(
                reason=(
                    "Chromedriver archive does not contain the declared "
                    f"executable member {artifact.executable_member!r}"
                ),
                resource="mobile-simulator:chromedriver-archive",
            ) from error

    @staticmethod
    def _fetch_artifact(source: str, destination: Path) -> None:
        request = urllib.request.Request(
            source,
            headers={"Accept": "application/octet-stream"},
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                with destination.open("wb") as output:
                    shutil.copyfileobj(response, output)
        except (OSError, TimeoutError, urllib.error.URLError) as error:
            raise BlockedError(
                reason=(
                    "Explicit Chromedriver acquisition failed from declared "
                    f"source: {type(error).__name__}"
                ),
                resource="mobile-simulator:chromedriver-acquisition",
            ) from error

    def _running_emulators(
        self,
        avd_name: str,
        env: Mapping[str, str],
    ) -> list[str]:
        output = self._run_checked(
            ("adb", "devices"),
            env=env,
            timeout=30,
            resource="mobile-simulator:android-device-discovery",
        ).stdout
        matches: list[str] = []
        for line in output.splitlines()[1:]:
            fields = line.split()
            if len(fields) < 2 or fields[1] != "device":
                continue
            serial = fields[0]
            if not serial.startswith("emulator-"):
                continue
            result = self.executor.run(
                ("adb", "-s", serial, "emu", "avd", "name"),
                cwd=self.repo_root,
                env=env,
                timeout=10,
            )
            names = [
                item.strip()
                for item in result.stdout.splitlines()
                if item.strip() and item.strip() != "OK"
            ]
            if result.returncode == 0 and names[:1] == [avd_name]:
                matches.append(serial)
        return matches

    def _reserve_emulator_port_pair(
        self,
    ) -> tuple[_PortReservation, _PortReservation]:
        for port in range(5554, 5683, 2):
            first: _PortReservation | None = None
            try:
                first = _PortReservation(port)
                second = _PortReservation(port + 1)
                return first, second
            except OSError:
                if first is not None:
                    first.release()
        raise BlockedError(
            reason="No free Android emulator console port pair is available",
            resource="mobile-simulator:android-console-port",
        )

    def _stage_application(
        self,
        spec: MobileSimulatorSpec,
        platform: str,
        runtime_root: Path,
    ) -> dict[str, str]:
        matches = self._artifact_matches(spec, platform, runtime_root)
        pattern = spec.artifact_patterns[platform].format(
            runtime_root=str(runtime_root)
        )
        if not os.path.isabs(pattern):
            pattern = str(self.repo_root / pattern)
        if len(matches) != 1:
            raise BlockedError(
                reason=(
                    f"Mobile simulator {platform} build produced "
                    f"{len(matches)} artifacts for {pattern!r}; exactly one "
                    "is required"
                ),
                resource=f"mobile-simulator:{platform}-artifact",
            )
        source = matches[0]
        destination_root = runtime_root / "applications" / platform
        destination_root.mkdir(parents=True, exist_ok=False)
        destination = destination_root / source.name
        if source.is_dir():
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)
        return {
            "artifact": str(destination),
            "sha256": _artifact_digest(destination),
            "id": spec.application_ids[platform],
            "callbackScheme": spec.callback_schemes[platform],
        }

    def _stage_ios_static_assets(self) -> None:
        source = (self.repo_root / "apps" / "mobile" / "dist").resolve()
        target = (
            self.repo_root
            / "apps"
            / "mobile"
            / "src-tauri"
            / "gen"
            / "apple"
            / "assets"
        ).resolve()
        if not source.is_dir() or not (source / "index.html").is_file():
            raise BlockedError(
                reason="Mobile web build did not produce a complete static bundle",
                resource="mobile-simulator:ios-static-assets",
            )
        repository_root = self.repo_root.resolve()
        if repository_root not in target.parents:
            raise BlockedError(
                reason="Mobile iOS static asset target escaped the source tree",
                resource="mobile-simulator:ios-static-assets",
            )

        def cleanup() -> None:
            if target.is_symlink() or target.is_file():
                target.unlink()
            elif target.is_dir():
                shutil.rmtree(target)

        self.register_cleanup("build-artifact:ios-static-assets", cleanup)
        cleanup()
        shutil.copytree(source, target)

    def _artifact_matches(
        self,
        spec: MobileSimulatorSpec,
        platform: str,
        runtime_root: Path,
    ) -> list[Path]:
        pattern = spec.artifact_patterns[platform].format(
            runtime_root=str(runtime_root)
        )
        if not os.path.isabs(pattern):
            pattern = str(self.repo_root / pattern)
        return sorted(
            Path(item)
            for item in glob.glob(pattern, recursive=True)
            if Path(item).is_file() or Path(item).is_dir()
        )

    def _remove_artifact_matches(
        self,
        spec: MobileSimulatorSpec,
        platform: str,
        runtime_root: Path,
    ) -> None:
        allowed_roots = (
            self.repo_root.resolve(),
            runtime_root.resolve(),
        )
        for path in self._artifact_matches(spec, platform, runtime_root):
            resolved = path.resolve()
            if not any(
                resolved == root or root in resolved.parents
                for root in allowed_roots
            ):
                raise BlockedError(
                    reason=(
                        "Mobile simulator artifact cleanup escaped its "
                        f"owned roots: {path}"
                    ),
                    resource=f"mobile-simulator:{platform}-artifact-cleanup",
                )
            if path.is_symlink() or path.is_file():
                path.unlink()
            else:
                shutil.rmtree(path)

    def _deploy_ios(
        self,
        udid: str,
        artifact: str,
        application_id: str,
        env: Mapping[str, str],
    ) -> None:
        self._run_checked(
            ("xcrun", "simctl", "install", udid, artifact),
            env=env,
            timeout=180,
            resource="mobile-simulator:ios-install",
        )
        self.register_cleanup(
            f"application-uninstall:ios:{udid}:{application_id}",
            lambda: self._run_cleanup(
                (
                    "xcrun",
                    "simctl",
                    "uninstall",
                    udid,
                    application_id,
                ),
                env=env,
                resource="mobile-simulator:ios-uninstall",
            ),
        )

    def _deploy_android(
        self,
        serial: str,
        artifact: str,
        application_id: str,
        env: Mapping[str, str],
    ) -> None:
        if not serial.startswith("emulator-"):
            raise BlockedError(
                reason=(
                    f"Android target {serial!r} is not an emulator; physical "
                    "device fallback is forbidden"
                ),
                resource="mobile-simulator:physical-device",
            )
        self._run_checked(
            ("adb", "-s", serial, "install", "-r", "-t", artifact),
            env=env,
            timeout=180,
            resource="mobile-simulator:android-install",
        )
        self.register_cleanup(
            f"application-uninstall:android:{application_id}",
            lambda: self._run_cleanup(
                ("adb", "-s", serial, "uninstall", application_id),
                env=env,
                resource="mobile-simulator:android-uninstall",
            ),
        )

    def _discover_appium_drivers(
        self,
        spec: MobileSimulatorSpec,
        env: Mapping[str, str],
        *,
        platforms: tuple[str, ...] | None = None,
    ) -> dict[str, str]:
        result = self._run_checked(
            (
                spec.appium_executable,
                "driver",
                "list",
                "--installed",
                "--json",
            ),
            env=env,
            timeout=60,
            resource="mobile-simulator:appium-drivers",
        )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise BlockedError(
                reason="Appium driver inventory is not valid JSON",
                resource="mobile-simulator:appium-drivers",
            ) from error
        versions: dict[str, str] = {}
        selected_platforms = platforms or tuple(spec.drivers)
        for platform in selected_platforms:
            driver = spec.drivers[platform]
            entry = (
                payload.get(driver.installed_name)
                if isinstance(payload, dict)
                else None
            )
            version = (
                str(entry.get("version") or "").strip()
                if isinstance(entry, dict)
                else ""
            )
            if not version:
                raise BlockedError(
                    reason=(
                        f"Required Appium driver {driver.installed_name!r} "
                        "is not installed"
                    ),
                    resource=(
                        f"mobile-simulator:appium-driver:{platform}"
                    ),
                )
            if version != driver.expected_version:
                raise BlockedError(
                    reason=(
                        f"Appium driver {driver.installed_name!r} version "
                        f"{version!r} does not match required version "
                        f"{driver.expected_version!r}"
                    ),
                    resource=(
                        f"mobile-simulator:appium-driver-version:{platform}"
                    ),
                )
            versions[platform] = version
        return versions

    def _ready_appium(
        self,
        spec: MobileSimulatorSpec,
        env: Mapping[str, str],
        runtime_root: Path,
    ) -> tuple[str, bool, str]:
        process: ManagedProcess | None = None
        if spec.appium_ownership == "provisioner":
            reservation = _PortReservation()
            self.register_cleanup("port:appium", reservation.release)
            port = reservation.port
            reservation.release()
            server_url = f"http://{spec.appium_host}:{port}"
            process = self.executor.start(
                (
                    spec.appium_executable,
                    "--address",
                    spec.appium_host,
                    "--port",
                    str(port),
                    "--base-path",
                    "/",
                    "--log-no-colors",
                ),
                cwd=self.repo_root,
                env=env,
                log_path=runtime_root / "logs" / "appium.log",
            )
            self.register_cleanup("appium-process", process.stop)
            owned = True
        else:
            variable = spec.appium_external_url_ref.removeprefix("env:")
            server_url = os.environ.get(variable, "").strip()
            if not server_url:
                raise BlockedError(
                    reason=f"External Appium requires {variable}",
                    resource=f"mobile-simulator:appium-url:{variable}",
                )
            owned = False

        status_url = urllib.parse.urljoin(
            f"{server_url.rstrip('/')}/",
            spec.appium_status_path.lstrip("/"),
        )
        deadline = self.monotonic() + spec.appium_startup_timeout_seconds
        last_error = ""
        while self.monotonic() < deadline:
            if process is not None and process.poll() is not None:
                raise BlockedError(
                    reason="Provisioner-owned Appium exited before readiness",
                    resource="mobile-simulator:appium-process",
                )
            try:
                payload = self.status_reader(status_url, 1.0)
                value = payload.get("value") if isinstance(payload, dict) else None
                build = value.get("build") if isinstance(value, dict) else None
                version = (
                    str(build.get("version") or "").strip()
                    if isinstance(build, dict)
                    else ""
                )
                if version and version != spec.appium_expected_version:
                    raise BlockedError(
                        reason=(
                            f"Appium server version {version!r} does not match "
                            f"required version {spec.appium_expected_version!r}"
                        ),
                        resource="mobile-simulator:appium-server-version",
                    )
                if version:
                    return server_url, owned, version
                last_error = "status response has no build version"
            except (OSError, TimeoutError, urllib.error.URLError) as error:
                last_error = type(error).__name__
            self.sleep(0.25)
        raise BlockedError(
            reason=(
                f"Appium did not become ready at {status_url}: {last_error}"
            ),
            resource="mobile-simulator:appium-ready",
        )

    def _run_json(
        self,
        command: Sequence[str],
        *,
        env: Mapping[str, str],
        timeout: float,
        resource: str,
    ) -> dict[str, Any]:
        result = self._run_checked(
            command,
            env=env,
            timeout=timeout,
            resource=resource,
        )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise BlockedError(
                reason=f"Command {command[0]!r} returned invalid JSON",
                resource=resource,
            ) from error
        if not isinstance(payload, dict):
            raise BlockedError(
                reason=f"Command {command[0]!r} returned a non-object payload",
                resource=resource,
            )
        return payload

    def _run_checked(
        self,
        command: Sequence[str],
        *,
        env: Mapping[str, str],
        timeout: float,
        resource: str,
    ) -> CommandResult:
        result = self.executor.run(
            command,
            cwd=self.repo_root,
            env=env,
            timeout=timeout,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            if len(detail) > 500:
                detail = detail[-500:]
            raise BlockedError(
                reason=(
                    f"Command {command[0]!r} failed for {resource}"
                    + (f": {detail}" if detail else "")
                ),
                resource=resource,
            )
        return result

    def _run_cleanup(
        self,
        command: Sequence[str],
        *,
        env: Mapping[str, str],
        resource: str,
    ) -> None:
        result = self.executor.run(
            command,
            cwd=self.repo_root,
            env=env,
            timeout=60,
        )
        if result.returncode != 0:
            raise ProvisioningError(
                f"{resource} failed with exit code {result.returncode}"
            )

    @staticmethod
    def _read_json_url(url: str, timeout: float) -> dict[str, Any]:
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise OSError("Appium status response is not an object")
        return payload


class MobileIOSLayoutSimulatorProvisioner(MobileSimulatorProvisioner):
    environment_id = IOS_LAYOUT_ENVIRONMENT_ID

    def __init__(
        self,
        contract: EnvironmentContract,
        *,
        executor: CommandExecutor | None = None,
        repo_root: Path = REPO_ROOT,
        runtime_base: Path | None = None,
        runtime_cache_base: Path | None = None,
        contract_path: Path | None = None,
        base_contract_path: Path | None = None,
        artifact_fetcher: Any | None = None,
        status_reader: Any | None = None,
        sleep: Any = time.sleep,
        monotonic: Any = time.monotonic,
    ) -> None:
        super().__init__(
            contract,
            executor=executor,
            repo_root=repo_root,
            runtime_base=runtime_base
            or (
                Path(tempfile.gettempdir())
                / "peers-touch"
                / "acceptance"
                / IOS_LAYOUT_ENVIRONMENT_ID
            ),
            runtime_cache_base=runtime_cache_base,
            contract_path=contract_path
            or (ENVIRONMENTS_DIR / "mobile-ios-layout-simulator.yaml"),
            artifact_fetcher=artifact_fetcher,
            status_reader=status_reader,
            sleep=sleep,
            monotonic=monotonic,
        )
        self.base_contract_path = base_contract_path or (
            ENVIRONMENTS_DIR / "mobile-simulator.yaml"
        )

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if (
                self._manifest.source_commit == "unknown"
                or self._manifest.workspace_digest == "unknown"
            ):
                raise BlockedError(
                    reason="Mobile iOS layout source identity is unavailable",
                    resource=f"{self.environment_id}:source-identity",
                )
            spec = load_mobile_ios_layout_simulator_spec(
                self.contract_path,
                base_path=self.base_contract_path,
            )
            base = spec.base
            command_env = {
                **os.environ,
                **base.build_environment,
            }
            manifest = self._preflighted(
                self._manifest,
                profile_name=self.environment_id,
                slot=0,
            )
            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(self.environment_id, owner)

            runtime_root = self.runtime_base / manifest.run_id
            runtime_root.mkdir(parents=True, exist_ok=False)
            self.register_cleanup(
                f"storage:{self.environment_id}",
                lambda: shutil.rmtree(runtime_root),
            )

            device_resources: dict[str, dict[str, str | bool]] = {}
            for client in spec.clients:
                device, owned = self._ready_ios_simulator(
                    base,
                    command_env,
                    device_name=client.device_name,
                )
                device_resources[client.id] = {
                    "device": device["udid"],
                    "udid": device["udid"],
                    "deviceName": device["name"],
                    "runtimeName": device["runtime"],
                    "ownedBoot": owned,
                }

            first_device = device_resources[spec.clients[0].id]
            substitutions = {
                "ios_udid": str(first_device["udid"]),
                "runtime_root": str(runtime_root),
            }
            for name in ("web", "ios"):
                if name in base.artifact_patterns:
                    self._remove_artifact_matches(
                        base,
                        name,
                        runtime_root,
                    )
                    self.register_cleanup(
                        f"build-artifact:{name}",
                        lambda platform=name: self._remove_artifact_matches(
                            base,
                            platform,
                            runtime_root,
                        ),
                    )
                command = tuple(
                    item.replace(
                        "{ios_udid}",
                        substitutions["ios_udid"],
                    ).replace(
                        "{runtime_root}",
                        substitutions["runtime_root"],
                    )
                    for item in base.build_commands[name]
                )
                self._run_checked(
                    command,
                    env=command_env,
                    timeout=1800,
                    resource=f"{self.environment_id}:build:{name}",
                )

            application = self._stage_application(
                base,
                "ios",
                runtime_root,
            )
            for device in device_resources.values():
                self._deploy_ios(
                    str(device["udid"]),
                    application["artifact"],
                    base.application_ids["ios"],
                    command_env,
                )

            clients: list[ClientRuntime] = []
            client_resources: dict[str, dict[str, Any]] = {}
            for client in spec.clients:
                reservations = [
                    _PortReservation() for _ in client.port_roles
                ]
                for role, reservation in zip(
                    client.port_roles,
                    reservations,
                ):
                    self.register_cleanup(
                        f"port:{client.id}:{role}",
                        reservation.release,
                    )
                storage_root = runtime_root / "clients" / client.id
                storage_root.mkdir(parents=True, exist_ok=False)
                ports = {
                    role: reservation.port
                    for role, reservation in zip(
                        client.port_roles,
                        reservations,
                    )
                }
                clients.append(
                    ClientRuntime(
                        actor=client.viewport_role,
                        runtime="tauri-ios-simulator",
                        worktree=str(self.repo_root),
                        gateway_port=reservations[0].port,
                        renderer_port=reservations[1].port,
                        webdriver_port=reservations[2].port,
                        profile=client.id,
                        storage_root=str(storage_root),
                    )
                )
                client_resources[client.id] = {
                    "platform": "ios",
                    "role": f"{client.viewport_role}-layout",
                    "runtime": "tauri-ios-simulator",
                    "deviceRole": "simulator",
                    "viewportRole": client.viewport_role,
                    "profile": client.id,
                    "storageRoot": str(storage_root),
                    "ports": ports,
                    **device_resources[client.id],
                }
                for reservation in reservations:
                    reservation.release()

            driver_versions = self._discover_appium_drivers(
                base,
                command_env,
                platforms=("ios",),
            )
            appium_url, appium_owned, appium_version = self._ready_appium(
                base,
                command_env,
                runtime_root,
            )
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                clients=tuple(clients),
                cleanup_resources=self.contract.cleanup.resources,
            )
            manifest = _with_simulator_resources(
                manifest,
                {
                    "appium": {
                        "serverUrl": appium_url,
                        "owned": appium_owned,
                        "serverVersion": appium_version,
                        "expectedServerVersion": base.appium_expected_version,
                        "drivers": {
                            "ios": {
                                "identity": base.drivers["ios"].identity,
                                "automationName": (
                                    base.drivers["ios"].automation_name
                                ),
                                "version": driver_versions["ios"],
                                "expectedVersion": (
                                    base.drivers["ios"].expected_version
                                ),
                            }
                        },
                    },
                    "applications": {"ios": application},
                    "clients": client_resources,
                    "harness": {
                        "namespace": base.harness_namespace,
                        "requiredActions": list(spec.harness_actions),
                    },
                    "proofScope": {
                        key: list(value)
                        for key, value in spec.proof_scope.items()
                    },
                },
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (BlockedError, ProvisioningError, ValueError, OSError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Mobile iOS layout provisioning failed: {error}",
                    resource=f"{self.environment_id}:provisioning",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )


def _json_safe_mapping(value: object, *, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise EphemeralCapabilityBlocked(
            f"{label} must be an object",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:response",
        )
    projected = json.loads(json.dumps(dict(value)))
    _assert_no_secret_response_fields(projected, label=label)
    return projected


def _assert_no_secret_response_fields(
    value: object,
    *,
    label: str,
) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            if (
                str(key) not in {"detailKeys", "errorKey"}
                and is_sensitive_key(key)
            ):
                raise EphemeralCapabilityBlocked(
                    f"{label} contains secret-bearing data",
                    resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:response",
                )
            _assert_no_secret_response_fields(item, label=label)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _assert_no_secret_response_fields(item, label=label)
        return
    if isinstance(value, str) and redact_text(value) != value:
        raise EphemeralCapabilityBlocked(
            f"{label} contains secret-bearing data",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:response",
        )


def _optional_scope_text(value: object, *, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise EphemeralCapabilityBlocked(
            f"{label} must be a string or null",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:scope",
        )
    return value


def _scope_count(value: object, *, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise EphemeralCapabilityBlocked(
            f"{label} must be a non-negative integer",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:scope",
        )
    return value


def _sanitize_lifecycle_scope(value: object) -> dict[str, Any]:
    scope = _json_safe_mapping(value, label="Mobile lifecycle scope")
    expected_fields = {
        "generation",
        "phase",
        "launchState",
        "activeStationPeerId",
        "activeActorPtid",
        "runtimeStationPeerId",
        "social",
        "group",
        "navigation",
    }
    if set(scope) != expected_fields:
        raise EphemeralCapabilityBlocked(
            "Mobile lifecycle scope has an invalid shape",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:scope",
        )
    generation = scope.get("generation")
    if (
        isinstance(generation, bool)
        or not isinstance(generation, int)
        or generation < 0
    ):
        raise EphemeralCapabilityBlocked(
            "Mobile lifecycle scope generation is invalid",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:scope",
        )
    launch_state = scope.get("launchState")
    phase = scope.get("phase")
    active_station_peer_id = scope.get("activeStationPeerId")
    if (
        not isinstance(launch_state, str)
        or not launch_state
        or not isinstance(phase, str)
        or not phase
        or not isinstance(active_station_peer_id, str)
    ):
        raise EphemeralCapabilityBlocked(
            "Mobile lifecycle scope identity is invalid",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:scope",
        )

    social = _json_safe_mapping(
        scope.get("social"),
        label="Mobile social scope",
    )
    group = _json_safe_mapping(
        scope.get("group"),
        label="Mobile group scope",
    )
    navigation = _json_safe_mapping(
        scope.get("navigation"),
        label="Mobile navigation scope",
    )
    detail_keys = navigation.get("detailKeys")
    primary_route_id = navigation.get("primaryRouteId")
    if (
        not isinstance(primary_route_id, str)
        or not isinstance(detail_keys, list)
        or any(not isinstance(item, str) for item in detail_keys)
    ):
        raise EphemeralCapabilityBlocked(
            "Mobile navigation scope is invalid",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:scope",
        )

    return {
        "generation": generation,
        "phase": phase,
        "launchState": launch_state,
        "activeStationPeerId": active_station_peer_id,
        "activeActorPtid": _optional_scope_text(
            scope.get("activeActorPtid"),
            label="Mobile active actor PTID",
        ),
        "runtimeStationPeerId": _optional_scope_text(
            scope.get("runtimeStationPeerId"),
            label="Mobile runtime Station peer ID",
        ),
        "social": {
            "stationPeerId": _optional_scope_text(
                social.get("stationPeerId"),
                label="Mobile social Station peer ID",
            ),
            "actorPtid": _optional_scope_text(
                social.get("actorPtid"),
                label="Mobile social actor PTID",
            ),
            "sessionCount": _scope_count(
                social.get("sessionCount"),
                label="Mobile social session count",
            ),
            "requestCount": _scope_count(
                social.get("requestCount"),
                label="Mobile social request count",
            ),
            "messageThreadCount": _scope_count(
                social.get("messageThreadCount"),
                label="Mobile social message-thread count",
            ),
        },
        "group": {
            "stationPeerId": _optional_scope_text(
                group.get("stationPeerId"),
                label="Mobile group Station peer ID",
            ),
            "actorPtid": _optional_scope_text(
                group.get("actorPtid"),
                label="Mobile group actor PTID",
            ),
            "groupCount": _scope_count(
                group.get("groupCount"),
                label="Mobile group count",
            ),
            "messageThreadCount": _scope_count(
                group.get("messageThreadCount"),
                label="Mobile group message-thread count",
            ),
        },
        "navigation": {
            "primaryRouteId": primary_route_id,
            "detailKeys": list(detail_keys),
        },
    }


class MobileSimulatorAppiumCapabilityHandler(EphemeralCapabilityHandler):
    """Keep simulator, Appium, build, and Station topology in the parent."""

    _ALLOWED_OPERATIONS = (
        "create_bound_session",
        "select_binding",
        "authenticate_fixture_actor",
        "begin_access_gate",
        "harness_action",
        "refresh_webview",
        "stop",
    )
    _CHILD_HARNESS_ACTIONS = STATION_LIFECYCLE_HARNESS_ACTIONS - {
        "native.deliverDeepLink",
        "projection.read",
        "station.add",
        "station.select",
        "access.submit",
    }

    def __init__(
        self,
        *,
        manifest: Mapping[str, Any],
        artifact_writer: Any,
        session_factory: Callable[[str], Any],
        harness_actions: Sequence[str],
        sensitive_values: Sequence[str] = (),
        verifier_source_digest: str | None = None,
    ) -> None:
        self._manifest = json.loads(json.dumps(dict(manifest)))
        self._artifact_writer = artifact_writer
        self._session_factory = session_factory
        self._harness_actions = frozenset(harness_actions)
        self._sensitive_values = tuple(
            dict.fromkeys(value for value in sensitive_values if value)
        )
        self._verifier_source_digest = verifier_source_digest or hashlib.sha256(
            Path(__file__).read_bytes()
        ).hexdigest()
        self._sessions: dict[str, Any] = {}
        self._session_order: list[str] = []
        self._known_services: dict[str, set[str]] = {}
        self._binding_generations: dict[str, int] = {}
        self._binding_proofs: dict[str, dict[str, dict[str, Any]]] = {}
        self._proof_refs: list[dict[str, Any]] = []
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return self._ALLOWED_OPERATIONS

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return self._sensitive_values

    @property
    def proof_refs(self) -> tuple[dict[str, Any], ...]:
        return tuple(self._proof_refs)

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        self._require_active(deadline_monotonic, cancellation)
        client_id = self._request_text(payload, "clientId")
        if operation == "create_bound_session":
            self._require_exact_fields(
                payload,
                {"clientId", "launchOptions"},
                operation,
            )
            launch_options = payload.get("launchOptions")
            if not isinstance(launch_options, Mapping) or launch_options:
                raise EphemeralCapabilityBlocked(
                    "Mobile simulator launch options have an invalid shape",
                    resource=(
                        f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                        "create_bound_session"
                    ),
                )
            return self._create_bound_session(
                client_id,
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )

        session = self._require_session(client_id)
        if operation == "select_binding":
            self._require_exact_fields(
                payload,
                {"clientId", "bindingRole"},
                operation,
            )
            return self._select_binding(
                client_id,
                self._request_text(payload, "bindingRole"),
                session=session,
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
        if operation == "authenticate_fixture_actor":
            self._require_exact_fields(payload, {"clientId"}, operation)
            value = self._authenticate_fixture_actor(
                client_id,
                session=session,
            )
            self._require_active(deadline_monotonic, cancellation)
            return {"clientId": client_id, "value": value}
        if operation == "begin_access_gate":
            self._require_exact_fields(payload, {"clientId"}, operation)
            value = self._begin_access_gate(session)
            self._require_active(deadline_monotonic, cancellation)
            return {"clientId": client_id, "value": value}
        if operation == "harness_action":
            self._require_exact_fields(
                payload,
                {"clientId", "action", "actionPayload"},
                operation,
            )
            action = self._request_text(payload, "action")
            if action not in self._CHILD_HARNESS_ACTIONS:
                raise EphemeralCapabilityBlocked(
                    "Mobile simulator Harness action is not child-callable",
                    resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
                )
            action_payload = payload.get("actionPayload")
            if not isinstance(action_payload, Mapping):
                raise EphemeralCapabilityBlocked(
                    "Mobile simulator Harness action payload must be an object",
                    resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
                )
            value = session.call_action(action, dict(action_payload))
            if action == "lifecycle.scope.read":
                value = _sanitize_lifecycle_scope(value)
            elif isinstance(value, Mapping):
                value = _json_safe_mapping(
                    value,
                    label=f"Mobile Harness action {action}",
                )
            elif value is not None:
                raise EphemeralCapabilityBlocked(
                    "Mobile simulator Harness action result must be an object",
                    resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
                )
            self._require_active(deadline_monotonic, cancellation)
            return {"clientId": client_id, "value": value}
        if operation == "refresh_webview":
            self._require_exact_fields(payload, {"clientId"}, operation)
            session.refresh_webview()
            session.switch_to_app_webview()
            session.require_harness(sorted(self._harness_actions))
            self._require_active(deadline_monotonic, cancellation)
            return {"clientId": client_id, "refreshed": True}
        if operation == "stop":
            self._require_exact_fields(payload, {"clientId"}, operation)
            self._stop_session(client_id)
            return {"clientId": client_id, "stopped": True}
        raise EphemeralCapabilityBlocked(
            "Mobile simulator Appium operation is not implemented",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{operation}",
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
                raise ValueError(
                    "Mobile simulator capability result must be an object"
                )
            expected_fields = {
                "create_bound_session": {
                    "clientId",
                    "launchGeneration",
                    "identity",
                    "scope",
                    "activeBindingRole",
                    "bindingProofs",
                },
                "select_binding": {
                    "clientId",
                    "bindingRole",
                    "launchGeneration",
                    "scope",
                    "bindingProof",
                    "remoteRevocation",
                },
                "authenticate_fixture_actor": {"clientId", "value"},
                "begin_access_gate": {"clientId", "value"},
                "harness_action": {"clientId", "value"},
                "refresh_webview": {"clientId", "refreshed"},
                "stop": {"clientId", "stopped"},
            }
            if (
                operation not in expected_fields
                or set(result) != expected_fields[operation]
            ):
                raise ValueError(
                    "Mobile simulator capability response has an invalid shape"
                )
            safe_projection = {
                key: value
                for key, value in result.items()
                if key not in {"bindingProof", "bindingProofs"}
            }
            self._assert_no_raw_authority(safe_projection)
        return projected

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason
        return self._stop_all(
            deadline_monotonic=deadline_monotonic,
            cancellation=threading.Event(),
        )

    def close(self) -> EphemeralHandlerCleanup:
        closed = self._stop_all(
            deadline_monotonic=time.monotonic() + 30.0,
            cancellation=threading.Event(),
        )
        return EphemeralHandlerCleanup(
            closed=closed,
            secrets_zeroized=True,
        )

    def _create_bound_session(
        self,
        client_id: str,
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        runtime = self._runtime_client(client_id)
        binding_roles = self._required_binding_roles(runtime, client_id)
        if client_id in self._sessions:
            raise EphemeralCapabilityBlocked(
                "Mobile simulator client already has an active session",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )

        generation = self._binding_generations.get(client_id, 0) + 1
        self._binding_generations[client_id] = generation
        session = self._session_factory(client_id)
        try:
            session.start()
            session.wait_for_ready()
            session.switch_to_app_webview()
            session.require_harness(sorted(self._harness_actions))
        except BaseException:
            try:
                session.stop()
            except BaseException:
                pass
            raise
        self._sessions[client_id] = session
        self._session_order.append(client_id)
        self._known_services.setdefault(client_id, set())

        raw_runtime_identity = {
            "clientId": client_id,
            "generation": generation,
            "provisioningRunId": self._manifest.get("runId"),
            "sessionId": str(getattr(session, "session_id", "")),
            "deviceIdentifier": str(
                getattr(getattr(session, "device", None), "identifier", "")
            ),
        }
        identity_digest = hashlib.sha256(
            json.dumps(
                raw_runtime_identity,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        runtime_identity = ClientRuntimeIdentity(
            runtime=str(runtime["runtime"]),
            instance_id=f"{client_id}-binding-{generation}",
            identity_digest=identity_digest,
        )

        proof_refs: dict[str, dict[str, Any]] = {}
        current_role = ""
        current_scope: dict[str, Any] | None = None
        try:
            for binding_role in binding_roles:
                current_role = binding_role
                current_scope, _ = self._activate_service(
                    client_id,
                    binding_role,
                    session=session,
                )
                proof_refs[binding_role] = self._persist_binding_proof(
                    client_id,
                    binding_role,
                    generation=generation,
                    runtime_identity=runtime_identity,
                    scope=current_scope,
                )

            initial_role = binding_roles[0]
            if current_role != initial_role:
                current_scope, _ = self._activate_service(
                    client_id,
                    initial_role,
                    session=session,
                )
            if current_scope is None or set(proof_refs) != set(binding_roles):
                raise EphemeralCapabilityBlocked(
                    "Mobile simulator binding proof closure is incomplete",
                    resource=(
                        f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}"
                    ),
                )
        except BaseException:
            self._stop_session(client_id, preserve_bindings=True)
            raise

        self._binding_proofs[client_id] = proof_refs
        self._require_active(deadline_monotonic, cancellation)
        return {
            "clientId": client_id,
            "launchGeneration": generation,
            "identity": {
                "runtime": runtime_identity.runtime,
                "instanceId": runtime_identity.instance_id,
                "identityDigest": runtime_identity.identity_digest,
            },
            "scope": current_scope,
            "activeBindingRole": binding_roles[0],
            "bindingProofs": proof_refs,
        }

    def _select_binding(
        self,
        client_id: str,
        binding_role: str,
        *,
        session: Any,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        scope, remote_revocation = self._activate_service(
            client_id,
            binding_role,
            session=session,
        )
        proof_ref = self._binding_proofs.get(client_id, {}).get(binding_role)
        generation = self._binding_generations.get(client_id, 0)
        if proof_ref is None or generation <= 0:
            raise EphemeralCapabilityBlocked(
                "Mobile simulator selected binding has no launch proof",
                resource=(
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                    f"{client_id}:{binding_role}"
                ),
            )
        self._require_active(deadline_monotonic, cancellation)
        return {
            "clientId": client_id,
            "bindingRole": binding_role,
            "launchGeneration": generation,
            "scope": scope,
            "bindingProof": proof_ref,
            "remoteRevocation": remote_revocation,
        }

    def _authenticate_fixture_actor(
        self,
        client_id: str,
        *,
        session: Any,
    ) -> dict[str, Any]:
        runtime = self._runtime_client(client_id)
        actor = str(runtime.get("actor") or "")
        account = ACTOR_ACCOUNTS.get(actor)
        if not account:
            raise EphemeralCapabilityBlocked(
                "Mobile simulator client actor is not in the Fixture",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        access = self._begin_access_gate(session)
        decision = _json_safe_mapping(
            access.get("decision"),
            label="Mobile Fixture access decision",
        )
        attempt_id = decision.get("attemptId")
        if not isinstance(attempt_id, str) or not attempt_id:
            raise EphemeralCapabilityBlocked(
                "Mobile Fixture access attempt identity is missing",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        login = _json_safe_mapping(
            session.call_action(
                "access.submit",
                {
                    "kind": "login",
                    "attemptId": attempt_id,
                    "email": account,
                    "password": ACTOR_PASSWORD,
                },
            ),
            label="Mobile Fixture login",
        )
        return {
            "preAuthenticationScope": access["scope"],
            "login": login,
        }

    @staticmethod
    def _begin_access_gate(session: Any) -> dict[str, Any]:
        started = _json_safe_mapping(
            session.call_action(
                "access.submit",
                {"kind": "start"},
            ),
            label="Mobile Fixture access start",
        )
        decision = _json_safe_mapping(
            started.get("decision"),
            label="Mobile Fixture access decision",
        )
        attempt_id = decision.get("attemptId")
        if not isinstance(attempt_id, str) or not attempt_id:
            raise EphemeralCapabilityBlocked(
                "Mobile Fixture access attempt identity is missing",
                resource=SIMULATOR_APPIUM_CAPABILITY_ID,
            )
        return {
            "decision": decision,
            "scope": _sanitize_lifecycle_scope(
                session.call_action("lifecycle.scope.read")
            ),
        }

    def _required_binding_roles(
        self,
        runtime: Mapping[str, Any],
        client_id: str,
    ) -> tuple[str, ...]:
        raw_roles = runtime.get("required_service_roles")
        if (
            not isinstance(raw_roles, list)
            or not raw_roles
            or any(not isinstance(role, str) for role in raw_roles)
        ):
            raise EphemeralCapabilityBlocked(
                "Mobile simulator client has no required binding roles",
                resource=(
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}"
                ),
            )
        return tuple(raw_roles)

    def _activate_service(
        self,
        client_id: str,
        binding_role: str,
        *,
        session: Any,
    ) -> tuple[dict[str, Any], str]:
        try:
            service_id, service = require_runtime_client_service(
                self._manifest,
                client_id,
                binding_role,
            )
        except ClientBindingError as error:
            raise EphemeralCapabilityBlocked(
                str(error),
                resource=f"client-binding:{error.code}",
            ) from error
        endpoint = str(service.get("endpoint") or "")
        expected_peer_id = str(service.get("runtimeIdentity") or "")
        if not endpoint or not expected_peer_id:
            raise EphemeralCapabilityBlocked(
                "Mobile simulator bound Station is missing runtime identity",
                resource=(
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                    f"{client_id}:{binding_role}"
                ),
            )

        known_services = self._known_services[client_id]
        remote_revocation = "not-required"
        if service_id in known_services:
            selection = session.call_action(
                "station.select",
                {"stationPeerId": expected_peer_id},
            )
            selected = _json_safe_mapping(
                selection,
                label="Mobile Station selection",
            )
            if selected.get("activeStationPeerId") != expected_peer_id:
                raise EphemeralCapabilityBlocked(
                    "Mobile Station selection did not activate the binding",
                    resource=(
                        f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                        f"{client_id}:{binding_role}"
                    ),
                )
            revocation = selected.get("sessionRevocation")
            projected_revocation = (
                revocation.get("remoteRevocation")
                if isinstance(revocation, Mapping)
                else None
            )
            if projected_revocation not in {
                "confirmed",
                "unconfirmed",
                "not-required",
            }:
                raise EphemeralCapabilityBlocked(
                    "Mobile Station selection revocation state is invalid",
                    resource=(
                        f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                        f"{client_id}:{binding_role}"
                    ),
                )
            remote_revocation = str(projected_revocation)
        else:
            addition = session.call_action("station.add", {"url": endpoint})
            added = _json_safe_mapping(
                addition,
                label="Mobile Station addition",
            )
            if (
                added.get("verifiedStationPeerId") != expected_peer_id
                or added.get("activeStationPeerId") != expected_peer_id
            ):
                raise EphemeralCapabilityBlocked(
                    "Mobile Station addition did not verify the binding",
                    resource=(
                        f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                        f"{client_id}:{binding_role}"
                    ),
                )
            known_services.add(service_id)

        scope = _sanitize_lifecycle_scope(
            session.call_action("lifecycle.scope.read")
        )
        if scope["activeStationPeerId"] != expected_peer_id:
            raise EphemeralCapabilityBlocked(
                "Mobile lifecycle scope does not match the bound Station",
                resource=(
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                    f"{client_id}:{binding_role}"
                ),
            )
        return scope, remote_revocation

    def _persist_binding_proof(
        self,
        client_id: str,
        binding_role: str,
        *,
        generation: int,
        runtime_identity: ClientRuntimeIdentity,
        scope: Mapping[str, Any],
    ) -> dict[str, Any]:
        try:
            proof = verify_client_binding_observation(
                self._manifest,
                evidence_run_id=self._artifact_writer.run_id,
                client_id=client_id,
                binding_role=binding_role,
                launch_generation=generation,
                client_runtime_identity=runtime_identity,
                observed_runtime_identity=str(scope["activeStationPeerId"]),
                proof_mechanism=SIMULATOR_BINDING_PROOF_MECHANISM,
                registered_mechanisms=frozenset(
                    {SIMULATOR_BINDING_PROOF_MECHANISM}
                ),
                verifier_id="mobile-simulator-runtime-binding",
                verifier_source_digest=self._verifier_source_digest,
            )
        except ClientBindingError as error:
            raise EphemeralCapabilityBlocked(
                str(error),
                resource=f"client-binding:{error.code}",
            ) from error
        proof_ref = self._artifact_writer.write_json(
            (
                "runtime/mobile-simulator/bindings/"
                f"{client_id}/{generation}/{binding_role}.json"
            ),
            proof.to_dict(),
            role=(
                "mobile-simulator-binding-proof/"
                f"{client_id}/{generation}/{binding_role}"
            ),
            redact=False,
        )
        serialized = proof_ref.to_dict()
        self._proof_refs.append(serialized)
        return serialized

    def _runtime_client(self, client_id: str) -> Mapping[str, Any]:
        clients = self._manifest.get("clients")
        if not isinstance(clients, list):
            raise EphemeralCapabilityBlocked(
                "Mobile simulator manifest clients are unavailable",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        client = next(
            (
                item
                for item in clients
                if isinstance(item, Mapping) and item.get("id") == client_id
            ),
            None,
        )
        if not isinstance(client, Mapping):
            raise EphemeralCapabilityBlocked(
                "Mobile simulator client is not declared",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        return client

    def _require_session(self, client_id: str) -> Any:
        session = self._sessions.get(client_id)
        if session is None:
            raise EphemeralCapabilityBlocked(
                "Mobile simulator Appium session is not active",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        return session

    def _stop_session(
        self,
        client_id: str,
        *,
        preserve_bindings: bool = False,
    ) -> None:
        session = self._require_session(client_id)
        session.stop()
        self._sessions.pop(client_id, None)
        if not preserve_bindings:
            self._known_services.pop(client_id, None)
            self._binding_proofs.pop(client_id, None)
        if client_id in self._session_order:
            self._session_order.remove(client_id)

    def _stop_all(
        self,
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> bool:
        failed = False
        for client_id in reversed(tuple(self._session_order)):
            if cancellation.is_set() or time.monotonic() >= deadline_monotonic:
                failed = True
                break
            try:
                self._stop_session(client_id)
            except BaseException:
                failed = True
        self._closed = True
        return not failed and not self._sessions

    def _require_active(
        self,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> None:
        if (
            self._closed
            or cancellation.is_set()
            or time.monotonic() >= deadline_monotonic
        ):
            raise EphemeralCapabilityBlocked(
                "Mobile simulator Appium capability is unavailable",
                resource=SIMULATOR_APPIUM_CAPABILITY_ID,
            )

    @staticmethod
    def _request_text(
        payload: Mapping[str, object],
        name: str,
    ) -> str:
        value = payload.get(name)
        if not isinstance(value, str) or not value or value.strip() != value:
            raise EphemeralCapabilityBlocked(
                f"Mobile simulator capability requires {name!r}",
                resource=SIMULATOR_APPIUM_CAPABILITY_ID,
            )
        return value

    @staticmethod
    def _require_exact_fields(
        payload: Mapping[str, object],
        fields: set[str],
        operation: str,
    ) -> None:
        if set(payload) != fields:
            raise EphemeralCapabilityBlocked(
                f"Mobile simulator {operation} payload has an invalid shape",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{operation}",
            )

    @staticmethod
    def _assert_no_raw_authority(value: object) -> None:
        forbidden_fields = {
            "artifact",
            "device",
            "deviceid",
            "endpoint",
            "serverurl",
            "serial",
            "udid",
            "url",
        }
        if isinstance(value, Mapping):
            for key, item in value.items():
                normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
                if normalized in forbidden_fields:
                    raise ValueError(
                        "Mobile simulator response exposes raw authority"
                    )
                MobileSimulatorAppiumCapabilityHandler._assert_no_raw_authority(
                    item
                )
        elif isinstance(value, (list, tuple)):
            for item in value:
                MobileSimulatorAppiumCapabilityHandler._assert_no_raw_authority(
                    item
                )


class MobileStationLifecycleSimulatorProvisioner(EnvironmentProvisioner):
    environment_id = STATION_LIFECYCLE_ENVIRONMENT_ID

    def __init__(
        self,
        contract: EnvironmentContract,
        *,
        base_factory: Any = MobileSimulatorProvisioner,
        overlay_path: Path | None = None,
        base_contract_path: Path | None = None,
        session_factory: Callable[[str], Any] | None = None,
    ) -> None:
        super().__init__(contract)
        self.base_factory = base_factory
        self.overlay_path = overlay_path or (
            ENVIRONMENTS_DIR / "mobile-station-lifecycle-simulator.yaml"
        )
        self.base_contract_path = base_contract_path or (
            ENVIRONMENTS_DIR / "mobile-simulator.yaml"
        )
        self.session_factory = session_factory
        self._base_manifest: MobileSimulatorRuntimeManifest | None = None
        self._overlay_spec: MobileStationLifecycleSimulatorSpec | None = None
        self._appium_handler: (
            MobileSimulatorAppiumCapabilityHandler | None
        ) = None
        self._appium_cleanup_registered = False

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            overlay = load_mobile_station_lifecycle_simulator_spec(
                self.overlay_path,
                base_path=self.base_contract_path,
            )
            self._overlay_spec = overlay
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            if profile_env.get("PT_STATION_MODE") != "remote":
                raise BlockedError(
                    reason=(
                        "Mobile Station lifecycle simulator requires "
                        "PT_STATION_MODE=remote"
                    ),
                    resource="profile:station-mode",
                )
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            service_specs = self._service_specs(profile_env)
            for service_id in STATION_LIFECYCLE_SERVICES:
                _, station_url, deployment_environment = service_specs[
                    service_id
                ]
                verify_reset_target(station_url, deployment_environment)

            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(profile_name, owner)
            for service_id in STATION_LIFECYCLE_SERVICES:
                self.acquire_remote_git_source_lease(
                    service_specs[service_id][2],
                    owner,
                )
            services = self._attest_services(
                manifest.run_id,
                service_specs,
            )
            manifest = dataclasses.replace(
                manifest,
                services=services,
                cleanup_registered=True,
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest

            if os.environ.get("MOBILE_ACCEPTANCE_RESET") != "1":
                raise BlockedError(
                    reason=(
                        "Mobile Station lifecycle Alice reset requires "
                        "MOBILE_ACCEPTANCE_RESET=1"
                    ),
                    resource="fixture-authorization:MOBILE_ACCEPTANCE_RESET",
                )

            base_contract = EnvironmentContract.from_yaml(
                self.base_contract_path
            )
            base = self.base_factory(base_contract)
            base.bind_evidence_run(self.evidence_run)
            self.register_cleanup("mobile-simulator-base", base.cleanup)
            base_manifest = base.provision(gate_id)
            if base_manifest.is_blocked():
                raise BlockedError(
                    reason=base_manifest.blocked_reason
                    or "Mobile simulator base provisioning was blocked",
                    resource=base_manifest.blocked_resource
                    or f"{self.environment_id}:base",
                )
            if not isinstance(base_manifest, MobileSimulatorRuntimeManifest):
                raise BlockedError(
                    reason=(
                        "Mobile Station lifecycle base did not return "
                        "simulator resources"
                    ),
                    resource=f"{self.environment_id}:base-manifest",
                )
            self._base_manifest = base_manifest

            actor_manifest_ref = self._prepare_actor_fixture(
                gate_id,
                service_specs,
                overlay,
            )
            base_clients = {
                client.profile: client for client in base_manifest.clients
            }
            contract_clients = {
                client.id: client for client in self.contract.clients
            }
            if set(base_clients) != set(contract_clients):
                raise BlockedError(
                    reason=(
                        "Mobile Station lifecycle base and overlay clients "
                        "do not match"
                    ),
                    resource=f"{self.environment_id}:clients",
                )
            clients = tuple(
                dataclasses.replace(
                    base_clients[client_id],
                    id=client_id,
                    actor=contract_clients[client_id].actor,
                    required_service_roles=(
                        contract_clients[client_id].required_service_roles
                    ),
                    service_bindings=(
                        contract_clients[client_id].service_bindings
                    ),
                )
                for client_id in ("sim-ios", "sim-android")
            )
            manifest = MobileSimulatorRuntimeManifest(
                artifact_kind=manifest.artifact_kind,
                environment_id=self.environment_id,
                gate_id=manifest.gate_id,
                run_id=manifest.run_id,
                created_at=manifest.created_at,
                state=ProvisioningState.PROVISIONED,
                source_worktree=manifest.source_worktree,
                source_commit=manifest.source_commit,
                workspace_digest=manifest.workspace_digest,
                profile_requested=profile_name,
                profile_resolved=profile_name,
                profile_slot=slot,
                services=services,
                actor_manifest_ref=actor_manifest_ref,
                credential_refs=base_manifest.credential_refs,
                clients=clients,
                cleanup_registered=True,
                cleanup_resources=self.contract.cleanup.resources,
                simulator_resources=self._public_simulator_resources(
                    base_manifest.simulator_resources,
                    overlay,
                ),
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (BlockedError, ProvisioningError, ValueError, OSError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=(
                        "Mobile Station lifecycle simulator provisioning "
                        f"failed: {error}"
                    ),
                    resource=f"{self.environment_id}:provisioning",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )

    def create_gate_launch_context(
        self,
        *,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
        required_capabilities: tuple[str, ...],
    ) -> EphemeralGateLaunchContext:
        if (
            gate_id != STATION_LIFECYCLE_GATE_ID
            or required_capabilities != (SIMULATOR_APPIUM_CAPABILITY_ID,)
        ):
            raise BlockedError(
                reason=(
                    "Mobile Station lifecycle Gate requires the exact "
                    "simulator Appium capability"
                ),
                resource=f"ephemeral-capabilities:{gate_id}",
            )
        if (
            not isinstance(self._manifest, MobileSimulatorRuntimeManifest)
            or not self._manifest.is_ready()
            or self._base_manifest is None
            or self._overlay_spec is None
            or evidence_run_id != self.evidence_run.run_id
            or provisioning_run_id != self._manifest.run_id
        ):
            raise BlockedError(
                reason=(
                    "Mobile Station lifecycle parent authorities are not ready"
                ),
                resource=f"ephemeral-capabilities:{gate_id}:run-identities",
            )
        handler = MobileSimulatorAppiumCapabilityHandler(
            manifest=self._manifest.to_dict(),
            artifact_writer=self.evidence_run,
            session_factory=(
                self.session_factory or self._new_appium_session
            ),
            harness_actions=self._overlay_spec.harness_actions,
            sensitive_values=self._raw_authority_values(),
        )
        context = EphemeralGateLaunchContext(
            required_capabilities=required_capabilities
        )
        context.register_capability(
            SIMULATOR_APPIUM_CAPABILITY_ID,
            handler,
        )
        self._appium_handler = handler
        if not self._appium_cleanup_registered:
            self.register_cleanup(
                "appium-sessions",
                self._cleanup_appium_sessions,
            )
            self._appium_cleanup_registered = True
        return context

    def _cleanup_appium_sessions(self) -> None:
        if self._appium_handler is None:
            return
        result = self._appium_handler.close()
        if not result.closed:
            raise ProvisioningError(
                "Mobile Station lifecycle Appium sessions did not close"
            )

    def _service_specs(
        self,
        profile_env: Mapping[str, str],
    ) -> dict[str, tuple[str, str, str]]:
        specs = {
            "station-primary": (
                "station",
                profile_env.get("PT_MOBILE_STATION_PRIMARY_URL", ""),
                profile_env.get(
                    "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV",
                    "",
                ),
            ),
            "station-secondary": (
                "station",
                profile_env.get("PT_MOBILE_STATION_SECONDARY_URL", ""),
                profile_env.get(
                    "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV",
                    "",
                ),
            ),
        }
        missing = [
            service_id
            for service_id in STATION_LIFECYCLE_SERVICES
            if not specs[service_id][1] or not specs[service_id][2]
        ]
        if missing:
            raise BlockedError(
                reason=(
                    "Mobile Station lifecycle profile is missing services: "
                    + ", ".join(missing)
                ),
                resource=(
                    "profile:mobile-station-lifecycle-simulator-services"
                ),
            )
        endpoints = {
            specs[service_id][1]
            for service_id in STATION_LIFECYCLE_SERVICES
        }
        deployments = {
            specs[service_id][2] for service_id in STATION_LIFECYCLE_SERVICES
        }
        if len(endpoints) != 2 or len(deployments) != 2:
            raise BlockedError(
                reason=(
                    "Mobile Station lifecycle profile must resolve two "
                    "distinct disposable Station targets"
                ),
                resource=(
                    "profile:mobile-station-lifecycle-simulator-services"
                ),
            )
        return specs

    def _attest_services(
        self,
        run_id: str,
        service_specs: Mapping[str, tuple[str, str, str]],
    ) -> dict[str, Any]:
        services: dict[str, Any] = {}
        for service_id in STATION_LIFECYCLE_SERVICES:
            service_kind, endpoint, deployment_environment = service_specs[
                service_id
            ]
            if service_kind != "station":
                raise BlockedError(
                    reason=(
                        f"Mobile lifecycle service {service_id!r} must be a "
                        "Station"
                    ),
                    resource=f"service-kind:{service_id}",
                )
            if not self._station_ready(endpoint):
                raise BlockedError(
                    reason=f"Required service {service_id!r} is unhealthy",
                    resource=f"service-health:{service_id}",
                )
            services[service_id] = produce_station_attestation(
                environment_id=self.environment_id,
                run_id=run_id,
                service_id=service_id,
                station_url=endpoint,
                profile_env={
                    "PT_STATION_MODE": "remote",
                    "PT_STATION_DEPLOY_ENV": deployment_environment,
                },
                require_runtime_identity=True,
            )
        runtime_identities = {
            service.runtime_identity for service in services.values()
        }
        if len(runtime_identities) != len(STATION_LIFECYCLE_SERVICES):
            raise BlockedError(
                reason=(
                    "Mobile Station lifecycle source attestations do not "
                    "identify two distinct Station runtimes"
                ),
                resource=f"{self.environment_id}:service-attestations",
            )
        return services

    def _prepare_actor_fixture(
        self,
        gate_id: str,
        service_specs: Mapping[str, tuple[str, str, str]],
        overlay: MobileStationLifecycleSimulatorSpec,
    ) -> dict[str, Any]:
        stations: dict[str, Any] = {}
        for service_id in STATION_LIFECYCLE_SERVICES:
            _, station_url, deployment_environment = service_specs[service_id]
            verify_reset_target(station_url, deployment_environment)
            reset_fixture(deployment_environment, ("alice",))
            self.register_cleanup(
                f"actor-fixture:{service_id}",
                partial(
                    self._reset_actor_fixture_target,
                    station_url,
                    deployment_environment,
                ),
            )
            actor = resolve_actor_identity(
                station_url,
                deployment_environment,
                "alice",
            )
            stations[service_id] = {
                "targetVerified": True,
                "actors": [
                    {
                        "role": actor.role,
                        "accountRef": actor.account_ref,
                        "ptid": actor.ptid,
                        "devicePolicy": actor.device_policy,
                    }
                ],
            }
        payload = {
            "artifactKind": (
                "mobile-station-lifecycle-simulator-actor-manifest"
            ),
            "environmentId": self.environment_id,
            "gateId": gate_id,
            "runId": self.evidence_run.run_id,
            "initialState": "ready",
            "stations": stations,
            "clients": [
                {
                    "id": client.id,
                    "actor": client.actor,
                    "bindingRoles": list(client.required_service_roles),
                }
                for client in self.contract.clients
            ],
            "reset": {
                "authorized": True,
                "targetVerified": True,
                "actors": ["alice"],
            },
            "proofScope": {
                key: list(value)
                for key, value in overlay.proof_scope.items()
            },
        }
        return self.evidence_run.write_json(
            "runtime/mobile-station-lifecycle-actors.json",
            payload,
        ).to_dict()

    @staticmethod
    def _reset_actor_fixture_target(
        station_url: str,
        deployment_environment: str,
    ) -> None:
        verify_reset_target(station_url, deployment_environment)
        reset_fixture(deployment_environment, ("alice",))

    @staticmethod
    def _public_simulator_resources(
        resources: Mapping[str, Any],
        overlay: MobileStationLifecycleSimulatorSpec,
    ) -> dict[str, Any]:
        appium = _required_object(
            resources,
            "appium",
            f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:base-appium",
        )
        drivers = _required_object(
            appium,
            "drivers",
            f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:base-drivers",
        )
        applications = _required_object(
            resources,
            "applications",
            f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:base-applications",
        )
        clients = _required_object(
            resources,
            "clients",
            f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:base-clients",
        )
        return {
            "appium": {
                "serverVersion": appium.get("serverVersion"),
                "expectedServerVersion": appium.get(
                    "expectedServerVersion"
                ),
                "drivers": {
                    platform: {
                        key: value
                        for key, value in _required_object(
                            drivers,
                            platform,
                            (
                                f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:"
                                f"driver:{platform}"
                            ),
                        ).items()
                        if key
                        in {
                            "identity",
                            "automationName",
                            "version",
                            "expectedVersion",
                        }
                    }
                    for platform in ("ios", "android")
                },
            },
            "applications": {
                platform: {
                    key: value
                    for key, value in _required_object(
                        applications,
                        platform,
                        (
                            f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:"
                            f"application:{platform}"
                        ),
                    ).items()
                    if key in {"id", "sha256", "callbackScheme"}
                }
                for platform in ("ios", "android")
            },
            "clients": {
                client_id: {
                    key: value
                    for key, value in _required_object(
                        clients,
                        client_id,
                        (
                            f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:"
                            f"client:{client_id}"
                        ),
                    ).items()
                    if key
                    in {
                        "platform",
                        "role",
                        "runtime",
                        "deviceRole",
                        "profile",
                    }
                }
                for client_id in ("sim-ios", "sim-android")
            },
            "harness": {
                "namespace": overlay.base.harness_namespace,
                "requiredActions": list(overlay.harness_actions),
            },
            "proofScope": {
                key: list(value)
                for key, value in overlay.proof_scope.items()
            },
        }

    def _raw_authority_values(self) -> tuple[str, ...]:
        if self._base_manifest is None:
            return ()
        resources = self._base_manifest.simulator_resources
        values: list[str] = []
        appium = resources.get("appium")
        if isinstance(appium, Mapping):
            server_url = appium.get("serverUrl")
            if isinstance(server_url, str) and server_url:
                values.append(server_url)
            drivers = appium.get("drivers")
            if isinstance(drivers, Mapping):
                for driver in drivers.values():
                    if isinstance(driver, Mapping):
                        executable = driver.get("chromedriverExecutable")
                        if isinstance(executable, str) and executable:
                            values.append(executable)
        chromedriver = resources.get("chromedriver")
        if isinstance(chromedriver, Mapping):
            executable = chromedriver.get("executable")
            if isinstance(executable, str) and executable:
                values.append(executable)
        applications = resources.get("applications")
        if isinstance(applications, Mapping):
            for application in applications.values():
                if isinstance(application, Mapping):
                    artifact = application.get("artifact")
                    if isinstance(artifact, str) and artifact:
                        values.append(artifact)
        clients = resources.get("clients")
        if isinstance(clients, Mapping):
            for client in clients.values():
                if isinstance(client, Mapping):
                    device = client.get("device")
                    if isinstance(device, str) and device:
                        values.append(device)
                    appium_capabilities = client.get("appiumCapabilities")
                    if isinstance(appium_capabilities, Mapping):
                        executable = appium_capabilities.get(
                            "appium:chromedriverExecutable"
                        )
                        if isinstance(executable, str) and executable:
                            values.append(executable)
        for service in self._manifest.services.values():
            values.append(service.endpoint)
        return tuple(dict.fromkeys(values))

    def _new_appium_session(self, client_id: str) -> Any:
        if self._base_manifest is None:
            raise BlockedError(
                reason="Mobile simulator base resources are unavailable",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        from tooling.acceptance.gates.mobile.simulator_e2e import (
            SimulatorAppiumSession,
            SimulatorBuildTarget,
            SimulatorDeviceTarget,
            UrllibAppiumTransport,
        )

        resources = self._base_manifest.simulator_resources
        appium = _required_object(
            resources,
            "appium",
            f"{SIMULATOR_APPIUM_CAPABILITY_ID}:appium",
        )
        clients = _required_object(
            resources,
            "clients",
            f"{SIMULATOR_APPIUM_CAPABILITY_ID}:clients",
        )
        client = _required_object(
            clients,
            client_id,
            f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
        )
        platform_name = _required_text(
            client,
            "platform",
            f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
        )
        drivers = _required_object(
            appium,
            "drivers",
            f"{SIMULATOR_APPIUM_CAPABILITY_ID}:drivers",
        )
        driver = _required_object(
            drivers,
            platform_name,
            f"{SIMULATOR_APPIUM_CAPABILITY_ID}:driver:{platform_name}",
        )
        applications = _required_object(
            resources,
            "applications",
            f"{SIMULATOR_APPIUM_CAPABILITY_ID}:applications",
        )
        application = _required_object(
            applications,
            platform_name,
            (
                f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                f"application:{platform_name}"
            ),
        )
        appium_capabilities = client.get("appiumCapabilities")
        chromedriver_executable = ""
        if isinstance(appium_capabilities, Mapping):
            value = appium_capabilities.get(
                "appium:chromedriverExecutable"
            )
            if isinstance(value, str):
                chromedriver_executable = value
        return SimulatorAppiumSession(
            UrllibAppiumTransport(
                _required_text(
                    appium,
                    "serverUrl",
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:server",
                )
            ),
            client_id=client_id,
            platform=platform_name,
            automation_name=_required_text(
                driver,
                "automationName",
                (
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                    f"driver:{platform_name}"
                ),
            ),
            device=SimulatorDeviceTarget(
                platform=platform_name,
                identifier=_required_text(
                    client,
                    "device",
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
                ),
                role=_required_text(
                    client,
                    "deviceRole",
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
                ),
            ),
            build=SimulatorBuildTarget(
                platform=platform_name,
                artifact=Path(
                    _required_text(
                        application,
                        "artifact",
                        (
                            f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                            f"application:{platform_name}"
                        ),
                    )
                ),
                application_id=_required_text(
                    application,
                    "id",
                    (
                        f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                        f"application:{platform_name}"
                    ),
                ),
            ),
            callback_scheme=_required_text(
                application,
                "callbackScheme",
                (
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:"
                    f"application:{platform_name}"
                ),
            ),
            ports={
                str(role): int(port)
                for role, port in _required_object(
                    client,
                    "ports",
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
                ).items()
            },
            chromedriver_executable=chromedriver_executable,
        )


class MobileSocialSimulatorProvisioner(EnvironmentProvisioner):
    environment_id = "mobile-social-simulator"

    def __init__(
        self,
        contract: EnvironmentContract,
        *,
        base_factory: Any = MobileSimulatorProvisioner,
        overlay_path: Path | None = None,
        station_profiles: Mapping[str, str] | None = None,
        service_profiles: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(contract)
        self.base_factory = base_factory
        self.overlay_path = overlay_path or (
            ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        )
        self._station_profiles = dict(station_profiles or {})
        self._service_profiles = dict(service_profiles or {})

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        base: MobileSimulatorProvisioner | None = None
        try:
            overlay = self._load_overlay()
            if os.environ.get("MOBILE_ACCEPTANCE_RESET") != "1":
                raise BlockedError(
                    reason=(
                        "Mobile social simulator actor reset requires "
                        "MOBILE_ACCEPTANCE_RESET=1"
                    ),
                    resource=(
                        "fixture-authorization:MOBILE_ACCEPTANCE_RESET"
                    ),
                )
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            if profile_env.get("PT_STATION_MODE") != "remote":
                raise BlockedError(
                    reason=(
                        "Mobile social simulator requires PT_STATION_MODE=remote"
                    ),
                    resource="profile:station-mode",
                )
            profile_env = self._inject_station_profile_bindings(profile_env)
            profile_env = self._inject_service_profile_bindings(profile_env)
            service_specs = self._service_specs(profile_env)
            for service_id in ("station-primary", "station-secondary"):
                _, station_url, deployment_environment, _ = service_specs[
                    service_id
                ]
                verify_reset_target(station_url, deployment_environment)
            owner = f"acceptance:{gate_id}:{self._manifest.run_id}"
            profile_leases = {profile_name}
            profile_leases.update(self._required_station_profiles().values())
            profile_leases.update(self._required_service_profiles().values())
            for leased_profile in sorted(profile_leases):
                self.acquire_profile_lease(leased_profile, owner)
            for deployment_environment in {
                values[2] for values in service_specs.values()
            }:
                self.acquire_remote_git_source_lease(
                    deployment_environment,
                    owner,
                )
            services = self._attest_services(
                self._manifest.run_id,
                service_specs,
                profile_env,
            )

            base_contract = EnvironmentContract.from_yaml(
                ENVIRONMENTS_DIR / "mobile-simulator.yaml"
            )
            base = self.base_factory(base_contract)
            base.bind_evidence_run(self.evidence_run)
            self.register_cleanup("mobile-simulator-base", base.cleanup)
            base_manifest = base.provision(gate_id)
            if base_manifest.is_blocked():
                raise BlockedError(
                    reason=base_manifest.blocked_reason
                    or "Mobile simulator base provisioning was blocked",
                    resource=base_manifest.blocked_resource
                    or "mobile-social-simulator:base",
                )

            actor_manifest_ref = self._prepare_actor_fixture(
                gate_id,
                profile_env,
                overlay,
            )
            contract_clients = {
                client.id: client for client in self.contract.clients
            }
            clients = tuple(
                dataclasses.replace(
                    client,
                    id=client_id,
                    actor=contract_clients[client_id].actor,
                    required_service_roles=(
                        contract_clients[client_id].required_service_roles
                    ),
                    service_bindings=(
                        contract_clients[client_id].service_bindings
                    ),
                )
                for client_id, client in zip(
                    ("sim-ios", "sim-android"),
                    base_manifest.clients,
                )
            )
            resources = dict(
                getattr(base_manifest, "simulator_resources", {})
            )
            resources["harness"] = {
                "namespace": overlay["harness"]["namespace"],
                "requiredActions": list(
                    overlay["harness"]["required_actions"]
                ),
            }
            resources["proofScope"] = {
                "proves": list(overlay["proof_scope"]["proves"]),
                "doesNotProve": list(
                    overlay["proof_scope"]["does_not_prove"]
                ),
            }
            resources["clientAssignments"] = {
                client.id: {
                    "actor": client.actor,
                    "serviceId": client.service_bindings[
                        "station"
                    ].service_id,
                }
                for client in self.contract.clients
            }
            manifest = MobileSimulatorRuntimeManifest(
                **{
                    field.name: (
                        self.environment_id
                        if field.name == "environment_id"
                        else ProvisioningState.PROVISIONED
                        if field.name == "state"
                        else profile_name
                        if field.name in {
                            "profile_requested",
                            "profile_resolved",
                        }
                        else slot
                        if field.name == "profile_slot"
                        else services
                        if field.name == "services"
                        else actor_manifest_ref
                        if field.name == "actor_manifest_ref"
                        else clients
                        if field.name == "clients"
                        else self.contract.cleanup.resources
                        if field.name == "cleanup_resources"
                        else getattr(base_manifest, field.name)
                    )
                    for field in dataclasses.fields(RuntimeManifest)
                },
                simulator_resources=resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (BlockedError, ProvisioningError, ValueError, OSError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Mobile social simulator provisioning failed: {error}",
                    resource="mobile-social-simulator:provisioning",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )

    def _load_overlay(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.overlay_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BlockedError(
                reason=(
                    "Cannot load Mobile social simulator environment contract"
                ),
                resource="mobile-social-simulator:environment",
            ) from error
        if (
            not isinstance(payload, dict)
            or payload.get("id") != self.environment_id
            or payload.get("base_environment") != "mobile-simulator"
        ):
            raise BlockedError(
                reason="Mobile social simulator environment identity is invalid",
                resource="mobile-social-simulator:environment",
            )
        harness = payload.get("harness")
        proof_scope = payload.get("proof_scope")
        if (
            not isinstance(harness, dict)
            or not isinstance(harness.get("namespace"), str)
            or not isinstance(harness.get("required_actions"), list)
            or not isinstance(proof_scope, dict)
            or not isinstance(proof_scope.get("proves"), list)
            or not isinstance(proof_scope.get("does_not_prove"), list)
        ):
            raise BlockedError(
                reason="Mobile social simulator overlay is incomplete",
                resource="mobile-social-simulator:environment",
            )
        return payload

    def _required_station_profiles(self) -> dict[str, str]:
        if not self._station_profiles:
            return {}
        expected = set(MOBILE_SOCIAL_STATION_PROFILE_KEYS)
        provided = set(self._station_profiles)
        missing = sorted(expected - provided)
        unexpected = sorted(provided - expected)
        if missing or unexpected:
            detail = []
            if missing:
                detail.append(f"missing={','.join(missing)}")
            if unexpected:
                detail.append(f"unexpected={','.join(unexpected)}")
            raise BlockedError(
                reason=(
                    "Mobile social simulator Station profiles must be "
                    "specified at run time with --station-profile "
                    f"SERVICE_ID=PROFILE ({'; '.join(detail)})"
                ),
                resource="station-profile-bindings",
            )
        invalid = sorted(
            profile_name
            for profile_name in self._station_profiles.values()
            if not PROFILE_NAME_PATTERN.fullmatch(profile_name)
        )
        if invalid:
            raise BlockedError(
                reason=f"Invalid Station profile name: {invalid[0]!r}",
                resource="station-profile-bindings",
            )
        duplicates = sorted(
            profile_name
            for profile_name in set(self._station_profiles.values())
            if list(self._station_profiles.values()).count(profile_name) > 1
        )
        if duplicates:
            raise BlockedError(
                reason=(
                    "Distinct Mobile Station services require distinct runtime "
                    f"profiles; duplicate={duplicates[0]!r}"
                ),
                resource="station-profile-bindings",
            )
        return dict(self._station_profiles)

    def _required_service_profiles(self) -> dict[str, str]:
        if not self._service_profiles:
            return {}
        expected = set(MOBILE_SOCIAL_SERVICE_PROFILE_KEYS)
        provided = set(self._service_profiles)
        missing = sorted(expected - provided)
        unexpected = sorted(provided - expected)
        if missing or unexpected:
            detail = []
            if missing:
                detail.append(f"missing={','.join(missing)}")
            if unexpected:
                detail.append(f"unexpected={','.join(unexpected)}")
            raise BlockedError(
                reason=(
                    "Mobile social service profiles must be specified at run "
                    "time with --service-profile SERVICE_ID=PROFILE "
                    f"({'; '.join(detail)})"
                ),
                resource="service-profile-bindings",
            )
        profile_name = self._service_profiles["relay"]
        if not PROFILE_NAME_PATTERN.fullmatch(profile_name):
            raise BlockedError(
                reason=f"Invalid service profile name: {profile_name!r}",
                resource="service-profile-bindings",
            )
        return dict(self._service_profiles)

    def _inject_station_profile_bindings(
        self,
        profile_env: Mapping[str, str],
    ) -> dict[str, str]:
        merged = dict(profile_env)
        for service_id, profile_name in self._required_station_profiles().items():
            profile_path = (
                REPO_ROOT
                / ".local"
                / "dev"
                / "profiles"
                / f"{profile_name}.env"
            )
            if not profile_path.is_file():
                raise BlockedError(
                    reason=(
                        f"Mobile social service {service_id!r} requires runtime "
                        f"profile {profile_name!r}"
                    ),
                    resource=f"service-profile:{service_id}",
                )
            station_env = load_env_file(profile_path)
            declared_profile = station_env.get("PT_DEV_PROFILE", "").strip()
            if declared_profile != profile_name:
                raise BlockedError(
                    reason=(
                        f"Station profile {profile_name!r} declares "
                        f"PT_DEV_PROFILE={declared_profile!r}"
                    ),
                    resource=f"service-profile:{service_id}",
                )
            if station_env.get("PT_STATION_MODE", "").strip() != "remote":
                raise BlockedError(
                    reason=(
                        f"Mobile social service {service_id!r} requires a "
                        "remote Station profile"
                    ),
                    resource=f"service-profile:{service_id}",
                )
            station_url = station_env.get("PT_STATION_URL", "").rstrip("/")
            deployment_environment = station_env.get(
                "PT_STATION_DEPLOY_ENV",
                "",
            ).strip()
            if not station_url or not deployment_environment:
                raise BlockedError(
                    reason=(
                        f"Station profile {profile_name!r} has no complete "
                        "endpoint/deployment binding"
                    ),
                    resource=f"service-profile:{service_id}",
                )
            url_key, deployment_key = MOBILE_SOCIAL_STATION_PROFILE_KEYS[
                service_id
            ]
            merged[url_key] = station_url
            merged[deployment_key] = deployment_environment
        return merged

    def _inject_service_profile_bindings(
        self,
        profile_env: Mapping[str, str],
    ) -> dict[str, str]:
        merged = dict(profile_env)
        for service_id, profile_name in self._required_service_profiles().items():
            profile_path = (
                REPO_ROOT
                / ".local"
                / "dev"
                / "profiles"
                / f"{profile_name}.env"
            )
            if not profile_path.is_file():
                raise BlockedError(
                    reason=(
                        f"Mobile social service {service_id!r} requires runtime "
                        f"profile {profile_name!r}"
                    ),
                    resource=f"service-profile:{service_id}",
                )
            service_env = load_env_file(profile_path)
            declared_profile = service_env.get("PT_DEV_PROFILE", "").strip()
            if declared_profile != profile_name:
                raise BlockedError(
                    reason=(
                        f"Service profile {profile_name!r} declares "
                        f"PT_DEV_PROFILE={declared_profile!r}"
                    ),
                    resource=f"service-profile:{service_id}",
                )
            if service_env.get("PT_RELAY_MODE", "").strip() != "remote":
                raise BlockedError(
                    reason=(
                        f"Mobile social service {service_id!r} requires a "
                        "remote Relay profile"
                    ),
                    resource=f"service-profile:{service_id}",
                )
            service_url = service_env.get("PT_RELAY_URL", "").rstrip("/")
            deployment_environment = service_env.get(
                "PT_RELAY_DEPLOY_ENV",
                "",
            ).strip()
            if not service_url or not deployment_environment:
                raise BlockedError(
                    reason=(
                        f"Service profile {profile_name!r} has no complete "
                        "Relay endpoint/deployment binding"
                    ),
                    resource=f"service-profile:{service_id}",
                )
            url_key, deployment_key = MOBILE_SOCIAL_SERVICE_PROFILE_KEYS[
                service_id
            ]
            merged[url_key] = service_url
            merged[deployment_key] = deployment_environment
            health_url = service_env.get("PT_RELAY_HEALTH_URL", "").strip()
            if health_url:
                merged["PT_RELAY_HEALTH_URL"] = health_url
        return merged

    def _service_specs(
        self,
        profile_env: Mapping[str, str],
    ) -> dict[str, tuple[str, str, str, str]]:
        specs = {
            "station-primary": (
                "station",
                profile_env.get("PT_MOBILE_STATION_PRIMARY_URL", ""),
                profile_env.get(
                    "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV",
                    "",
                ),
                "station-deployment",
            ),
            "station-secondary": (
                "station",
                profile_env.get("PT_MOBILE_STATION_SECONDARY_URL", ""),
                profile_env.get(
                    "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV",
                    "",
                ),
                "station-deployment",
            ),
            "relay": (
                "relay",
                profile_env.get("PT_RELAY_URL", ""),
                profile_env.get("PT_RELAY_DEPLOY_ENV", ""),
                "relay-deployment",
            ),
        }
        missing = [
            service_id
            for service_id, values in specs.items()
            if not values[1] or not values[2]
        ]
        if missing:
            raise BlockedError(
                reason=(
                    "Mobile social simulator profile is missing services: "
                    + ", ".join(missing)
                ),
                resource="profile:mobile-social-simulator-services",
            )
        station_specs = [
            specs[service_id]
            for service_id in MOBILE_SOCIAL_STATION_PROFILE_KEYS
        ]
        if (
            len({values[1] for values in station_specs}) != len(station_specs)
            or len({values[2] for values in station_specs}) != len(station_specs)
        ):
            raise BlockedError(
                reason=(
                    "Mobile social simulator requires distinct Station targets"
                ),
                resource="profile:mobile-social-simulator-services",
            )
        return specs

    def _attest_services(
        self,
        run_id: str,
        service_specs: Mapping[str, tuple[str, str, str, str]],
        profile_env: Mapping[str, str],
    ) -> dict[str, Any]:
        services: dict[str, Any] = {}
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
                    reason=f"Required service {service_id!r} is unhealthy",
                    resource=f"service-health:{service_id}",
                )
            if service_kind == "station":
                attestation = produce_station_attestation(
                    environment_id=self.environment_id,
                    run_id=run_id,
                    service_id=service_id,
                    station_url=endpoint,
                    profile_env={
                        "PT_STATION_MODE": "remote",
                        "PT_STATION_DEPLOY_ENV": deployment_environment,
                    },
                    require_runtime_identity=True,
                    remote_source_identity_provider=resolve_remote_source_identity,
                )
            else:
                attestation = produce_service_attestation(
                    environment_id=self.environment_id,
                    run_id=run_id,
                    service_id=service_id,
                    service_kind=service_kind,
                    endpoint=endpoint,
                    mode="remote",
                    deployment_environment=deployment_environment,
                    producer=producer,
                    require_runtime_identity=True,
                    remote_source_identity_provider=resolve_remote_source_identity,
                )
            services[service_id] = attestation
        return services

    def _prepare_actor_fixture(
        self,
        gate_id: str,
        profile_env: Mapping[str, str],
        overlay: Mapping[str, Any],
    ) -> dict[str, Any]:
        if os.environ.get("MOBILE_ACCEPTANCE_RESET") != "1":
            raise BlockedError(
                reason=(
                    "Mobile social simulator actor reset requires "
                    "MOBILE_ACCEPTANCE_RESET=1"
                ),
                resource="fixture-authorization:MOBILE_ACCEPTANCE_RESET",
            )
        stations: dict[str, Any] = {}
        station_inputs = {
            "station-primary": (
                profile_env["PT_MOBILE_STATION_PRIMARY_URL"],
                profile_env["PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV"],
            ),
            "station-secondary": (
                profile_env["PT_MOBILE_STATION_SECONDARY_URL"],
                profile_env["PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV"],
            ),
        }
        for service_id, (station_url, deployment_environment) in (
            station_inputs.items()
        ):
            verify_reset_target(station_url, deployment_environment)
            reset_fixture(deployment_environment, ("alice", "bob"))
            self.register_cleanup(
                f"actor-fixture:{service_id}",
                lambda station_url=station_url, deployment_environment=deployment_environment: self._reset_actor_fixture_target(
                    station_url,
                    deployment_environment,
                ),
            )
            actors = [
                resolve_actor_identity(
                    station_url,
                    deployment_environment,
                    role,
                )
                for role in ("alice", "bob")
            ]
            stations[service_id] = {
                "targetVerified": True,
                "actors": [
                    {
                        "role": actor.role,
                        "accountRef": actor.account_ref,
                        "ptid": actor.ptid,
                        "devicePolicy": actor.device_policy,
                        "federatedHandle": actor.federated_handle,
                        "homeStationPeerId": actor.home_station_peer_id,
                    }
                    for actor in actors
                ],
            }
        selected_actor_routes = (
            next(
                actor
                for actor in stations["station-primary"]["actors"]
                if actor["role"] == "alice"
            ),
            next(
                actor
                for actor in stations["station-secondary"]["actors"]
                if actor["role"] == "bob"
            ),
        )
        federation_id = fixture_federation_id_from_station_ids(
            actor["homeStationPeerId"] for actor in selected_actor_routes
        )
        for station in stations.values():
            for actor in station["actors"]:
                actor["federationId"] = federation_id
        payload = {
            "artifactKind": "mobile-social-simulator-actor-manifest",
            "environmentId": self.environment_id,
            "gateId": gate_id,
            "runId": self.evidence_run.run_id,
            "initialState": "ready",
            "stations": stations,
            "clients": [
                {
                    "id": client.id,
                    "actor": client.actor,
                    "serviceId": client.service_bindings[
                        "station"
                    ].service_id,
                }
                for client in self.contract.clients
            ],
            "reset": {
                "authorized": True,
                "targetVerified": True,
            },
            "proofScope": dict(overlay["proof_scope"]),
        }
        return self.evidence_run.write_json(
            "runtime/mobile-social-simulator-actors.json",
            payload,
        ).to_dict()

    @staticmethod
    def _reset_actor_fixture_target(
        station_url: str,
        deployment_environment: str,
    ) -> None:
        verify_reset_target(station_url, deployment_environment)
        reset_fixture(deployment_environment, ("alice", "bob"))
