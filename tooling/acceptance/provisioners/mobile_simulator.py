from __future__ import annotations

import base64
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
    ArtifactRef,
    BlockedError,
    ClientBindingError,
    ClientRuntimeIdentity,
    ClientRuntime,
    EnvironmentClient,
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
    commits_match,
    produce_service_attestation,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.provisioner import (
    load_env_file,
    resolve_machine_profile_environment,
    resolve_reviewed_profile_environment,
)
from tooling.acceptance.core.redaction import (
    is_sensitive_key,
    redact_text,
    redact_value,
)
from tooling.acceptance.core.reset_authority import (
    require_station_reset_authority,
    station_reset_authorization_ref,
)
from tooling.acceptance.fixtures.chat_native_actors import (
    ACTOR_ACCOUNTS,
    ACTOR_PASSWORD,
    prepare_bound_friendships,
    prepare_federation_contexts,
    reset_fixture,
    resolve_actor_identity,
    verify_reset_target,
)
from tooling.acceptance.fixtures.chat_native_reset import (
    fixture_federation_id_from_station_ids,
)
from tooling.acceptance.gates.mobile.simulator_harness_contract import (
    CHAT_MIXED_NATIVE_CHILD_HARNESS_ACTIONS,
    CHAT_MIXED_NATIVE_GATE_IDS,
    STATION_ACCESS_NATIVE_CHILD_HARNESS_ACTIONS,
    STATION_ACCESS_NATIVE_GATE_IDS,
    STATION_LIFECYCLE_CHILD_HARNESS_ACTIONS,
)
from tooling.acceptance.provisioners.mobile_service_bindings import (
    MobileServiceBinding,
    resolve_mobile_service_bindings,
)
from tooling.acceptance.provisioners.mobile_native_build import (
    MobileNativeBuildError,
    SourceIdentity,
    canonical_build_inputs_digest,
    canonical_json_bytes,
    canonical_value_digest,
    create_build_identity,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
    resolve_windows_service_version,
)


