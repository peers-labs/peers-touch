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
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, TextIO

from tooling.acceptance.core import (
    BlockedError,
    ClientRuntime,
    EnvironmentContract,
    EnvironmentProvisioner,
    ProvisioningError,
    ProvisioningState,
    RuntimeManifest,
)
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR, REPO_ROOT
from tooling.acceptance.core.redaction import redact_value


IOS_RUNTIME = "iOS 17.4"
IOS_DEVICE_NAME = "iPhone 15 Pro"
ANDROID_AVD_NAME = "peers_touch_applet_l3_e2e"
ANDROID_ABI = "arm64-v8a"
ANDROID_BROWSER_PACKAGES = (
    "com.android.chrome",
    "com.google.android.webview",
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
    required_actions = {
        "lifecycle.restart",
        "native.deliverDeepLink",
        "projection.read",
        "cleanup",
    }
    if set(harness_actions) != required_actions:
        raise BlockedError(
            reason=(
                "Mobile simulator Harness actions must cover restart, native "
                "deep-link delivery, projection readback, and cleanup"
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

            command_env = {
                **os.environ,
                **spec.build_environment,
            }
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
                self._run_checked(
                    command,
                    env=command_env,
                    timeout=1800,
                    resource=f"mobile-simulator:build:{name}",
                )

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
    ) -> tuple[dict[str, str], bool]:
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
            and device.get("name") == spec.ios_device_name
            and device.get("isAvailable", True)
        ]
        if len(matches) != 1:
            raise BlockedError(
                reason=(
                    f"Required iOS Simulator {spec.ios_device_name!r} on "
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
            "name": spec.ios_device_name,
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
            f"application-uninstall:ios:{application_id}",
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
        for platform, driver in spec.drivers.items():
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