IOS_RUNTIME = "iOS 26.5"
IOS_DEVICE_NAME = "iPhone 17"
IOS_PEER_DEVICE_NAME = "iPhone 17 Pro Max"
IOS_LAYOUT_ENVIRONMENT_ID = "mobile-ios-layout-simulator"
STATION_LIFECYCLE_ENVIRONMENT_ID = "mobile-station-lifecycle-simulator"
DIRECT_SIMULATOR_ENVIRONMENT_ID = "mobile-direct-simulator"
CHAT_MIXED_NATIVE_ENVIRONMENT_ID = "chat-mixed-native"
STATION_ACCESS_NATIVE_ENVIRONMENT_ID = "station-access-native"
STATION_LIFECYCLE_GATE_ID = "mobile-simulator-station-lifecycle-e2e"
STATION_SETTINGS_GATE_ID = "mobile-simulator-settings-e2e"
STATION_BOUND_SIMULATOR_GATE_IDS = frozenset(
    {
        STATION_LIFECYCLE_GATE_ID,
        STATION_SETTINGS_GATE_ID,
    }
)
SIMULATOR_APPIUM_CAPABILITY_ID = "mobile.simulator.appium-session"
SIMULATOR_CAPABILITY_TIMEOUT_SECONDS = 180.0
SIMULATOR_BINDING_PROOF_MECHANISM = (
    "mobile-simulator-active-station-peer-id"
)
MOBILE_LIFECYCLE_SCOPE_FIELDS = frozenset(
    {
        "generation",
        "phase",
        "launchState",
        "activeStationPeerId",
        "activeActorPtid",
        "runtimeStationPeerId",
        "deviceId",
        "social",
        "group",
        "navigation",
    }
)
CHAT_MIXED_NATIVE_HARNESS_ACTIONS = (
    CHAT_MIXED_NATIVE_CHILD_HARNESS_ACTIONS
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
MOBILE_DIRECT_STATION_PROFILE_KEYS = {
    "station": (
        "PT_MOBILE_DIRECT_STATION_URL",
        "PT_MOBILE_DIRECT_STATION_DEPLOY_ENV",
    ),
}
PROFILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
GIT_COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")
SELECTED_BUILD_ENVIRONMENT_KEYS = frozenset(
    {
        "ANDROID_HOME",
        "ANDROID_SDK_ROOT",
        "CARGO_HOME",
        "CARGO_TARGET_DIR",
        "DEVELOPER_DIR",
        "GRADLE_USER_HOME",
        "HOME",
        "JAVA_HOME",
        "MOBILE_TAURI_STATIC_BUNDLE_BUILD",
        "NDK_HOME",
        "PATH",
        "RUSTUP_HOME",
        "SDKROOT",
        "TARGET_RANLIB",
        "TMPDIR",
        "VITE_ACCEPTANCE_HARNESS",
    }
)


IOS_LAYOUT_CLIENTS = {
    "sim-ios-current": (
        "iPhone 17",
        "current",
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
IOS_WEB_ASSETS_RELATIVE_PATH = Path(
    "apps/mobile/src-tauri/gen/apple/assets"
)
MOBILE_WEB_DIST_RELATIVE_PATH = Path("apps/mobile/dist")
ANDROID_DEEP_LINK_MARKER = (
    "<!-- DEEP LINK PLUGIN. AUTO-GENERATED. DO NOT REMOVE. -->"
)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
VERSION_PATTERN = re.compile(r"(?<!\d)(\d+)(?:\.\d+){1,3}(?!\d)")
EXPECTED_CLIENTS = {
    "sim-ios": ("ios", "primary-simulator", "tauri-ios-simulator"),
    "sim-ios-peer": ("ios", "peer-simulator", "tauri-ios-simulator"),
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
    "lifecycle.waitReady",
    "lifecycle.suspend",
    "lifecycle.resume",
    "lifecycle.restart",
    "navigation.snapshot",
    "navigation.apply",
    "platform.permission.check",
    "platform.permission.request",
    "platform.permission.checkAll",
    "platform.network.read",
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
    "settings.profile.read",
    "settings.profile.update",
    "settings.notifications.read",
    "settings.notifications.update",
    "settings.device.read",
    "settings.device.update",
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


class _GeneratedAppleAssetsGuard:
    def __init__(self, path: Path, backup_path: Path) -> None:
        self.path = path
        self.backup_path = backup_path
        self._staged = False
        self._had_original = False
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise BlockedError(
                reason="Generated Apple assets path is not a directory",
                resource="mobile-simulator:ios-web-assets",
            )
        if path.exists():
            self._reject_symlinks(path, "existing generated Apple assets")
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(path, backup_path)
            self._had_original = True

    def stage(self, source: Path) -> None:
        if source.is_symlink() or not source.is_dir():
            raise BlockedError(
                reason="Mobile web build output is unavailable",
                resource="mobile-simulator:ios-web-assets",
            )
        if not (source / "index.html").is_file():
            raise BlockedError(
                reason="Mobile web build output has no index.html",
                resource="mobile-simulator:ios-web-assets",
            )
        self._reject_symlinks(source, "Mobile web build output")
        self._staged = True
        self._remove_path()
        shutil.copytree(source, self.path)

    def restore(self) -> None:
        if not self._staged:
            return
        self._remove_path()
        if self._had_original:
            shutil.copytree(self.backup_path, self.path)
        self._staged = False

    def _remove_path(self) -> None:
        if self.path.is_symlink() or self.path.is_file():
            self.path.unlink()
        elif self.path.exists():
            shutil.rmtree(self.path)

    @staticmethod
    def _reject_symlinks(path: Path, label: str) -> None:
        if any(child.is_symlink() for child in path.rglob("*")):
            raise BlockedError(
                reason=f"{label} contains a symlink",
                resource="mobile-simulator:ios-web-assets",
            )


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
    ios_peer_device_name: str
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
    ios_peer_device_name = _required_text(
        ios_selector,
        "peer_device_name",
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
        or ios_peer_device_name != IOS_PEER_DEVICE_NAME
        or android_avd_name != ANDROID_AVD_NAME
        or android_abi != ANDROID_ABI
    ):
        raise BlockedError(
            reason=(
                "Mobile simulator selectors must remain pinned to "
                f"{IOS_RUNTIME}/{IOS_DEVICE_NAME}/{IOS_PEER_DEVICE_NAME} and "
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
                "Mobile simulator clients must be the isolated sim-ios and "
                "sim-ios-peer clients with iOS simulator-only runtime kinds"
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
        ios_peer_device_name=ios_peer_device_name,
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
    if actual_clients != IOS_LAYOUT_CLIENTS or len(clients) != 1:
        raise BlockedError(
            reason=(
                "Mobile iOS layout clients must pin the current iPhone 17 cell"
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
    if contract.profile.required or contract.profile.identity_match:
        raise BlockedError(
            reason=(
                "Mobile Station lifecycle environment must use run-time "
                "service injection instead of an active profile"
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
        != station_reset_authorization_ref(
            "mobile-station-lifecycle-alice"
        )
    ):
        raise BlockedError(
            reason=(
                "Mobile Station lifecycle environment requires the "
                "authorized Alice-only fixture"
            ),
            resource=f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:fixture",
        )

    clients = {client.id: client for client in contract.clients}
    if set(clients) != {"sim-ios", "sim-ios-peer"}:
        raise BlockedError(
            reason=(
                "Mobile Station lifecycle environment requires exactly the "
                "sim-ios and sim-ios-peer clients"
            ),
            resource=f"{STATION_LIFECYCLE_ENVIRONMENT_ID}:clients",
        )
    expected_roles = {
        "sim-ios": ("station-primary", "station-secondary"),
        "sim-ios-peer": ("station-primary",),
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
        (
            "MS-J06 independent second-iOS-simulator Profile and Notification "
            "convergence with device-local settings isolation"
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
                "the declared simulator AS-04, AS-10, and MS-J06 slices"
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
            manifest = self._preflighted(
                self._manifest,
                profile_name="mobile-simulator",
                slot=0,
            )
            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease("mobile-simulator", owner)

            runtime_root = self.runtime_base / manifest.run_id
            runtime_root.mkdir(parents=True, exist_ok=False)
            self.register_cleanup(
                "storage:mobile-simulator",
                lambda: shutil.rmtree(runtime_root),
            )
            apple_assets_guard = _GeneratedAppleAssetsGuard(
                self.repo_root / IOS_WEB_ASSETS_RELATIVE_PATH,
                runtime_root / "source-backup" / "apple-assets",
            )
            self.register_cleanup(
                "source:ios-web-assets",
                apple_assets_guard.restore,
            )

            ios_device, ios_owned = self._ready_ios_simulator(
                spec,
                command_env,
            )
            peer_device, peer_owned = self._ready_ios_simulator(
                spec,
                command_env,
                device_name=spec.ios_peer_device_name,
            )
            if ios_device["udid"] == peer_device["udid"]:
                raise BlockedError(
                    reason=(
                        "Mobile simulator primary and peer clients resolved "
                        "to the same iOS Simulator"
                    ),
                    resource="mobile-simulator:ios-device-isolation",
                )

            substitutions = {
                "ios_udid": ios_device["udid"],
                "runtime_root": str(runtime_root),
            }
            for name in ("web", "ios"):
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
                self._run_checked(
                    command,
                    env=command_env,
                    timeout=1800,
                    resource=f"mobile-simulator:build:{name}",
                )
                if name == "web":
                    apple_assets_guard.stage(
                        self.repo_root / MOBILE_WEB_DIST_RELATIVE_PATH
                    )

            applications = {
                "ios": self._stage_application(
                    spec,
                    "ios",
                    runtime_root,
                )
            }
            for device in (ios_device, peer_device):
                self._deploy_ios(
                    device["udid"],
                    applications["ios"]["artifact"],
                    spec.application_ids["ios"],
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
                "sim-ios-peer": {
                    "device": peer_device["udid"],
                    "deviceName": peer_device["name"],
                    "runtimeName": peer_device["runtime"],
                    "destination": (
                        f"platform=iOS Simulator,id={peer_device['udid']}"
                    ),
                    "ownedBoot": peer_owned,
                },
            }
            clients: list[ClientRuntime] = []
            client_resources: dict[str, dict[str, Any]] = {}
            for client in spec.clients:
                if client.id not in client_devices:
                    continue
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
                for reservation in reservations:
                    reservation.release()

            driver_versions = self._discover_appium_drivers(
                spec,
                command_env,
                platforms=("ios",),
            )
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
                            "ios": {
                                "identity": spec.drivers["ios"].identity,
                                "automationName": (
                                    spec.drivers["ios"].automation_name
                                ),
                                "version": driver_versions["ios"],
                                "expectedVersion": (
                                    spec.drivers["ios"].expected_version
                                ),
                            }
                        },
                    },
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
        self._run_cleanup(
            ("xcrun", "simctl", "uninstall", udid, application_id),
            env=env,
            resource="mobile-simulator:ios-preinstall-reset",
        )
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


class SelectedMobileSimulatorProvisioner(MobileSimulatorProvisioner):
    """Provision an explicit isolated client set outside catalog Gate runs."""

    def __init__(
        self,
        contract: EnvironmentContract,
        *,
        clients: Sequence[SimulatorClientSpec],
        runtime_source_commit: str,
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
        super().__init__(
            contract,
            executor=executor,
            repo_root=repo_root,
            runtime_base=runtime_base,
            runtime_cache_base=runtime_cache_base,
            contract_path=contract_path,
            artifact_fetcher=artifact_fetcher,
            status_reader=status_reader,
            sleep=sleep,
            monotonic=monotonic,
        )
        selected = tuple(clients)
        if not selected:
            raise ProvisioningError(
                "Selected Mobile simulator runtime requires clients"
            )
        client_ids = {client.id for client in selected}
        storage_roots = {client.storage_root for client in selected}
        if (
            len(client_ids) != len(selected)
            or len(storage_roots) != len(selected)
            or any(
                client.platform not in EXPECTED_DRIVERS
                or client.runtime
                != (
                    "tauri-ios-simulator"
                    if client.platform == "ios"
                    else "tauri-android-emulator"
                )
                or len(client.port_roles) != 3
                for client in selected
            )
        ):
            raise ProvisioningError(
                "Selected Mobile simulator runtime clients are invalid"
            )
        if not GIT_COMMIT_PATTERN.fullmatch(runtime_source_commit):
            raise ProvisioningError(
                "Selected Mobile simulator runtime source commit is invalid"
            )
        self.selected_clients = selected
        self.runtime_source_commit = runtime_source_commit

    def _build_inputs_digest(self, platform: str) -> str:
        return canonical_build_inputs_digest(self.repo_root, platform)

    def _platform_build_identity(
        self,
        manifest: RuntimeManifest,
        *,
        platform: str,
        command_env: Mapping[str, str],
    ) -> dict[str, Any]:
        if manifest.workspace_digest != "clean":
            raise BlockedError(
                reason=(
                    "Selected Mobile simulator builds require a clean "
                    "source projection"
                ),
                resource="mobile-simulator:source-identity",
            )
        environment = {
            name: command_env[name]
            for name in sorted(SELECTED_BUILD_ENVIRONMENT_KEYS)
            if name in command_env
        }
        try:
            return create_build_identity(
                build_id=f"{manifest.run_id}-{platform}",
                platform=platform,
                source=SourceIdentity(
                    source_commit=self.runtime_source_commit,
                    workspace_state="clean",
                    workspace_digest="clean",
                ),
                build_inputs_digest=self._build_inputs_digest(platform),
                environment_digest=canonical_value_digest(environment),
            )
        except MobileNativeBuildError as error:
            raise ProvisioningError(
                f"Selected Mobile simulator build identity is invalid: {error}"
            ) from error

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
            command_env = {**os.environ, **spec.build_environment}
            command_env.pop("PT_MOBILE_BUILD_IDENTITY_JSON", None)
            platforms = tuple(
                sorted({client.platform for client in self.selected_clients})
            )
            if "android" in platforms:
                command_env["NDK_HOME"] = _resolve_android_ndk_home(
                    command_env
                )
                command_env["TARGET_RANLIB"] = _resolve_android_ndk_tool(
                    command_env["NDK_HOME"],
                    "llvm-ranlib",
                )

            manifest = self._preflighted(
                self._manifest,
                profile_name="mobile-simulator",
                slot=0,
            )
            owner = f"development:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease("mobile-simulator", owner)

            runtime_root = self.runtime_base / manifest.run_id
            runtime_root.mkdir(parents=True, exist_ok=False)
            self.register_cleanup(
                "storage:mobile-simulator",
                lambda: shutil.rmtree(runtime_root),
            )
            apple_assets_guard = _GeneratedAppleAssetsGuard(
                self.repo_root / IOS_WEB_ASSETS_RELATIVE_PATH,
                runtime_root / "source-backup" / "apple-assets",
            )
            self.register_cleanup(
                "source:ios-web-assets",
                apple_assets_guard.restore,
            )
            android_manifest_guard = (
                _GeneratedAndroidManifestGuard(
                    self.repo_root / ANDROID_MANIFEST_RELATIVE_PATH
                )
                if "android" in platforms
                else None
            )
            if android_manifest_guard is not None:
                self.register_cleanup(
                    "source:android-manifest",
                    android_manifest_guard.restore,
                )

            device_resources = self._provision_selected_devices(
                spec,
                command_env,
                runtime_root,
            )
            build_identities = {
                platform: self._platform_build_identity(
                    manifest,
                    platform=platform,
                    command_env=command_env,
                )
                for platform in platforms
            }
            first_ios = next(
                (
                    resource["device"]
                    for resource in device_resources.values()
                    if resource["platform"] == "ios"
                ),
                "",
            )
            substitutions = {
                "ios_udid": str(first_ios),
                "runtime_root": str(runtime_root),
            }
            for platform in platforms:
                platform_env = {
                    **command_env,
                    "PT_MOBILE_BUILD_IDENTITY_JSON": (
                        canonical_json_bytes(
                            build_identities[platform]
                        ).decode("ascii")
                    ),
                }
                for name in ("web", platform):
                    if name in spec.artifact_patterns:
                        self._remove_artifact_matches(
                            spec,
                            name,
                            runtime_root,
                        )
                        self.register_cleanup(
                            f"build-artifact:{name}",
                            lambda build_target=name: (
                                self._remove_artifact_matches(
                                    spec,
                                    build_target,
                                    runtime_root,
                                )
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
                            env=platform_env,
                            timeout=1800,
                            resource=f"mobile-simulator:build:{name}",
                        )
                        if name == "web" and platform == "ios":
                            apple_assets_guard.stage(
                                self.repo_root
                                / MOBILE_WEB_DIST_RELATIVE_PATH
                            )
                    finally:
                        if (
                            name == "android"
                            and android_manifest_guard is not None
                        ):
                            android_manifest_guard.restore()

            applications: dict[str, dict[str, Any]] = {}
            for platform in platforms:
                application = self._stage_application(
                    spec,
                    platform,
                    runtime_root,
                )
                application["buildIdentity"] = build_identities[platform]
                applications[platform] = application
            for client in self.selected_clients:
                resource = device_resources[client.id]
                if client.platform == "ios":
                    self._deploy_ios(
                        str(resource["device"]),
                        applications["ios"]["artifact"],
                        spec.application_ids["ios"],
                        command_env,
                    )
                else:
                    self._deploy_android(
                        str(resource["device"]),
                        applications["android"]["artifact"],
                        spec.application_ids["android"],
                        command_env,
                    )

            chromedriver = None
            if "android" in platforms:
                first_android = next(
                    resource
                    for resource in device_resources.values()
                    if resource["platform"] == "android"
                )
                chromedriver = self._prepare_chromedriver(
                    spec.chromedriver,
                    {
                        "serial": str(first_android["device"]),
                        "abi": str(first_android["abi"]),
                    },
                    command_env,
                )

            clients: list[ClientRuntime] = []
            for client in self.selected_clients:
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
                for reservation in reservations:
                    reservation.release()
                clients.append(
                    ClientRuntime(
                        actor=client.role,
                        runtime=client.runtime,
                        worktree=str(self.repo_root),
                        gateway_port=ports[client.port_roles[0]],
                        renderer_port=ports[client.port_roles[1]],
                        webdriver_port=ports[client.port_roles[2]],
                        profile=client.id,
                        storage_root=str(storage_root),
                    )
                )
                device_resources[client.id].update(
                    {
                        "role": client.role,
                        "runtime": client.runtime,
                        "deviceRole": (
                            "isolated-simulator"
                            if client.platform == "ios"
                            else "isolated-emulator"
                        ),
                        "profile": client.id,
                        "storageRoot": str(storage_root),
                        "ports": ports,
                    }
                )
                if client.platform == "android":
                    device_resources[client.id]["appiumCapabilities"] = {
                        "appium:chromedriverExecutable": (
                            chromedriver["executable"]
                        ),
                        "chromedriverExecutableReference": (
                            chromedriver["executableReference"]
                        ),
                    }

            driver_versions = self._discover_appium_drivers(
                spec,
                command_env,
                platforms=platforms,
            )
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
                            }
                            for platform in platforms
                        },
                    },
                    **(
                        {"chromedriver": dict(chromedriver)}
                        if chromedriver is not None
                        else {}
                    ),
                    "applications": applications,
                    "clients": device_resources,
                    "harness": {
                        "namespace": spec.harness_namespace,
                        "requiredActions": list(spec.harness_actions),
                    },
                    "proofScope": {
                        "proves": [
                            "selected isolated iOS Simulator and Android "
                            "Emulator runtime clients",
                            "owner-held Appium sessions and production actions",
                        ],
                        "doesNotProve": [
                            "physical-device behavior",
                            "formal Acceptance",
                        ],
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
                    reason=(
                        "Selected Mobile simulator provisioning failed: "
                        f"{error}"
                    ),
                    resource="mobile-simulator:provisioning",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )

    def create_appium_session(
        self,
        manifest: MobileSimulatorRuntimeManifest,
        client_id: str,
    ) -> Any:
        from tooling.acceptance.gates.mobile.simulator_e2e import (
            SimulatorAppiumSession,
            SimulatorBuildTarget,
            SimulatorDeviceTarget,
            UrllibAppiumTransport,
        )

        resources = manifest.simulator_resources
        appium = _required_object(
            resources,
            "appium",
            f"mobile-simulator:{client_id}:appium",
        )
        clients = _required_object(
            resources,
            "clients",
            f"mobile-simulator:{client_id}:clients",
        )
        client = _required_object(
            clients,
            client_id,
            f"mobile-simulator:{client_id}",
        )
        platform = _required_text(
            client,
            "platform",
            f"mobile-simulator:{client_id}",
        )
        driver = _required_object(
            _required_object(
                appium,
                "drivers",
                f"mobile-simulator:{client_id}:drivers",
            ),
            platform,
            f"mobile-simulator:{client_id}:driver",
        )
        application = _required_object(
            _required_object(
                resources,
                "applications",
                f"mobile-simulator:{client_id}:applications",
            ),
            platform,
            f"mobile-simulator:{client_id}:application",
        )
        capabilities = client.get("appiumCapabilities")
        chromedriver = ""
        if isinstance(capabilities, Mapping):
            value = capabilities.get("appium:chromedriverExecutable")
            if isinstance(value, str):
                chromedriver = value
        return SimulatorAppiumSession(
            UrllibAppiumTransport(
                _required_text(
                    appium,
                    "serverUrl",
                    f"mobile-simulator:{client_id}:appium",
                )
            ),
            client_id=client_id,
            platform=platform,
            automation_name=_required_text(
                driver,
                "automationName",
                f"mobile-simulator:{client_id}:driver",
            ),
            device=SimulatorDeviceTarget(
                platform=platform,
                identifier=_required_text(
                    client,
                    "device",
                    f"mobile-simulator:{client_id}:device",
                ),
                role=_required_text(
                    client,
                    "deviceRole",
                    f"mobile-simulator:{client_id}:device-role",
                ),
            ),
            build=SimulatorBuildTarget(
                platform=platform,
                artifact=Path(
                    _required_text(
                        application,
                        "artifact",
                        f"mobile-simulator:{client_id}:artifact",
                    )
                ),
                application_id=_required_text(
                    application,
                    "id",
                    f"mobile-simulator:{client_id}:application-id",
                ),
            ),
            callback_scheme=_required_text(
                application,
                "callbackScheme",
                f"mobile-simulator:{client_id}:callback",
            ),
            ports={
                str(role): int(port)
                for role, port in _required_object(
                    client,
                    "ports",
                    f"mobile-simulator:{client_id}:ports",
                ).items()
            },
            chromedriver_executable=chromedriver,
        )

    def _provision_selected_devices(
        self,
        spec: MobileSimulatorSpec,
        env: Mapping[str, str],
        runtime_root: Path,
    ) -> dict[str, dict[str, Any]]:
        resources: dict[str, dict[str, Any]] = {}
        for client in self.selected_clients:
            if client.platform == "ios":
                device = self._create_isolated_ios_simulator(
                    spec,
                    env,
                    client_id=client.id,
                )
                resources[client.id] = {
                    "platform": "ios",
                    "device": device["udid"],
                    "deviceName": device["name"],
                    "runtimeName": device["runtime"],
                    "destination": (
                        f"platform=iOS Simulator,id={device['udid']}"
                    ),
                    "ownedBoot": True,
                }
            else:
                device = self._start_isolated_android_emulator(
                    spec,
                    env,
                    runtime_root,
                    client_id=client.id,
                )
                resources[client.id] = {
                    "platform": "android",
                    "device": device["serial"],
                    "deviceName": device["avd"],
                    "runtimeName": "Android Emulator",
                    "destination": device["avd"],
                    "ownedBoot": True,
                    "abi": device["abi"],
                }
        identities = {
            str(resource["device"]) for resource in resources.values()
        }
        if len(identities) != len(resources):
            raise BlockedError(
                reason="Mobile runtime clients share a boot identity",
                resource="mobile-simulator:device-isolation",
            )
        return resources

    def _create_isolated_ios_simulator(
        self,
        spec: MobileSimulatorSpec,
        env: Mapping[str, str],
        *,
        client_id: str,
    ) -> dict[str, str]:
        name = f"Peers Touch {client_id} {os.getpid()}"
        result = self._run_checked(
            (
                "xcrun",
                "simctl",
                "create",
                name,
                spec.ios_device_name,
                spec.ios_runtime,
            ),
            env=env,
            timeout=60,
            resource=f"mobile-simulator:ios-create:{client_id}",
        )
        udid = result.stdout.strip()
        if not udid or "\n" in udid:
            raise BlockedError(
                reason="simctl create returned an invalid device identity",
                resource=f"mobile-simulator:ios-create:{client_id}",
            )
        self.register_cleanup(
            f"simulator-delete:{client_id}:{udid}",
            lambda: self._run_cleanup(
                ("xcrun", "simctl", "delete", udid),
                env=env,
                resource=f"mobile-simulator:ios-delete:{client_id}",
            ),
        )
        self._run_checked(
            ("xcrun", "simctl", "boot", udid),
            env=env,
            timeout=60,
            resource=f"mobile-simulator:ios-boot:{client_id}",
        )
        self.register_cleanup(
            f"simulator-shutdown:{client_id}:{udid}",
            lambda: self._run_cleanup(
                ("xcrun", "simctl", "shutdown", udid),
                env=env,
                resource=f"mobile-simulator:ios-shutdown:{client_id}",
            ),
        )
        self._run_checked(
            ("xcrun", "simctl", "bootstatus", udid, "-b"),
            env=env,
            timeout=180,
            resource=f"mobile-simulator:ios-ready:{client_id}",
        )
        return {
            "udid": udid,
            "name": name,
            "runtime": spec.ios_runtime,
        }

    def _start_isolated_android_emulator(
        self,
        spec: MobileSimulatorSpec,
        env: Mapping[str, str],
        runtime_root: Path,
        *,
        client_id: str,
    ) -> dict[str, str]:
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
        reservations = self._reserve_emulator_port_pair()
        console_port = reservations[0].port
        for reservation in reservations:
            reservation.release()
        serial = f"emulator-{console_port}"
        process = self.executor.start(
            (
                "emulator",
                "-avd",
                spec.android_avd_name,
                "-port",
                str(console_port),
                "-read-only",
                "-no-window",
                "-no-audio",
                "-no-boot-anim",
                "-no-snapshot-load",
                "-no-snapshot-save",
            ),
            cwd=self.repo_root,
            env=dict(env),
            log_path=(
                runtime_root / "logs" / f"android-{client_id}.log"
            ),
        )
        self.register_cleanup(
            f"emulator-process:{client_id}:{serial}",
            process.stop,
        )
        self._run_checked(
            ("adb", "-s", serial, "wait-for-device"),
            env=env,
            timeout=180,
            resource=f"mobile-simulator:android-ready:{client_id}",
        )
        deadline = self.monotonic() + 180
        while self.monotonic() < deadline:
            if process.poll() is not None:
                raise BlockedError(
                    reason="Android emulator exited before boot completed",
                    resource=f"mobile-simulator:android-emulator:{client_id}",
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
                env=dict(env),
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
                    resource=f"mobile-simulator:android-abi:{client_id}",
                ).stdout.strip()
                if abi != spec.android_abi:
                    raise BlockedError(
                        reason=(
                            f"Android AVD {spec.android_avd_name!r} ABI "
                            f"{abi!r} does not match {spec.android_abi!r}"
                        ),
                        resource=f"mobile-simulator:android-abi:{client_id}",
                    )
                return {
                    "serial": serial,
                    "avd": spec.android_avd_name,
                    "abi": abi,
                }
            self.sleep(0.5)
        raise BlockedError(
            reason=(
                f"Android AVD {spec.android_avd_name!r} did not become ready"
            ),
            resource=f"mobile-simulator:android-ready:{client_id}",
        )


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
            apple_assets_guard = _GeneratedAppleAssetsGuard(
                self.repo_root / IOS_WEB_ASSETS_RELATIVE_PATH,
                runtime_root / "source-backup" / "apple-assets",
            )
            self.register_cleanup(
                "source:ios-web-assets",
                apple_assets_guard.restore,
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
                if name == "web":
                    apple_assets_guard.stage(
                        self.repo_root / MOBILE_WEB_DIST_RELATIVE_PATH
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


_SESSION_SAFE_KEYS = frozenset({
    "actorPtid", "stationPeerId", "expiresAt",
})


def _strip_session_secrets(value: object) -> object:
    if isinstance(value, Mapping):
        result = {}
        for key, item in value.items():
            if key == "session" and isinstance(item, Mapping):
                result[key] = {
                    k: v for k, v in item.items()
                    if k in _SESSION_SAFE_KEYS
                }
            else:
                result[key] = _strip_session_secrets(item)
        return result
    if isinstance(value, (list, tuple)):
        return [_strip_session_secrets(item) for item in value]
    return value


def _sanitize_cleanup_projection(value: object) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise EphemeralCapabilityBlocked(
            "Mobile Harness cleanup must be an object",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:response",
        )
    projected = json.loads(json.dumps(dict(value)))
    if set(projected) != {
        "oauthPurge",
        "webSessionProjectionCleared",
        "stationRegistryCleared",
    }:
        raise EphemeralCapabilityBlocked(
            "Mobile Harness cleanup has an invalid shape",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:response",
        )
    oauth_purge = projected.get("oauthPurge")
    if not isinstance(oauth_purge, dict) or set(oauth_purge) != {
        "stationRevocation",
        "secureStorage",
    }:
        raise EphemeralCapabilityBlocked(
            "Mobile Harness OAuth cleanup has an invalid shape",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:response",
        )
    if oauth_purge.get("stationRevocation") not in {
        "not_required",
        "confirmed",
        "unconfirmed",
    }:
        raise EphemeralCapabilityBlocked(
            "Mobile Harness cleanup has an invalid revocation state",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:response",
        )
    secure_storage = oauth_purge.get("secureStorage")
    absence_fields = {
        "activeAttemptIndexAbsent",
        "attemptSecretRecordAbsent",
        "currentSessionIndexAbsent",
        "credentialRecordAbsent",
        "publicProjectionAbsent",
    }
    if (
        not isinstance(secure_storage, dict)
        or set(secure_storage) != absence_fields
        or any(
            not isinstance(secure_storage[field], bool)
            for field in absence_fields
        )
    ):
        raise EphemeralCapabilityBlocked(
            "Mobile Harness secure-storage cleanup proof is invalid",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:response",
        )
    if (
        not isinstance(projected.get("webSessionProjectionCleared"), bool)
        or not isinstance(projected.get("stationRegistryCleared"), bool)
    ):
        raise EphemeralCapabilityBlocked(
            "Mobile Harness cleanup state is invalid",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:response",
        )
    return projected


def _assert_no_secret_response_fields(
    value: object,
    *,
    label: str,
    _path: str = "",
) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            current_path = f"{_path}.{key}" if _path else str(key)
            if (
                str(key) not in {"detailKeys", "errorKey"}
                and is_sensitive_key(key)
            ):
                raise EphemeralCapabilityBlocked(
                    f"{label} contains secret-bearing key at {current_path}",
                    resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:response",
                )
            _assert_no_secret_response_fields(
                item, label=label, _path=current_path
            )
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _assert_no_secret_response_fields(
                item, label=label, _path=f"{_path}[{index}]"
            )
        return
    if isinstance(value, str) and redact_text(value) != value:
        raise EphemeralCapabilityBlocked(
            f"{label} contains secret-bearing value at {_path}: len={len(value)}",
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
    if set(scope) != MOBILE_LIFECYCLE_SCOPE_FIELDS:
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
    overlay_route_id = navigation.get("overlayRouteId")
    if (
        set(navigation) != {"primaryRouteId", "detailKeys", "overlayRouteId"}
        or not isinstance(primary_route_id, str)
        or not isinstance(detail_keys, list)
        or any(not isinstance(item, str) for item in detail_keys)
        or (
            overlay_route_id is not None
            and not isinstance(overlay_route_id, str)
        )
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
        "deviceId": _optional_scope_text(
            scope.get("deviceId"),
            label="Mobile device ID",
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
            "overlayRouteId": overlay_route_id,
        },
    }


def _device_identity_digest(value: object) -> str | None:
    raw = str(value or "")
    if not raw:
        return None
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _project_device_identity_fields(value: object) -> object:
    if isinstance(value, Mapping):
        projected: dict[str, object] = {}
        for key, item in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
            if normalized == "deviceid":
                projected["deviceIdentityDigest"] = (
                    _device_identity_digest(item)
                )
            elif normalized == "winningdeviceid":
                projected["winningDeviceIdentityDigest"] = (
                    _device_identity_digest(item)
                )
            else:
                projected[str(key)] = _project_device_identity_fields(item)
        return projected
    if isinstance(value, (list, tuple)):
        return [_project_device_identity_fields(item) for item in value]
    return value


class MobileSimulatorAppiumCapabilityHandler(EphemeralCapabilityHandler):
    """Keep simulator, Appium, build, and Station topology in the parent."""

    _ALLOWED_OPERATIONS = (
        "create_bound_session",
        "select_binding",
        "authenticate_fixture_actor",
        "begin_access_gate",
        "activate_station_route",
        "station_route_snapshot",
        "harness_action",
        "stop",
    )
    _CHILD_HARNESS_ACTIONS = STATION_LIFECYCLE_CHILD_HARNESS_ACTIONS

    def __init__(
        self,
        *,
        manifest: Mapping[str, Any],
        artifact_writer: Any,
        session_factory: Callable[[str], Any],
        harness_actions: Sequence[str],
        child_harness_actions: Sequence[str] | None = None,
        harness_result_projector: (
            Callable[[str, object], object] | None
        ) = None,
        actor_manifest: Mapping[str, Any] | None = None,
        sensitive_values: Sequence[str] = (),
        verifier_source_digest: str | None = None,
    ) -> None:
        self._manifest = json.loads(json.dumps(dict(manifest)))
        self._artifact_writer = artifact_writer
        self._session_factory = session_factory
        self._harness_actions = frozenset(harness_actions)
        self._child_harness_actions = frozenset(
            self._CHILD_HARNESS_ACTIONS
            if child_harness_actions is None
            else child_harness_actions
        )
        if not self._child_harness_actions.issubset(self._harness_actions):
            raise ValueError(
                "Child-callable Mobile Harness actions must be declared "
                "by the environment"
            )
        self._harness_result_projector = harness_result_projector
        self._actor_manifest = (
            json.loads(json.dumps(dict(actor_manifest)))
            if actor_manifest is not None
            else None
        )
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
        if operation == "activate_station_route":
            self._require_exact_fields(
                payload,
                {"clientId", "routeType"},
                operation,
            )
            value = self._activate_station_route(
                session,
                self._request_text(payload, "routeType"),
            )
            self._require_active(deadline_monotonic, cancellation)
            return {"clientId": client_id, "value": value}
        if operation == "station_route_snapshot":
            self._require_exact_fields(payload, {"clientId"}, operation)
            value = self._station_route_snapshot(session)
            self._require_active(deadline_monotonic, cancellation)
            return {"clientId": client_id, "value": value}
        if operation == "harness_action":
            self._require_exact_fields(
                payload,
                {"clientId", "action", "actionPayload"},
                operation,
            )
            action = self._request_text(payload, "action")
            if action not in self._child_harness_actions:
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
            if self._harness_result_projector is not None:
                value = self._harness_result_projector(action, value)
            if action == "lifecycle.scope.read":
                value = _sanitize_lifecycle_scope(value)
            elif action == "cleanup":
                value = _sanitize_cleanup_projection(value)
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
                "activate_station_route": {"clientId", "value"},
                "station_route_snapshot": {"clientId", "value"},
                "harness_action": {"clientId", "value"},
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

    def _activate_station_route(
        self,
        session: Any,
        route_type: str,
    ) -> dict[str, Any]:
        snapshot = self._station_route_snapshot(session)
        if route_type == "relay":
            if not self._route_of_type(snapshot, "relay"):
                services = _required_object(
                    self._manifest,
                    "services",
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:services",
                )
                relay = _required_object(
                    services,
                    "relay",
                    f"{SIMULATOR_APPIUM_CAPABILITY_ID}:relay",
                )
                endpoint = str(relay.get("endpoint") or "")
                if not endpoint:
                    raise EphemeralCapabilityBlocked(
                        "Mobile Relay service endpoint is unavailable",
                        resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:relay",
                    )
                session.call_action("station.add", {"url": endpoint})
                snapshot = self._station_route_snapshot(session)
        if route_type != "direct":
            if route_type != "relay":
                raise EphemeralCapabilityBlocked(
                    "Mobile Station route type is unsupported",
                    resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:route-type",
                )
        route = self._route_of_type(snapshot, route_type)
        if route is None:
            raise EphemeralCapabilityBlocked(
                f"Mobile {route_type} Station route is unavailable",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{route_type}-route",
            )
        active_entry = self._active_station_entry(snapshot)
        if active_entry.get("activeRouteId") == route.get("routeId"):
            return snapshot
        session.call_action(
            "navigation.apply",
            {"kind": "primary", "routeId": "tab:settings"},
        )
        session.call_action(
            "navigation.apply",
            {
                "kind": "detail.push",
                "route": {
                    "routeId": "detail:setting",
                    "settingId": "station-connection",
                },
            },
        )
        route_element = session.find_element(
            "css selector",
            f'button[data-station-route-type="{route_type}"]',
        )
        session.click_element(route_element)
        confirm = session.find_element(
            "css selector",
            'button[data-station-route-confirm="true"]',
        )
        session.click_element(confirm)
        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline:
            snapshot = self._station_route_snapshot(session)
            active_entry = self._active_station_entry(snapshot)
            active = self._route_of_type(snapshot, route_type)
            if (
                active is not None
                and active_entry.get("activeRouteId")
                == active.get("routeId")
            ):
                revision = active_entry.get("routeRevision")
                screenshot = self._artifact_writer.write_bytes(
                    (
                        "runtime/mobile-relay/"
                        f"{route_type}-route-{revision}.png"
                    ),
                    session.screenshot_bytes(),
                    role="mobile-relay-route-ui",
                    discriminator=f"{route_type}:{revision}",
                )
                snapshot["uiEvidence"] = screenshot.to_dict()
                return snapshot
            time.sleep(0.25)
        raise EphemeralCapabilityBlocked(
            f"Mobile {route_type} Station route did not become active",
            resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{route_type}-route",
        )

    @staticmethod
    def _active_station_entry(
        snapshot: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        station_peer_id = str(snapshot.get("activeStationPeerId") or "")
        entries = snapshot.get("entries")
        entry = next(
            (
                item
                for item in entries
                if isinstance(item, Mapping)
                and item.get("stationPeerId") == station_peer_id
            ),
            None,
        ) if isinstance(entries, list) else None
        if not isinstance(entry, Mapping):
            raise EphemeralCapabilityBlocked(
                "Mobile active Station route entry is unavailable",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:station-route",
            )
        return entry

    @classmethod
    def _route_of_type(
        cls,
        snapshot: Mapping[str, Any],
        route_type: str,
    ) -> Mapping[str, Any] | None:
        entry = cls._active_station_entry(snapshot)
        routes = entry.get("routes")
        return next(
            (
                item
                for item in routes
                if isinstance(item, Mapping)
                and item.get("routeType") == route_type
            ),
            None,
        ) if isinstance(routes, list) else None

    @staticmethod
    def _station_route_snapshot(session: Any) -> dict[str, Any]:
        raw = session.call_action("station.route.snapshot")
        snapshot = _json_safe_mapping(
            raw,
            label="Mobile Station route snapshot",
        )
        entries = snapshot.get("entries")
        projected_entries = []
        if isinstance(entries, list):
            for value in entries:
                if not isinstance(value, Mapping):
                    continue
                routes = value.get("routes")
                projected_entries.append(
                    {
                        "stationPeerId": value.get("stationPeerId"),
                        "activeRouteId": value.get("activeRouteId"),
                        "routeRevision": value.get("routeRevision"),
                        "lifecycleGeneration": value.get(
                            "lifecycleGeneration"
                        ),
                        "routes": [
                            {
                                "routeId": route.get("routeId"),
                                "routeType": route.get("routeType"),
                                "routeGeneration": route.get(
                                    "routeGeneration"
                                ),
                                "health": route.get("health"),
                            }
                            for route in routes
                            if isinstance(route, Mapping)
                        ] if isinstance(routes, list) else [],
                    }
                )
        binding = snapshot.get("binding")
        projected_binding = (
            {
                "stationPeerId": binding.get("stationPeerId"),
                "routeId": binding.get("routeId"),
                "routeType": binding.get("routeType"),
                "routeGeneration": binding.get("routeGeneration"),
                "routeRevision": binding.get("routeRevision"),
            }
            if isinstance(binding, Mapping)
            else None
        )
        return {
            "activeStationPeerId": snapshot.get("activeStationPeerId"),
            "entries": projected_entries,
            "sessionRevocation": snapshot.get("sessionRevocation"),
            "binding": projected_binding,
        }

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
        self._prepare_shared_actor_identity(client_id, session=session)
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
        raw_login = session.call_action(
            "access.submit",
            {
                "kind": "login",
                "attemptId": attempt_id,
                "email": account,
                "password": ACTOR_PASSWORD,
            },
        )
        if not isinstance(raw_login, Mapping):
            raise EphemeralCapabilityBlocked(
                "Mobile Fixture login result is not an object",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        raw_session = raw_login.get("session")
        safe_session = None
        if isinstance(raw_session, Mapping):
            safe_session = {
                key: raw_session[key]
                for key in ("actorPtid", "stationPeerId", "expiresAt")
                if key in raw_session
            }
        raw_decision = raw_login.get("decision")
        safe_login = {
            "decision": raw_decision,
            "session": safe_session,
        }
        login = _json_safe_mapping(
            safe_login,
            label="Mobile Fixture login",
        )
        return {
            "preAuthenticationScope": access["scope"],
            "login": login,
        }

    def _prepare_shared_actor_identity(
        self,
        client_id: str,
        *,
        session: Any,
    ) -> bool:
        if self._actor_manifest is None:
            return False
        target = self._runtime_client(client_id)
        actor = str(target.get("actor") or "")
        target_service_id, target_service = require_runtime_client_service(
            self._manifest,
            client_id,
            "station",
        )
        clients = self._manifest.get("clients")
        if not isinstance(clients, list):
            raise EphemeralCapabilityBlocked(
                "Chat mixed-native clients are unavailable",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        sources = [
            item
            for item in clients
            if (
                isinstance(item, Mapping)
                and item.get("runtime") == "native-tauri"
                and item.get("actor") == actor
                and item.get("id") != client_id
                and self._client_station_service_id(item)
                == target_service_id
            )
        ]
        if not sources:
            return False
        if len(sources) != 1:
            raise EphemeralCapabilityBlocked(
                "Chat mixed-native actor identity source is ambiguous",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        source = sources[0]
        source_root = Path(str(source.get("storage_root") or ""))
        actor_ptid = self._actor_ptid(client_id)
        station_peer_id = str(target_service.get("runtimeIdentity") or "")
        identity_root = (
            source_root
            / "peers-touch"
            / "desktop"
            / "data"
            / "secure-store"
            / "identity-keys"
        )
        if not identity_root.is_dir():
            return False
        identity_key_ref = (
            f"station_peer_{self._storage_segment(station_peer_id)}/"
            f"{self._storage_segment(actor_ptid)}"
        )
        identity_file = identity_root / (
            hashlib.sha256(identity_key_ref.encode("utf-8")).hexdigest()
            + ".key"
        )
        if not identity_file.is_file():
            raise EphemeralCapabilityBlocked(
                "Chat mixed-native actor identity source is incomplete",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        seed_hex = identity_file.read_text(encoding="utf-8").strip()
        if re.fullmatch(r"[0-9a-f]{64}", seed_hex) is None:
            raise EphemeralCapabilityBlocked(
                "Chat mixed-native actor identity seed is invalid",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        storage_key = self._mobile_actor_identity_storage_key(
            station_peer_id,
            actor_ptid,
        )
        seed = bytearray.fromhex(seed_hex)
        seed_base64 = base64.b64encode(seed).decode("ascii")
        self._sensitive_values = tuple(
            dict.fromkeys((*self._sensitive_values, seed_hex, seed_base64))
        )
        try:
            prepared = session.call_action(
                "runtime.prepareActorIdentity",
                {
                    "storageKey": storage_key,
                    "seedBase64": seed_base64,
                },
            )
        finally:
            seed[:] = b"\x00" * len(seed)
        if prepared != {"prepared": True}:
            raise EphemeralCapabilityBlocked(
                "Chat mixed-native actor identity preparation failed",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        return True

    def _actor_ptid(self, client_id: str) -> str:
        actor_manifest = self._actor_manifest
        if not isinstance(actor_manifest, Mapping):
            raise EphemeralCapabilityBlocked(
                "Chat mixed-native actor manifest is unavailable",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        clients = actor_manifest.get("clients")
        stations = actor_manifest.get("stations")
        if not isinstance(clients, list) or not isinstance(stations, Mapping):
            raise EphemeralCapabilityBlocked(
                "Chat mixed-native actor manifest is invalid",
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
                "Chat mixed-native actor route is unavailable",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        service = stations.get(client.get("serviceId"))
        actors = service.get("actors") if isinstance(service, Mapping) else None
        actor = next(
            (
                item
                for item in actors
                if (
                    isinstance(item, Mapping)
                    and item.get("role") == client.get("actor")
                )
            ),
            None,
        ) if isinstance(actors, list) else None
        ptid = str(actor.get("ptid") or "") if isinstance(actor, Mapping) else ""
        if not ptid.startswith("ptid:"):
            raise EphemeralCapabilityBlocked(
                "Chat mixed-native actor PTID is unavailable",
                resource=f"{SIMULATOR_APPIUM_CAPABILITY_ID}:{client_id}",
            )
        return ptid

    @staticmethod
    def _client_station_service_id(client: Mapping[str, Any]) -> str:
        bindings = client.get("service_bindings")
        station = bindings.get("station") if isinstance(bindings, Mapping) else None
        return (
            str(station.get("service_id") or "")
            if isinstance(station, Mapping)
            else ""
        )

    @staticmethod
    def _storage_segment(value: str) -> str:
        normalized = "".join(
            character
            if character.isascii()
            and (character.isalnum() or character in "-_.")
            else "_"
            for character in value.strip()
        )
        return normalized or "__default__"

    @staticmethod
    def _mobile_actor_identity_storage_key(
        station_peer_id: str,
        actor_ptid: str,
    ) -> str:
        if not station_peer_id or not actor_ptid.startswith("ptid:"):
            raise EphemeralCapabilityBlocked(
                "Chat mixed-native actor identity scope is invalid",
                resource=SIMULATOR_APPIUM_CAPABILITY_ID,
            )
        user_scope = f"{station_peer_id}|{actor_ptid}"
        digest = hashlib.sha256(
            user_scope.encode("utf-8")
            + b"\x1f"
            + actor_ptid.encode("utf-8")
        ).digest()[:16].hex()
        return f"mobile-crypto-identity.v1.identity.{digest}"

    @staticmethod
    def _begin_access_gate(session: Any) -> dict[str, Any]:
        raw_started = session.call_action(
            "access.submit",
            {"kind": "start"},
        )
        safe_started = _strip_session_secrets(raw_started) if isinstance(raw_started, Mapping) else raw_started
        started = _json_safe_mapping(
            safe_started,
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
            is_lifecycle_scope = (
                set(value) == MOBILE_LIFECYCLE_SCOPE_FIELDS
            )
            for key, item in value.items():
                normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
                if (
                    normalized in forbidden_fields
                    and not (
                        normalized == "deviceid"
                        and is_lifecycle_scope
                    )
                ):
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
            manifest = self._preflighted(
                self._manifest,
                profile_name=self.environment_id,
                slot=0,
            )
            service_bindings = resolve_mobile_service_bindings(
                self.contract,
                self.overlay_path,
            )

            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            for deployment_environment in sorted(
                {
                    binding.deployment_environment
                    for binding in service_bindings.values()
                }
            ):
                self.acquire_profile_lease(deployment_environment, owner)
                self.acquire_remote_git_source_lease(
                    deployment_environment,
                    owner,
                )
            for service_id in STATION_LIFECYCLE_SERVICES:
                binding = service_bindings[service_id]
                verify_reset_target(
                    binding.endpoint,
                    binding.deployment_environment,
                )
            services = self._attest_services(
                manifest.run_id,
                service_bindings,
            )
            manifest = dataclasses.replace(
                manifest,
                services=services,
                cleanup_registered=True,
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest

            require_station_reset_authority(
                "mobile-station-lifecycle-alice"
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
                service_bindings,
                overlay,
            )
            base_clients = {
                client.profile: client for client in base_manifest.clients
            }
            contract_clients = {
                client.id: client for client in self.contract.clients
            }
            required_client_ids = ("sim-ios", "sim-ios-peer")
            if (
                set(base_clients) != set(required_client_ids)
                or set(contract_clients) != set(required_client_ids)
            ):
                raise BlockedError(
                    reason=(
                        "Mobile Station lifecycle base provisioner did not "
                        "provide both required isolated iOS simulator clients"
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
                for client_id in required_client_ids
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
                profile_requested=self.environment_id,
                profile_resolved=self.environment_id,
                profile_slot=0,
                services=services,
                actor_manifest_ref=actor_manifest_ref,
                credential_refs=base_manifest.credential_refs,
                clients=clients,
                cleanup_registered=True,
                cleanup_resources=self.contract.cleanup.resources,
                simulator_resources=self._public_simulator_resources(
                    base_manifest.simulator_resources,
                    overlay,
                    client_ids=required_client_ids,
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
            gate_id not in STATION_BOUND_SIMULATOR_GATE_IDS
            or required_capabilities != (SIMULATOR_APPIUM_CAPABILITY_ID,)
        ):
            raise BlockedError(
                reason=(
                    "Mobile Station-bound simulator Gate requires the exact "
                    "simulator Appium capability and an allowed Gate identity"
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
                    "Mobile Station-bound simulator parent authorities are not ready"
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
            harness_result_projector=self._project_lifecycle_harness_result,
            sensitive_values=self._raw_authority_values(),
        )
        context = EphemeralGateLaunchContext(
            required_capabilities=required_capabilities,
            request_timeout_seconds=SIMULATOR_CAPABILITY_TIMEOUT_SECONDS,
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

    @staticmethod
    def _project_lifecycle_harness_result(
        action: str,
        value: object,
    ) -> object:
        if action == "lifecycle.scope.read":
            return value
        return _project_device_identity_fields(value)

    def _cleanup_appium_sessions(self) -> None:
        if self._appium_handler is None:
            return
        result = self._appium_handler.close()
        if not result.closed:
            raise ProvisioningError(
                "Mobile Station lifecycle Appium sessions did not close"
            )

    def _attest_services(
        self,
        run_id: str,
        service_bindings: Mapping[str, MobileServiceBinding],
    ) -> dict[str, Any]:
        services: dict[str, Any] = {}
        for service_id in STATION_LIFECYCLE_SERVICES:
            binding = service_bindings[service_id]
            if binding.kind != "station":
                raise BlockedError(
                    reason=(
                        f"Mobile lifecycle service {service_id!r} must be a "
                        "Station"
                    ),
                    resource=f"service-kind:{service_id}",
                )
            if not self._station_ready(
                binding.endpoint,
                binding.health_endpoint,
            ):
                raise BlockedError(
                    reason=f"Required service {service_id!r} is unhealthy",
                    resource=f"service-health:{service_id}",
                )
            services[service_id] = produce_station_attestation(
                environment_id=self.environment_id,
                run_id=run_id,
                service_id=service_id,
                station_url=binding.endpoint,
                profile_env={
                    "PT_STATION_MODE": "remote",
                    "PT_STATION_DEPLOY_ENV": (
                        binding.deployment_environment
                    ),
                },
                require_runtime_identity=True,
                remote_source_identity_provider=(
                    resolve_remote_source_identity
                ),
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
        service_bindings: Mapping[str, MobileServiceBinding],
        overlay: MobileStationLifecycleSimulatorSpec,
    ) -> dict[str, Any]:
        reset_scope = "mobile-station-lifecycle-alice"
        require_station_reset_authority(reset_scope)
        stations: dict[str, Any] = {}
        for service_id in STATION_LIFECYCLE_SERVICES:
            binding = service_bindings[service_id]
            verify_reset_target(
                binding.endpoint,
                binding.deployment_environment,
            )
            reset_fixture(
                binding.deployment_environment,
                ("alice",),
                reset_authorized=True,
            )
            self.register_cleanup(
                f"actor-fixture:{service_id}",
                partial(
                    self._reset_actor_fixture_target,
                    binding.endpoint,
                    binding.deployment_environment,
                    reset_scope,
                ),
            )
            actor = resolve_actor_identity(
                binding.endpoint,
                binding.deployment_environment,
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
                "authorizationRef": station_reset_authorization_ref(
                    reset_scope
                ),
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
        reset_scope: str,
    ) -> None:
        require_station_reset_authority(reset_scope)
        verify_reset_target(station_url, deployment_environment)
        reset_fixture(
            deployment_environment,
            ("alice",),
            reset_authorized=True,
        )

    @staticmethod
    def _public_simulator_resources(
        resources: Mapping[str, Any],
        overlay: MobileStationLifecycleSimulatorSpec | Mapping[str, Any],
        *,
        client_ids: tuple[str, ...] = ("sim-ios", "sim-ios-peer"),
        environment_id: str = STATION_LIFECYCLE_ENVIRONMENT_ID,
    ) -> dict[str, Any]:
        if isinstance(overlay, Mapping):
            harness = _required_object(
                overlay,
                "harness",
                f"{environment_id}:harness",
            )
            proof_scope = _required_object(
                overlay,
                "proof_scope",
                f"{environment_id}:proof-scope",
            )
            harness_namespace = _required_text(
                harness,
                "namespace",
                f"{environment_id}:harness",
            )
            harness_actions = tuple(
                str(action)
                for action in _required_list(
                    harness,
                    "required_actions",
                    f"{environment_id}:harness-actions",
                )
            )
            projected_proof_scope = {
                "proves": [
                    str(value)
                    for value in _required_list(
                        proof_scope,
                        "proves",
                        f"{environment_id}:proof-scope",
                    )
                ],
                "doesNotProve": [
                    str(value)
                    for value in _required_list(
                        proof_scope,
                        "does_not_prove",
                        f"{environment_id}:proof-scope",
                    )
                ],
            }
        else:
            harness_namespace = overlay.base.harness_namespace
            harness_actions = overlay.harness_actions
            projected_proof_scope = {
                key: list(value)
                for key, value in overlay.proof_scope.items()
            }
        available_platforms = ("ios",)
        appium = _required_object(
            resources,
            "appium",
            f"{environment_id}:base-appium",
        )
        drivers = _required_object(
            appium,
            "drivers",
            f"{environment_id}:base-drivers",
        )
        applications = _required_object(
            resources,
            "applications",
            f"{environment_id}:base-applications",
        )
        clients = _required_object(
            resources,
            "clients",
            f"{environment_id}:base-clients",
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
                                f"{environment_id}:"
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
                    for platform in available_platforms
                },
            },
            "applications": {
                platform: {
                    key: value
                    for key, value in _required_object(
                        applications,
                        platform,
                        (
                            f"{environment_id}:"
                            f"application:{platform}"
                        ),
                    ).items()
                    if key in {"id", "sha256", "callbackScheme"}
                }
                for platform in available_platforms
            },
            "clients": {
                client_id: {
                    key: value
                    for key, value in _required_object(
                        clients,
                        client_id,
                        (
                            f"{environment_id}:"
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
                for client_id in client_ids
            },
            "harness": {
                "namespace": harness_namespace,
                "requiredActions": list(harness_actions),
            },
            "proofScope": projected_proof_scope,
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


class _MobileTwoActorSimulatorProvisioner(EnvironmentProvisioner):
    environment_id = ""
    overlay_filename = ""
    station_profile_keys: Mapping[str, tuple[str, str]] = {}
    service_profile_keys: Mapping[str, tuple[str, str]] = {}
    require_distinct_station_profiles = False
    prepare_cross_station_friendships = False
    requires_actor_reset = True
    derives_fixture_federation_id = True
    actor_manifest_kind = ""
    actor_manifest_path = ""

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
            ENVIRONMENTS_DIR / self.overlay_filename
        )
        self._station_profiles = dict(station_profiles or {})
        self._service_profiles = dict(service_profiles or {})
        self._base_manifest: MobileSimulatorRuntimeManifest | None = None

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        base: MobileSimulatorProvisioner | None = None
        try:
            overlay = self._load_overlay()
            environment_clients = self._clients_for_gate(gate_id, overlay)
            manifest = self._preflighted(
                self._manifest,
                profile_name=self.environment_id,
                slot=0,
            )
            if self.requires_actor_reset:
                require_station_reset_authority(self._reset_scope())
            runtime_environment = self._inject_station_profile_bindings(
                os.environ
            )
            runtime_environment = self._inject_service_profile_bindings(
                runtime_environment
            )
            service_bindings = resolve_mobile_service_bindings(
                self.contract,
                self.overlay_path,
                environment=runtime_environment,
            )
            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            for deployment_environment in sorted(
                {
                    binding.deployment_environment
                    for binding in service_bindings.values()
                }
            ):
                self.acquire_profile_lease(deployment_environment, owner)
                self.acquire_remote_git_source_lease(
                    deployment_environment,
                    owner,
                )
            for binding in service_bindings.values():
                if binding.kind != "station":
                    continue
                if self.requires_actor_reset:
                    verify_reset_target(
                        binding.endpoint,
                        binding.deployment_environment,
                    )
            services = self._attest_services(
                manifest.run_id,
                service_bindings,
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
                    or f"{self.environment_id}:base",
                )
            if not isinstance(base_manifest, MobileSimulatorRuntimeManifest):
                raise BlockedError(
                    reason=(
                        f"{self.environment_id} base did not return "
                        "simulator resources"
                    ),
                    resource=f"{self.environment_id}:base-manifest",
                )
            self._base_manifest = base_manifest

            actor_manifest_ref = self._prepare_actor_fixture(
                gate_id,
                service_bindings,
                overlay,
                clients=environment_clients,
            )
            contract_clients = {
                client.id: client
                for client in environment_clients
                if client.runtime == "tauri-ios-simulator"
            }
            base_clients = {
                client.profile: client for client in base_manifest.clients
            }
            required_client_ids = ("sim-ios", "sim-ios-peer")
            if (
                set(base_clients) != set(required_client_ids)
                or set(contract_clients) != set(required_client_ids)
            ):
                raise BlockedError(
                    reason=(
                        f"{self.environment_id} requires both isolated iOS "
                        "simulator clients"
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
                for client_id in required_client_ids
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
                for client in environment_clients
            }
            manifest = MobileSimulatorRuntimeManifest(
                **{
                    field.name: (
                        self.environment_id
                        if field.name == "environment_id"
                        else ProvisioningState.PROVISIONED
                        if field.name == "state"
                        else self.environment_id
                        if field.name in {
                            "profile_requested",
                            "profile_resolved",
                        }
                        else 0
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
                    reason=f"{self.environment_id} provisioning failed: {error}",
                    resource=f"{self.environment_id}:provisioning",
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
                reason=f"Cannot load {self.environment_id} contract",
                resource=f"{self.environment_id}:environment",
            ) from error
        if (
            not isinstance(payload, dict)
            or payload.get("id") != self.environment_id
            or payload.get("base_environment") != "mobile-simulator"
        ):
            raise BlockedError(
                reason=f"{self.environment_id} identity is invalid",
                resource=f"{self.environment_id}:environment",
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
                reason=f"{self.environment_id} overlay is incomplete",
                resource=f"{self.environment_id}:environment",
            )
        return payload

    def _clients_for_gate(
        self,
        gate_id: str,
        overlay: Mapping[str, Any],
    ) -> tuple[EnvironmentClient, ...]:
        raw_variants = overlay.get("gate_client_service_bindings", {})
        if not isinstance(raw_variants, Mapping):
            raise BlockedError(
                reason=(
                    f"{self.environment_id} Gate client bindings must be "
                    "an object"
                ),
                resource=f"{self.environment_id}:client-bindings",
            )
        known_clients = {client.id: client for client in self.contract.clients}
        for variant_gate_id, raw_bindings in raw_variants.items():
            if not isinstance(variant_gate_id, str) or not isinstance(
                raw_bindings,
                Mapping,
            ):
                raise BlockedError(
                    reason=(
                        f"{self.environment_id} Gate client binding variant "
                        "is invalid"
                    ),
                    resource=f"{self.environment_id}:client-bindings",
                )
            for client_id, service_id in raw_bindings.items():
                client = (
                    known_clients.get(client_id)
                    if isinstance(client_id, str)
                    else None
                )
                service = (
                    self.contract.services.get(service_id)
                    if isinstance(service_id, str)
                    else None
                )
                binding = (
                    client.service_bindings.get("station")
                    if client is not None
                    else None
                )
                if (
                    client is None
                    or binding is None
                    or service is None
                    or service.kind != binding.required_kind
                ):
                    raise BlockedError(
                        reason=(
                            f"{self.environment_id} Gate client binding "
                            f"{variant_gate_id!r}/{client_id!r} is invalid"
                        ),
                        resource=f"{self.environment_id}:client-bindings",
                    )

        selected = raw_variants.get(gate_id, {})
        return tuple(
            dataclasses.replace(
                client,
                service_bindings={
                    **client.service_bindings,
                    "station": dataclasses.replace(
                        client.service_bindings["station"],
                        service_id=str(selected[client.id]),
                    ),
                },
            )
            if client.id in selected
            else client
            for client in self.contract.clients
        )

    def _required_station_profiles(self) -> dict[str, str]:
        if not self._station_profiles:
            return {}
        expected = set(self.station_profile_keys)
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
                    f"{self.environment_id} Station profiles must be "
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
        duplicates = (
            sorted(
                profile_name
                for profile_name in set(self._station_profiles.values())
                if list(self._station_profiles.values()).count(profile_name) > 1
            )
            if self.require_distinct_station_profiles
            else []
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
        expected = set(self.service_profile_keys)
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
                    f"{self.environment_id} service profiles must be specified at run "
                    "time with --service-profile SERVICE_ID=PROFILE "
                    f"({'; '.join(detail)})"
                ),
                resource="service-profile-bindings",
            )
        for profile_name in self._service_profiles.values():
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
            _, station_env = resolve_reviewed_profile_environment(profile_name)
            if station_env.get("PT_STATION_MODE", "").strip() != "remote":
                raise BlockedError(
                    reason=(
                        f"{self.environment_id} service {service_id!r} requires a "
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
            url_key, deployment_key = self.station_profile_keys[
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
            _, service_env = resolve_reviewed_profile_environment(profile_name)
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
            url_key, deployment_key = self.service_profile_keys[
                service_id
            ]
            merged[url_key] = service_url
            merged[deployment_key] = deployment_environment
            health_url = service_env.get("PT_RELAY_HEALTH_URL", "").strip()
            if health_url:
                merged["PT_RELAY_HEALTH_URL"] = health_url
        return merged

    def _attest_services(
        self,
        run_id: str,
        service_bindings: Mapping[str, MobileServiceBinding],
    ) -> dict[str, Any]:
        services: dict[str, Any] = {}
        for service_id, binding in service_bindings.items():
            if not self._station_ready(
                binding.endpoint,
                binding.health_endpoint,
            ):
                raise BlockedError(
                    reason=f"Required service {service_id!r} is unhealthy",
                    resource=f"service-health:{service_id}",
                )
            if binding.kind == "station":
                attestation = produce_station_attestation(
                    environment_id=self.environment_id,
                    run_id=run_id,
                    service_id=service_id,
                    station_url=binding.endpoint,
                    profile_env={
                        "PT_STATION_MODE": "remote",
                        "PT_STATION_DEPLOY_ENV": (
                            binding.deployment_environment
                        ),
                    },
                    require_runtime_identity=True,
                    remote_source_identity_provider=(
                        resolve_remote_source_identity
                    ),
                )
            else:
                attestation = produce_service_attestation(
                    environment_id=self.environment_id,
                    run_id=run_id,
                    service_id=service_id,
                    service_kind=binding.kind,
                    endpoint=binding.endpoint,
                    mode="remote",
                    deployment_environment=(
                        binding.deployment_environment
                    ),
                    producer=binding.producer,
                    require_runtime_identity=True,
                    remote_source_identity_provider=(
                        resolve_remote_source_identity
                    ),
                    runtime_version_provider=(
                        resolve_windows_service_version
                    ),
                )
            services[service_id] = attestation
        return services

    def _prepare_actor_fixture(
        self,
        gate_id: str,
        service_bindings: Mapping[str, MobileServiceBinding],
        overlay: Mapping[str, Any],
        *,
        clients: Sequence[EnvironmentClient] | None = None,
    ) -> dict[str, Any]:
        environment_clients = tuple(clients or self.contract.clients)
        reset_scope = ""
        if self.requires_actor_reset:
            reset_scope = self._reset_scope()
            require_station_reset_authority(reset_scope)
        fixture_roles = tuple(
            sorted({client.actor for client in environment_clients})
        )
        station_service_ids = tuple(
            service_id
            for service_id, binding in service_bindings.items()
            if binding.kind == "station"
        )
        if not station_service_ids or not fixture_roles:
            raise BlockedError(
                reason=f"{self.environment_id} actor topology is incomplete",
                resource=f"{self.environment_id}:actor-topology",
            )
        stations: dict[str, Any] = {}
        resolved_actors: dict[str, dict[str, Any]] = {}
        for service_id in station_service_ids:
            binding = service_bindings[service_id]
            if self.requires_actor_reset:
                verify_reset_target(
                    binding.endpoint,
                    binding.deployment_environment,
                )
                reset_fixture(
                    binding.deployment_environment,
                    fixture_roles,
                    reset_authorized=True,
                )
                self.register_cleanup(
                    f"actor-fixture:{service_id}",
                    lambda binding=binding, roles=fixture_roles: (
                        self._reset_actor_fixture_target(
                            binding.endpoint,
                            binding.deployment_environment,
                            roles,
                            reset_scope,
                        )
                    ),
                )
            actors = (
                [
                    resolve_actor_identity(
                        binding.endpoint,
                        binding.deployment_environment,
                        role,
                        require_disposable=True,
                    )
                    for role in fixture_roles
                ]
                if self.requires_actor_reset
                else []
            )
            resolved_actors[service_id] = {
                actor.role: actor for actor in actors
            }
            stations[service_id] = {
                "targetVerified": self.requires_actor_reset,
                "existingActorsVerified": not self.requires_actor_reset,
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
        if self.prepare_cross_station_friendships:
            role_targets: dict[str, tuple[str, str]] = {}
            selected_actors: dict[str, Any] = {}
            for client in environment_clients:
                role = client.actor
                service_id = client.service_bindings["station"].service_id
                binding = service_bindings[service_id]
                target = (
                    binding.endpoint,
                    binding.deployment_environment,
                )
                existing = role_targets.get(role)
                if existing is not None and existing != target:
                    raise BlockedError(
                        reason=(
                            f"{self.environment_id} actor {role!r} has "
                            "ambiguous Home Station bindings"
                        ),
                        resource=f"{self.environment_id}:actor-topology",
                    )
                role_targets[role] = target
                selected_actors[role] = resolved_actors[service_id][role]
            prepare_bound_friendships(
                role_targets,
                tuple(selected_actors.values()),
            )
        if self.derives_fixture_federation_id:
            selected_actor_routes = tuple(
                next(
                    actor
                    for actor in stations[
                        client.service_bindings["station"].service_id
                    ]["actors"]
                    if actor["role"] == client.actor
                )
                for client in environment_clients
            )
            federation_id = fixture_federation_id_from_station_ids(
                actor["homeStationPeerId"] for actor in selected_actor_routes
            )
            if self.requires_actor_reset:
                federation_targets = {
                    service_id: (
                        service_bindings[service_id].endpoint,
                        service_bindings[service_id].deployment_environment,
                        tuple(sorted({
                            client.actor
                            for client in environment_clients
                            if client.service_bindings["station"].service_id
                            == service_id
                        })),
                    )
                    for service_id in station_service_ids
                }
                prepared_federation_id = prepare_federation_contexts(
                    federation_targets
                )
                if prepared_federation_id != federation_id:
                    raise BlockedError(
                        reason=(
                            f"{self.environment_id} Fixture Federation identity "
                            "does not match the actor manifest"
                        ),
                        resource=f"{self.environment_id}:fixture-federation",
                    )
            for station in stations.values():
                for actor in station["actors"]:
                    actor["federationId"] = federation_id
        payload = {
            "artifactKind": self.actor_manifest_kind,
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
                for client in environment_clients
            ],
            "reset": {
                "authorized": self.requires_actor_reset,
                "authorizationRef": (
                    station_reset_authorization_ref(reset_scope)
                    if self.requires_actor_reset
                    else None
                ),
                "targetVerified": self.requires_actor_reset,
            },
            "proofScope": dict(overlay["proof_scope"]),
        }
        return self.evidence_run.write_json(
            self.actor_manifest_path,
            payload,
        ).to_dict()

    @staticmethod
    def _reset_actor_fixture_target(
        station_url: str,
        deployment_environment: str,
        roles: tuple[str, ...],
        reset_scope: str,
    ) -> None:
        require_station_reset_authority(reset_scope)
        verify_reset_target(station_url, deployment_environment)
        reset_fixture(
            deployment_environment,
            roles,
            reset_authorized=True,
        )

    def _reset_scope(self) -> str:
        if len(self.contract.fixtures) != 1:
            raise BlockedError(
                reason=(
                    f"{self.environment_id} requires exactly one reset Fixture"
                ),
                resource=f"{self.environment_id}:fixture",
            )
        fixture = self.contract.fixtures[0]
        expected_ref = station_reset_authorization_ref(fixture.id)
        if (
            not fixture.authorization_required
            or fixture.authorization_ref != expected_ref
        ):
            raise BlockedError(
                reason=(
                    f"{self.environment_id} reset Fixture must bind "
                    f"{expected_ref}"
                ),
                resource=f"{self.environment_id}:fixture",
            )
        return fixture.id


class MobileSocialSimulatorProvisioner(
    _MobileTwoActorSimulatorProvisioner
):
    environment_id = "mobile-social-simulator"
    overlay_filename = "mobile-social-simulator.yaml"
    station_profile_keys = MOBILE_SOCIAL_STATION_PROFILE_KEYS
    service_profile_keys = MOBILE_SOCIAL_SERVICE_PROFILE_KEYS
    require_distinct_station_profiles = True
    requires_actor_reset = False
    derives_fixture_federation_id = False
    actor_manifest_kind = "mobile-social-simulator-actor-manifest"
    actor_manifest_path = "runtime/mobile-social-simulator-actors.json"
    ephemeral_gate_ids = frozenset(
        {"station-access-mobile-relay-native-e2e"}
    )

    def __init__(
        self,
        contract: EnvironmentContract,
        *,
        base_factory: Any = MobileSimulatorProvisioner,
        overlay_path: Path | None = None,
        station_profiles: Mapping[str, str] | None = None,
        service_profiles: Mapping[str, str] | None = None,
        session_factory: Callable[[str], Any] | None = None,
    ) -> None:
        super().__init__(
            contract,
            base_factory=base_factory,
            overlay_path=overlay_path,
            station_profiles=station_profiles,
            service_profiles=service_profiles,
        )
        self.session_factory = session_factory
        self._appium_handler: (
            MobileSimulatorAppiumCapabilityHandler | None
        ) = None
        self._appium_cleanup_registered = False

    def create_gate_launch_context(
        self,
        *,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
        required_capabilities: tuple[str, ...],
    ) -> EphemeralGateLaunchContext:
        if (
            gate_id not in self.ephemeral_gate_ids
            or required_capabilities != (SIMULATOR_APPIUM_CAPABILITY_ID,)
        ):
            raise BlockedError(
                reason=(
                    "Mobile Social simulator Gate requires the exact "
                    "simulator Appium capability and an allowed Gate identity"
                ),
                resource=f"ephemeral-capabilities:{gate_id}",
            )
        if (
            not isinstance(self._manifest, MobileSimulatorRuntimeManifest)
            or not self._manifest.is_ready()
            or self._base_manifest is None
            or evidence_run_id != self.evidence_run.run_id
            or provisioning_run_id != self._manifest.run_id
        ):
            raise BlockedError(
                reason="Mobile Relay parent authorities are not ready",
                resource=f"ephemeral-capabilities:{gate_id}:run-identities",
            )
        overlay = self._load_overlay()
        handler = MobileSimulatorAppiumCapabilityHandler(
            manifest=self._manifest.to_dict(),
            artifact_writer=self.evidence_run,
            session_factory=(
                self.session_factory or self._new_appium_session
            ),
            harness_actions=overlay["harness"]["required_actions"],
            actor_manifest=self.evidence_run.store.read_json(
                ArtifactRef.from_dict(self._manifest.actor_manifest_ref)
            ),
            sensitive_values=self._raw_authority_values(),
        )
        context = EphemeralGateLaunchContext(
            required_capabilities=required_capabilities,
            request_timeout_seconds=SIMULATOR_CAPABILITY_TIMEOUT_SECONDS,
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
                "Mobile Relay Appium sessions did not close"
            )

    def _raw_authority_values(self) -> tuple[str, ...]:
        return (
            MobileStationLifecycleSimulatorProvisioner
            ._raw_authority_values(self)
        )

    def _new_appium_session(self, client_id: str) -> Any:
        return (
            MobileStationLifecycleSimulatorProvisioner
            ._new_appium_session(self, client_id)
        )


class MobileDirectSimulatorProvisioner(
    _MobileTwoActorSimulatorProvisioner
):
    environment_id = DIRECT_SIMULATOR_ENVIRONMENT_ID
    overlay_filename = "mobile-direct-simulator.yaml"
    station_profile_keys = MOBILE_DIRECT_STATION_PROFILE_KEYS
    actor_manifest_kind = "mobile-direct-simulator-actor-manifest"
    actor_manifest_path = "runtime/mobile-direct-simulator-actors.json"

    def _inject_station_profile_bindings(
        self,
        profile_env: Mapping[str, str],
    ) -> dict[str, str]:
        requested = self._required_station_profiles()
        profile_name = requested.get("station")
        if not profile_name:
            return dict(profile_env)
        resolved_name, _, _, station_env = (
            resolve_machine_profile_environment(REPO_ROOT)
        )
        if resolved_name != profile_name:
            raise BlockedError(
                reason=(
                    "Mobile Direct profile binding does not match the "
                    f"active reviewed profile: requested={profile_name!r} "
                    f"active={resolved_name!r}"
                ),
                resource="service-profile:station",
            )
        if station_env.get("PT_STATION_MODE", "").strip() != "remote":
            raise BlockedError(
                reason="Mobile Direct requires a remote Station profile",
                resource="service-profile:station",
            )
        station_url = station_env.get("PT_STATION_URL", "").rstrip("/")
        deployment_environment = station_env.get(
            "PT_STATION_DEPLOY_ENV",
            "",
        ).strip()
        if not station_url or not deployment_environment:
            raise BlockedError(
                reason=(
                    "Mobile Direct active profile has no complete "
                    "endpoint/deployment binding"
                ),
                resource="service-profile:station",
            )
        url_key, deployment_key = self.station_profile_keys["station"]
        return {
            **profile_env,
            url_key: station_url,
            deployment_key: deployment_environment,
        }


class ChatMixedNativeProvisioner(_MobileTwoActorSimulatorProvisioner):
    environment_id = CHAT_MIXED_NATIVE_ENVIRONMENT_ID
    overlay_filename = "chat-mixed-native.yaml"
    station_profile_keys = MOBILE_SOCIAL_STATION_PROFILE_KEYS
    require_distinct_station_profiles = True
    prepare_cross_station_friendships = True
    actor_manifest_kind = "chat-mixed-native-actor-manifest"
    actor_manifest_path = "runtime/chat-mixed-native-actors.json"
    gate_ids = CHAT_MIXED_NATIVE_GATE_IDS
    child_harness_actions = CHAT_MIXED_NATIVE_HARNESS_ACTIONS

    def __init__(
        self,
        contract: EnvironmentContract,
        *,
        base_factory: Any = MobileSimulatorProvisioner,
        overlay_path: Path | None = None,
        station_profiles: Mapping[str, str] | None = None,
        service_profiles: Mapping[str, str] | None = None,
        session_factory: Callable[[str], Any] | None = None,
    ) -> None:
        super().__init__(
            contract,
            base_factory=base_factory,
            overlay_path=overlay_path,
            station_profiles=station_profiles,
            service_profiles=service_profiles,
        )
        self.session_factory = session_factory
        self._appium_handler: (
            MobileSimulatorAppiumCapabilityHandler | None
        ) = None
        self._appium_cleanup_registered = False

    def provision(self, gate_id: str) -> RuntimeManifest:
        if gate_id not in self.gate_ids:
            self._manifest = self._new_base_manifest(gate_id)
            return self._blocked(
                self._manifest,
                reason=f"unsupported Chat mixed-native Gate: {gate_id}",
                resource=f"gate-environment:{gate_id}",
            )
        manifest = super().provision(gate_id)
        if (
            manifest.is_blocked()
            or not isinstance(manifest, MobileSimulatorRuntimeManifest)
            or self._base_manifest is None
        ):
            return manifest
        try:
            if manifest.workspace_digest != "clean":
                raise BlockedError(
                    reason=(
                        "Chat mixed-native proof requires a clean "
                        "orchestrator source"
                    ),
                    resource="source-identity:workspace",
                )
            protocol_digest = source_proto_digest(REPO_ROOT)
            for service_id, service in manifest.services.items():
                if (
                    service.service_kind != "station"
                    or service.workspace_digest != "clean"
                    or not commits_match(
                        service.live_commit,
                        manifest.source_commit,
                    )
                    or service.protocol_digest != protocol_digest
                ):
                    raise BlockedError(
                        reason=(
                            "Chat mixed-native Station attestation does not "
                            f"match exact source: {service_id}"
                        ),
                        resource=f"source-identity:{service_id}",
                    )
            overlay = self._load_overlay()
            environment_clients = self._clients_for_gate(gate_id, overlay)
            desktop_clients = self._desktop_clients(
                manifest.run_id,
                clients=environment_clients,
            )
            mobile_clients = tuple(
                client
                for client in manifest.clients
                if client.runtime == "tauri-ios-simulator"
            )
            public_resources = (
                MobileStationLifecycleSimulatorProvisioner
                ._public_simulator_resources(
                    self._base_manifest.simulator_resources,
                    overlay,
                    client_ids=("sim-ios", "sim-ios-peer"),
                    environment_id=self.environment_id,
                )
            )
            ready = dataclasses.replace(
                manifest,
                clients=(*desktop_clients, *mobile_clients),
                simulator_resources=public_resources,
            )
            self._manifest = ready
            return ready
        except (BlockedError, ProvisioningError, ValueError, OSError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=(
                        "Chat mixed-native provisioning failed: "
                        f"{error}"
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
            gate_id not in self.gate_ids
            or required_capabilities != (SIMULATOR_APPIUM_CAPABILITY_ID,)
        ):
            raise BlockedError(
                reason=(
                    "Chat mixed-native Gate requires the exact simulator "
                    "Appium capability and an allowed Gate identity"
                ),
                resource=f"ephemeral-capabilities:{gate_id}",
            )
        if (
            not isinstance(self._manifest, MobileSimulatorRuntimeManifest)
            or not self._manifest.is_ready()
            or self._base_manifest is None
            or evidence_run_id != self.evidence_run.run_id
            or provisioning_run_id != self._manifest.run_id
        ):
            raise BlockedError(
                reason="Chat mixed-native parent authorities are not ready",
                resource=f"ephemeral-capabilities:{gate_id}:run-identities",
            )
        actor_manifest_ref = self._manifest.actor_manifest_ref
        if not isinstance(actor_manifest_ref, Mapping):
            raise BlockedError(
                reason="Chat mixed-native actor manifest is unavailable",
                resource=f"ephemeral-capabilities:{gate_id}:actor-manifest",
            )
        actor_manifest = self.evidence_run.store.read_json(
            ArtifactRef.from_dict(actor_manifest_ref)
        )
        overlay = self._load_overlay()
        handler = MobileSimulatorAppiumCapabilityHandler(
            manifest=self._manifest.to_dict(),
            artifact_writer=self.evidence_run,
            session_factory=(
                self.session_factory or self._new_appium_session
            ),
            harness_actions=overlay["harness"]["required_actions"],
            child_harness_actions=self.child_harness_actions,
            harness_result_projector=self._project_chat_harness_result,
            actor_manifest=actor_manifest,
            sensitive_values=self._raw_authority_values(),
        )
        context = EphemeralGateLaunchContext(
            required_capabilities=required_capabilities,
            request_timeout_seconds=SIMULATOR_CAPABILITY_TIMEOUT_SECONDS,
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

    def _desktop_clients(
        self,
        run_id: str,
        *,
        clients: Sequence[EnvironmentClient] | None = None,
    ) -> tuple[ClientRuntime, ...]:
        declared = tuple(
            client
            for client in (clients or self.contract.clients)
            if client.runtime == "native-tauri"
        )
        if {client.id for client in declared} != {
            "desktop-alice",
            "desktop-bob",
        }:
            raise BlockedError(
                reason=(
                    "Chat mixed-native environment requires Desktop Alice "
                    "and Desktop Bob clients"
                ),
                resource=f"{self.environment_id}:desktop-clients",
            )
        runtime_root = Path(
            tempfile.mkdtemp(prefix=f"peers-touch-{self.environment_id}-")
        )
        self.register_cleanup(
            "chat-mixed-desktop-storage",
            partial(shutil.rmtree, runtime_root),
        )
        ports: set[int] = set()

        def available_port() -> int:
            while True:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                    listener.bind(("127.0.0.1", 0))
                    port = int(listener.getsockname()[1])
                if port not in ports:
                    ports.add(port)
                    return port

        return tuple(
            ClientRuntime(
                id=client.id,
                actor=client.actor,
                runtime=client.runtime,
                worktree=str(REPO_ROOT),
                gateway_port=available_port(),
                renderer_port=available_port(),
                webdriver_port=available_port(),
                profile=f"{self.environment_id}-{run_id}-{client.id}",
                storage_root=str(runtime_root / client.id),
                required_service_roles=client.required_service_roles,
                service_bindings=client.service_bindings,
            )
            for client in declared
        )

    def _cleanup_appium_sessions(self) -> None:
        if self._appium_handler is None:
            return
        result = self._appium_handler.close()
        if not result.closed:
            raise ProvisioningError(
                "Chat mixed-native Appium sessions did not close"
            )

    @classmethod
    def _project_chat_harness_result(
        cls,
        action: str,
        value: object,
    ) -> object:
        if action == "lifecycle.scope.read":
            return value
        if action == "social.people.search" and isinstance(value, (list, tuple)):
            return {
                "entries": [
                    _project_device_identity_fields(item)
                    for item in value
                ],
            }
        return _project_device_identity_fields(value)

    @staticmethod
    def _identity_digest(value: object) -> str | None:
        return _device_identity_digest(value)

    def _raw_authority_values(self) -> tuple[str, ...]:
        return (
            MobileStationLifecycleSimulatorProvisioner
            ._raw_authority_values(self)
        )

    def _new_appium_session(self, client_id: str) -> Any:
        return (
            MobileStationLifecycleSimulatorProvisioner
            ._new_appium_session(self, client_id)
        )


class StationAccessNativeProvisioner(ChatMixedNativeProvisioner):
    environment_id = STATION_ACCESS_NATIVE_ENVIRONMENT_ID
    overlay_filename = "station-access-native.yaml"
    station_profile_keys = MOBILE_DIRECT_STATION_PROFILE_KEYS
    service_profile_keys = {}
    require_distinct_station_profiles = False
    prepare_cross_station_friendships = False
    requires_actor_reset = True
    derives_fixture_federation_id = False
    actor_manifest_kind = "station-access-native-actor-manifest"
    actor_manifest_path = "runtime/station-access-native-actors.json"
    gate_ids = STATION_ACCESS_NATIVE_GATE_IDS
    child_harness_actions = STATION_ACCESS_NATIVE_CHILD_HARNESS_ACTIONS

    def _inject_station_profile_bindings(
        self,
        profile_env: Mapping[str, str],
    ) -> dict[str, str]:
        requested = self._required_station_profiles()
        profile_name = requested.get("station")
        if not profile_name:
            return dict(profile_env)
        resolved_name, _, _, station_env = (
            resolve_machine_profile_environment(REPO_ROOT)
        )
        if resolved_name != profile_name:
            raise BlockedError(
                reason=(
                    "Station Access profile binding does not match the "
                    f"active reviewed profile: requested={profile_name!r} "
                    f"active={resolved_name!r}"
                ),
                resource="service-profile:station",
            )
        if station_env.get("PT_STATION_MODE", "").strip() != "remote":
            raise BlockedError(
                reason="Station Access requires a remote Station profile",
                resource="service-profile:station",
            )
        station_url = station_env.get("PT_STATION_URL", "").rstrip("/")
        deployment_environment = station_env.get(
            "PT_STATION_DEPLOY_ENV",
            "",
        ).strip()
        if not station_url or not deployment_environment:
            raise BlockedError(
                reason=(
                    "Station Access active profile has no complete "
                    "endpoint/deployment binding"
                ),
                resource="service-profile:station",
            )
        url_key, deployment_key = self.station_profile_keys["station"]
        return {
            **profile_env,
            url_key: station_url,
            deployment_key: deployment_environment,
        }
