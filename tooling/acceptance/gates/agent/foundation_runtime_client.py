#!/usr/bin/env python3
"""Lifecycle controller for Foundation Native and Browser clients."""

from __future__ import annotations

import json
import os
import shutil
import signal
import socket
import subprocess
import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.remote.client_config import ClientConfig
from selenium.webdriver.remote.remote_connection import RemoteConnection

from tooling.acceptance.core.harness import call_async_harness, harness_ready
from tooling.acceptance.drivers.chrome import ChromeDriver
from tooling.acceptance.gates.agent.tcp_fault_proxy import (
    TcpFaultProxy,
    TcpFaultProxyCutController,
)


WAIT_TICK = threading.Event()
PROCESS_TERMINATION_TIMEOUT_SECONDS = 15.0
PROCESS_KILL_TIMEOUT_SECONDS = 5.0


class FoundationClientError(RuntimeError):
    """A provisioned Foundation client failed its lifecycle contract."""


# #region debug-point A-F:foundation-native-harness-startup
def report_foundation_native_harness_startup_debug(
    hypothesis_id: str,
    message: str,
    data: Mapping[str, Any],
) -> None:
    try:
        env_path = (
            Path(__file__).resolve().parents[4]
            / ".dbg"
            / "foundation-native-harness-startup.env"
        )
        env_values = dict(
            line.split("=", 1)
            for line in env_path.read_text(encoding="utf-8").splitlines()
            if "=" in line
        )
        debug_url = env_values["DEBUG_SERVER_URL"]
        session_id = env_values["DEBUG_SESSION_ID"]
    except Exception:
        return
    payload = json.dumps(
        {
            "sessionId": session_id,
            "runId": os.environ.get("DEBUG_RUN_ID", "pre-fix"),
            "hypothesisId": hypothesis_id,
            "location": (
                "tooling/acceptance/gates/agent/"
                "foundation_runtime_client.py"
            ),
            "msg": f"[DEBUG] {message}",
            "data": dict(data),
            "ts": int(time.time() * 1000),
        }
    ).encode("utf-8")

    def send() -> None:
        try:
            with urllib.request.urlopen(
                urllib.request.Request(
                    debug_url,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                ),
                timeout=0.5,
            ) as response:
                response.read()
        except Exception:
            pass

    threading.Thread(
        target=send,
        name="foundation-native-harness-startup-debug-report",
        daemon=True,
    ).start()
# #endregion


def report_browser_f06_timeout_debug(
    hypothesis_id: str,
    message: str,
    data: Mapping[str, Any],
) -> None:
    # #region debug-point A-D:browser-f06-restart
    try:
        env_path = (
            Path(__file__).resolve().parents[4]
            / ".dbg"
            / "foundation-browser-f06-timeout.env"
        )
        env_values = dict(
            line.split("=", 1)
            for line in env_path.read_text(encoding="utf-8").splitlines()
            if "=" in line
        )
        debug_url = env_values["DEBUG_SERVER_URL"]
        session_id = env_values["DEBUG_SESSION_ID"]
    except Exception:
        debug_url = "http://127.0.0.1:7779/event"
        session_id = "foundation-browser-f06-timeout"
    payload = json.dumps(
        {
            "sessionId": session_id,
            "runId": os.environ.get("DEBUG_RUN_ID", "pre-fix"),
            "hypothesisId": hypothesis_id,
            "location": (
                "tooling/acceptance/gates/agent/"
                "foundation_runtime_client.py"
            ),
            "msg": f"[DEBUG] {message}",
            "data": dict(data),
            "ts": int(time.time() * 1000),
        }
    ).encode("utf-8")

    def send() -> None:
        try:
            urllib.request.urlopen(
                urllib.request.Request(
                    debug_url,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                ),
                timeout=0.5,
            ).read()
        except Exception:
            pass

    threading.Thread(
        target=send,
        name="foundation-browser-f06-debug-report",
        daemon=True,
    ).start()
    # #endregion


def report_identity_boot_debug(
    hypothesis_id: str,
    message: str,
    data: Mapping[str, Any],
) -> None:
    # #region debug-point A-D:foundation-launch-context
    try:
        urllib.request.urlopen(
            urllib.request.Request(
                "http://127.0.0.1:7778/event",
                data=json.dumps(
                    {
                        "sessionId": "foundation-identity-boot",
                        "runId": "pre-fix",
                        "hypothesisId": hypothesis_id,
                        "location": (
                            "tooling/acceptance/gates/agent/"
                            "foundation_runtime_client.py:restart"
                        ),
                        "msg": f"[DEBUG] {message}",
                        "data": dict(data),
                        "ts": int(time.time() * 1000),
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            ),
            timeout=1,
        ).read()
    except Exception:
        pass
    # #endregion


# #region debug-point A-D:native-restart-port-release
def _native_restart_debug_env() -> tuple[str, str] | None:
    env_path = (
        Path(__file__).resolve().parents[4]
        / ".dbg"
        / "native-restart-port-release.env"
    )
    try:
        env_values = dict(
            line.split("=", 1)
            for line in env_path.read_text(encoding="utf-8").splitlines()
            if "=" in line
        )
        return (
            env_values["DEBUG_SERVER_URL"],
            env_values["DEBUG_SESSION_ID"],
        )
    except Exception:
        return None


def report_native_restart_port_release_debug(
    hypothesis_id: str,
    message: str,
    data: Mapping[str, Any],
) -> None:
    debug_env = _native_restart_debug_env()
    if debug_env is None:
        return
    debug_url, session_id = debug_env
    payload = json.dumps(
        {
            "sessionId": session_id,
            "runId": os.environ.get("DEBUG_RUN_ID", "pre-fix"),
            "hypothesisId": hypothesis_id,
            "location": (
                "tooling/acceptance/gates/agent/"
                "foundation_runtime_client.py:_stop_runtime"
            ),
            "msg": f"[DEBUG] {message}",
            "data": dict(data),
            "ts": int(time.time() * 1000),
        }
    ).encode("utf-8")

    def send() -> None:
        try:
            with urllib.request.urlopen(
                urllib.request.Request(
                    debug_url,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                ),
                timeout=0.5,
            ) as response:
                response.read()
        except Exception:
            pass

    threading.Thread(
        target=send,
        name="native-restart-port-release-debug-report",
        daemon=True,
    ).start()


def _native_restart_process_snapshot(
    process: subprocess.Popen[str] | None,
    process_group_id: int | None,
) -> dict[str, Any]:
    process_id = None if process is None else process.pid
    process_return_code = None if process is None else process.poll()
    live_process_group_id: int | None = None
    live_session_id: int | None = None
    if process_id is not None and process_return_code is None:
        try:
            live_process_group_id = os.getpgid(process_id)
            live_session_id = os.getsid(process_id)
        except ProcessLookupError:
            pass
    return {
        "processPid": process_id,
        "processReturnCode": process_return_code,
        "storedProcessGroupId": process_group_id,
        "liveProcessGroupId": live_process_group_id,
        "liveSessionId": live_session_id,
        "storedProcessGroupAlive": (
            False
            if process_group_id is None
            else FoundationRuntimeClient._process_group_alive(
                process_group_id
            )
        ),
    }


def _native_restart_listener_snapshot(
    ports: Mapping[str, int],
) -> dict[str, Any]:
    if _native_restart_debug_env() is None:
        return {}
    snapshots: dict[str, Any] = {}
    for name, port in ports.items():
        try:
            result = subprocess.run(
                [
                    "lsof",
                    "-nP",
                    f"-iTCP:{port}",
                    "-sTCP:LISTEN",
                    "-FpcgR",
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=1,
            )
        except Exception as error:
            snapshots[name] = {
                "port": port,
                "errorType": type(error).__name__,
            }
            continue
        owners: list[dict[str, Any]] = []
        owner: dict[str, Any] | None = None
        for line in result.stdout.splitlines():
            if not line:
                continue
            field, value = line[0], line[1:]
            if field == "p":
                if owner is not None:
                    owners.append(owner)
                owner = {"pid": int(value)}
            elif owner is not None and field == "R":
                owner["parentPid"] = int(value)
            elif owner is not None and field == "g":
                owner["processGroupId"] = int(value)
            elif owner is not None and field == "c":
                owner["command"] = value
        if owner is not None:
            owners.append(owner)
        snapshots[name] = {
            "port": port,
            "lsofReturnCode": result.returncode,
            "owners": owners,
        }
    return snapshots
# #endregion


# #region debug-point A-D:browser-renderer-lifecycle
def report_browser_renderer_closed_debug(
    hypothesis_id: str,
    message: str,
    data: Mapping[str, Any],
) -> None:
    try:
        env_path = (
            Path(__file__).resolve().parents[4]
            / ".dbg"
            / "browser-renderer-closed.env"
        )
        env_values = dict(
            line.split("=", 1)
            for line in env_path.read_text(encoding="utf-8").splitlines()
            if "=" in line
        )
        debug_url = env_values["DEBUG_SERVER_URL"]
        session_id = env_values["DEBUG_SESSION_ID"]
    except Exception:
        debug_url = "http://127.0.0.1:7786/event"
        session_id = "browser-renderer-closed"
    payload = json.dumps(
        {
            "sessionId": session_id,
            "runId": os.environ.get("DEBUG_RUN_ID", "pre-fix"),
            "hypothesisId": hypothesis_id,
            "location": (
                "tooling/acceptance/gates/agent/"
                "foundation_runtime_client.py"
            ),
            "msg": f"[DEBUG] {message}",
            "data": dict(data),
            "ts": int(time.time() * 1000),
        }
    ).encode("utf-8")

    def send() -> None:
        try:
            urllib.request.urlopen(
                urllib.request.Request(
                    debug_url,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                ),
                timeout=0.5,
            ).read()
        except Exception:
            pass

    threading.Thread(
        target=send,
        name="browser-renderer-closed-debug-report",
        daemon=True,
    ).start()
# #endregion


def port_open(port: int) -> bool:
    """Check if a port is listening on localhost (IPv4 or IPv6)."""
    for family, addr in (
        (socket.AF_INET, "127.0.0.1"),
        (socket.AF_INET6, "::1"),
    ):
        try:
            with socket.socket(family) as probe:
                if probe.connect_ex((addr, port)) == 0:
                    return True
        except OSError:
            continue
    return False


def wait_until(
    predicate: Any,
    description: str,
    timeout: float,
    interval: float = 0.2,
) -> Any:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as error:  # noqa: BLE001 - retained for diagnostics.
            last_error = error
        WAIT_TICK.wait(min(interval, max(0.0, deadline - time.monotonic())))
    detail = f"; last error: {last_error}" if last_error else ""
    raise FoundationClientError(f"timed out waiting for {description}{detail}")


@dataclass(frozen=True)
class FoundationClientSpec:
    runtime: str
    worktree: Path
    gateway_port: int
    renderer_port: int
    webdriver_port: int
    storage_root: Path
    profile: str

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> FoundationClientSpec:
        spec = cls(
            runtime=str(value.get("runtime") or ""),
            worktree=Path(str(value.get("worktree") or "")).expanduser().resolve(),
            gateway_port=int(value.get("gateway_port") or 0),
            renderer_port=int(value.get("renderer_port") or 0),
            webdriver_port=int(value.get("webdriver_port") or 0),
            storage_root=Path(str(value.get("storage_root") or "")).expanduser(),
            profile=str(value.get("profile") or ""),
        )
        if spec.runtime not in {"native-tauri", "browser"}:
            raise FoundationClientError(
                f"unsupported Foundation client runtime: {spec.runtime}"
            )
        if not spec.worktree.is_dir():
            raise FoundationClientError(
                f"Foundation client worktree is missing: {spec.worktree}"
            )
        if not all(
            (spec.gateway_port, spec.renderer_port, spec.webdriver_port, spec.profile)
        ):
            raise FoundationClientError(
                f"{spec.runtime} Foundation client manifest is incomplete"
            )
        return spec

    @property
    def make_target(self) -> str:
        return "desktop" if self.runtime == "native-tauri" else "desktop-web"

    @property
    def surface(self) -> str:
        return "desktop" if self.runtime == "native-tauri" else "browser"

    @property
    def devctl_mode(self) -> str:
        return "app" if self.runtime == "native-tauri" else "web"

    @property
    def cargo_target_dir(self) -> Path:
        return (
            self.worktree
            / ".local"
            / "acceptance"
            / "cargo-target"
            / "agent-v2"
            / self.runtime
        )


class FoundationRuntimeClient:
    def __init__(
        self,
        spec: FoundationClientSpec,
        *,
        station_url: str,
        profile_env: Mapping[str, str],
        startup_timeout: float = 900,
    ) -> None:
        self.spec = spec
        self._station_proxy = TcpFaultProxy.from_url(station_url.rstrip("/"))
        self._fault_controller = TcpFaultProxyCutController(self._station_proxy)
        self._station_url = self._station_proxy.url
        self.profile_env = dict(profile_env)
        self.startup_timeout = startup_timeout
        self.run_root = spec.storage_root.parent
        self.dev_profile = os.environ.get(
            "PT_ACCEPTANCE_APPROVED_PROFILE",
            "one",
        )
        self.runtime_profile = self.run_root / f"{self.dev_profile}.env"
        self.log_path = self.run_root / f"{spec.runtime}.log"
        self.process: subprocess.Popen[str] | None = None
        self._process_group_id: int | None = None
        self._managed_runtime_started = False
        self.log_handle: Any = None
        self.driver: Any = None
        self.chrome: ChromeDriver | None = None
        self.restart_generation = 0

    @property
    def actor_identity_root(self) -> Path:
        return self.run_root.parent / "actor-identity"

    def _write_runtime_profile(self) -> None:
        self.run_root.mkdir(parents=True, exist_ok=True)
        self.spec.storage_root.mkdir(parents=True, exist_ok=True)
        self.actor_identity_root.mkdir(parents=True, exist_ok=True)
        self.actor_identity_root.chmod(0o700)
        values = {
            **self.profile_env,
            "PT_DEV_PROFILE": self.dev_profile,
            "PT_STATION_MODE": "remote",
            "PT_STATION_URL": self._station_url,
            "PEERS_STATION_URL": self._station_url,
            "PEERS_STORAGE_ROOT": str(self.spec.storage_root),
            "PEERS_ACTOR_IDENTITY_ROOT": str(self.actor_identity_root),
            "PT_DESKTOP_APP_GATEWAY_PORT": str(self.spec.gateway_port),
            "PT_DESKTOP_APP_WEB_PORT": str(self.spec.renderer_port),
            "PT_DESKTOP_WEB_GATEWAY_PORT": str(self.spec.gateway_port),
            "PT_DESKTOP_WEB_WEB_PORT": str(self.spec.renderer_port),
            "VITE_ACCEPTANCE_HARNESS": "1",
        }
        self.runtime_profile.write_text(
            "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
            + "\n",
            encoding="utf-8",
        )
        self.runtime_profile.chmod(0o600)

    def launch_environment(self) -> dict[str, str]:
        return {
            "WORKTREE_ID": self.spec.worktree.name,
            "PT_DEV_PROFILE": self.dev_profile,
            "PT_DEV_PROFILE_FILE": str(self.runtime_profile),
            "PT_DEV_PROFILE_FILE_AUTHORITY": "acceptance-runtime-manifest",
            "PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT": str(self.run_root),
            "PT_PROFILE": self.spec.profile,
            "GATEWAY_PORT": str(self.spec.gateway_port),
            "WEB_PORT": str(self.spec.renderer_port),
            "PT_DESKTOP_APP_GATEWAY_PORT": str(self.spec.gateway_port),
            "PT_DESKTOP_APP_WEB_PORT": str(self.spec.renderer_port),
            "PT_DESKTOP_WEB_GATEWAY_PORT": str(self.spec.gateway_port),
            "PT_DESKTOP_WEB_WEB_PORT": str(self.spec.renderer_port),
            "PEERS_STORAGE_ROOT": str(self.spec.storage_root),
            "PEERS_ACTOR_IDENTITY_ROOT": str(self.actor_identity_root),
            "PT_STATION_MODE": "remote",
            "PT_STATION_URL": self._station_url,
            "PEERS_STATION_URL": self._station_url,
            "PT_DESKTOP_E2E": "true",
            "VITE_ACCEPTANCE_HARNESS": "1",
            "PT_AGENT_AS_F10_NEGATIVE_CONTROL": "1",
            "PT_AGENT_GFE1_EXECUTOR_CONTROL": "1",
            "TAURI_WEBDRIVER_PORT": str(self.spec.webdriver_port),
            "CARGO_TARGET_DIR": str(self.spec.cargo_target_dir),
            "RESTART": "1",
            "CARGO_BUILD_JOBS": "2",
        }

    def start(self) -> None:
        start_started_at = time.monotonic()
        # #region debug-point C-D:runtime-start
        report_browser_f06_timeout_debug(
            "C-D",
            "runtime-start-entered",
            {
                "runtime": self.spec.runtime,
                "restartGeneration": self.restart_generation,
                "proxyAlive": self._station_proxy.is_alive,
                "faultControllerAlive": self._fault_controller.is_alive,
                "gatewayPortOpen": port_open(self.spec.gateway_port),
                "rendererPortOpen": port_open(self.spec.renderer_port),
                "webdriverPortOpen": port_open(self.spec.webdriver_port),
            },
        )
        # #endregion
        self._station_proxy.start()
        try:
            self._fault_controller.start()
            self._write_runtime_profile()
            self.log_handle = self.log_path.open("w", encoding="utf-8")
            environment = os.environ.copy()
            environment.update(self.launch_environment())
            # #region debug-point A:launch-environment
            report_foundation_native_harness_startup_debug(
                "A",
                "launch-environment-ready",
                {
                    "runtime": self.spec.runtime,
                    "makeTarget": self.spec.make_target,
                    "desktopE2E": environment.get("PT_DESKTOP_E2E") == "true",
                    "viteAcceptanceHarness": (
                        environment.get("VITE_ACCEPTANCE_HARNESS") == "1"
                    ),
                },
            )
            # #endregion
            self.process = subprocess.Popen(
                ["make", self.spec.make_target],
                cwd=self.spec.worktree,
                env=environment,
                stdout=self.log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            self._managed_runtime_started = True
            self._process_group_id = (
                self.process.pid if os.name == "posix" else None
            )
            # #region debug-point C:runtime-process-launched
            report_browser_f06_timeout_debug(
                "C",
                "runtime-process-launched",
                {
                    "runtime": self.spec.runtime,
                    "restartGeneration": self.restart_generation,
                    "processRunning": self.process.poll() is None,
                    "proxyAlive": self._station_proxy.is_alive,
                    "faultControllerAlive": self._fault_controller.is_alive,
                },
            )
            # #endregion
            self._connect_driver()
            # #region debug-point B-D:webdriver-connected
            report_foundation_native_harness_startup_debug(
                "B-D",
                "webdriver-connected",
                (
                    self._native_harness_debug_snapshot()
                    if self.spec.runtime == "native-tauri"
                    else {
                        "runtime": self.spec.runtime,
                        "driverPresent": self.driver is not None,
                    }
                ),
            )
            # #endregion
            agent_harness_ready = harness_ready(
                self.driver,
                namespace="agent",
                timeout=60,
            )
            # #region debug-point A-D:harness-probe
            report_foundation_native_harness_startup_debug(
                "A-D",
                "agent-harness-probe-completed",
                {
                    "runtime": self.spec.runtime,
                    "ready": agent_harness_ready,
                    **(
                        self._native_harness_debug_snapshot()
                        if self.spec.runtime == "native-tauri"
                        else {}
                    ),
                },
            )
            # #endregion
            if not agent_harness_ready:
                raise FoundationClientError(
                    f"{self.spec.runtime} Agent acceptance Harness is unavailable"
                )
            if self.spec.runtime == "native-tauri":
                # #region debug-point E-H:native-harness-ready
                report_native_restart_port_release_debug(
                    "E-H",
                    "native-runtime-harness-ready",
                    self._native_harness_debug_snapshot(),
                )
                # #endregion
            # #region debug-point A-C:runtime-start-completed
            report_browser_f06_timeout_debug(
                "A-C",
                "runtime-start-completed",
                {
                    "runtime": self.spec.runtime,
                    "restartGeneration": self.restart_generation,
                    "elapsedMs": int(
                        (time.monotonic() - start_started_at) * 1000
                    ),
                    "processRunning": self.process.poll() is None,
                    "gatewayPortOpen": port_open(self.spec.gateway_port),
                    "rendererPortOpen": port_open(self.spec.renderer_port),
                    "webdriverPortOpen": port_open(self.spec.webdriver_port),
                },
            )
            # #endregion
        except BaseException as error:
            # #region debug-point A-D:runtime-start-failed
            report_browser_f06_timeout_debug(
                "A-D",
                "runtime-start-failed",
                {
                    "runtime": self.spec.runtime,
                    "restartGeneration": self.restart_generation,
                    "elapsedMs": int(
                        (time.monotonic() - start_started_at) * 1000
                    ),
                    "errorType": type(error).__name__,
                    "processState": (
                        "missing"
                        if self.process is None
                        else (
                            "running"
                            if self.process.poll() is None
                            else "exited"
                        )
                    ),
                    "proxyAlive": self._station_proxy.is_alive,
                    "faultControllerAlive": self._fault_controller.is_alive,
                    "gatewayPortOpen": port_open(self.spec.gateway_port),
                    "rendererPortOpen": port_open(self.spec.renderer_port),
                    "webdriverPortOpen": port_open(self.spec.webdriver_port),
                },
            )
            # #endregion
            rollback_failures: list[str] = []
            try:
                rollback = self._stop_runtime(
                    logout=False,
                    remove_storage=True,
                )
                rollback_failures.extend(rollback["failures"])
            except BaseException as rollback_error:
                rollback_failures.append(
                    f"runtime cleanup: {rollback_error}"
                )
            # #region debug-point D:start-rollback-fault-close
            report_browser_f06_timeout_debug(
                "D",
                "startup-rollback-closing-fault-transport",
                {
                    "runtime": self.spec.runtime,
                    "restartGeneration": self.restart_generation,
                    "proxyAlive": self._station_proxy.is_alive,
                    "faultControllerAlive": self._fault_controller.is_alive,
                },
            )
            # #endregion
            fault_ports, fault_failures = self._close_fault_transport()
            rollback_failures.extend(fault_failures)
            if rollback_failures or not all(fault_ports.values()):
                raise FoundationClientError(
                    f"{self.spec.runtime} startup failed: {error}; "
                    f"rollback failed: {rollback_failures}; "
                    f"faultPortsReleased={fault_ports}"
                ) from error
            raise

    def _connect_driver(self) -> None:
        if self.spec.runtime == "native-tauri":
            wait_until(
                lambda: self._process_alive() and port_open(self.spec.webdriver_port),
                "Native embedded WebDriver",
                self.startup_timeout,
            )
            endpoint = f"http://127.0.0.1:{self.spec.webdriver_port}"
            connection = RemoteConnection(
                client_config=ClientConfig(
                    remote_server_addr=endpoint,
                    timeout=min(self.startup_timeout, 120),
                ),
            )
            self.driver = webdriver.Remote(
                command_executor=connection,
                options=ChromeOptions(),
            )
            return

        wait_until(
            lambda: self._process_alive()
            and port_open(self.spec.gateway_port)
            and port_open(self.spec.renderer_port),
            "Browser gateway and renderer",
            self.startup_timeout,
        )
        # #region debug-point C:browser-runtime-ready
        report_browser_f06_timeout_debug(
            "C",
            "browser-runtime-ports-ready",
            {
                "restartGeneration": self.restart_generation,
                "processRunning": self.process is not None
                and self.process.poll() is None,
                "gatewayPortOpen": port_open(self.spec.gateway_port),
                "rendererPortOpen": port_open(self.spec.renderer_port),
            },
        )
        # #endregion
        chrome_started_at = time.monotonic()
        self.chrome = ChromeDriver(
            user_data_dir=str(self.spec.storage_root / "chrome"),
        )
        self.driver = self.chrome.start()
        # #region debug-point B:chrome-started
        report_browser_f06_timeout_debug(
            "B",
            "chrome-started",
            {
                "restartGeneration": self.restart_generation,
                "elapsedMs": int((time.monotonic() - chrome_started_at) * 1000),
                "driverPresent": self.driver is not None,
                "chromeStoragePresent": (
                    self.spec.storage_root / "chrome"
                ).exists(),
            },
        )
        # #endregion
        navigation_started_at = time.monotonic()
        # #region debug-point A-C:browser-navigation
        report_browser_f06_timeout_debug(
            "A-C",
            "browser-navigation-started",
            {
                "restartGeneration": self.restart_generation,
                "processRunning": self.process is not None
                and self.process.poll() is None,
                "gatewayPortOpen": port_open(self.spec.gateway_port),
                "rendererPortOpen": port_open(self.spec.renderer_port),
            },
        )
        try:
            self.chrome.navigate(f"http://localhost:{self.spec.renderer_port}")
        except BaseException as error:
            report_browser_f06_timeout_debug(
                "A-C",
                "browser-navigation-failed",
                {
                    "restartGeneration": self.restart_generation,
                    "elapsedMs": int(
                        (time.monotonic() - navigation_started_at) * 1000
                    ),
                    "errorType": type(error).__name__,
                    "processState": (
                        "missing"
                        if self.process is None
                        else (
                            "running"
                            if self.process.poll() is None
                            else "exited"
                        )
                    ),
                    "gatewayPortOpen": port_open(self.spec.gateway_port),
                    "rendererPortOpen": port_open(self.spec.renderer_port),
                },
            )
            raise
        report_browser_f06_timeout_debug(
            "A-C",
            "browser-navigation-completed",
            {
                "restartGeneration": self.restart_generation,
                "elapsedMs": int(
                    (time.monotonic() - navigation_started_at) * 1000
                ),
                "processRunning": self.process is not None
                and self.process.poll() is None,
                "gatewayPortOpen": port_open(self.spec.gateway_port),
                "rendererPortOpen": port_open(self.spec.renderer_port),
            },
        )
        # #endregion
        self.chrome.wait_for_ready(30)
        # #region debug-point A-C:browser-session-ready
        if self.spec.runtime == "browser":
            report_browser_renderer_closed_debug(
                "A-C",
                "browser-session-ready",
                self._browser_lifecycle_debug_snapshot(),
            )
        # #endregion

    def _process_alive(self) -> bool:
        if self.process is None:
            return False
        return_code = self.process.poll()
        if return_code is None:
            return True
        if self._managed_runtime_started and return_code == 0:
            return True
        raise FoundationClientError(
            f"{self.spec.runtime} exited with code {return_code}"
        )

    # #region debug-point E-H:native-harness-snapshot
    def _native_harness_debug_snapshot(self) -> dict[str, Any]:
        snapshot = {
            "runtime": self.spec.runtime,
            "restartGeneration": self.restart_generation,
            **_native_restart_process_snapshot(
                self.process,
                self._process_group_id,
            ),
            "listeners": _native_restart_listener_snapshot(
                {
                    "gateway": self.spec.gateway_port,
                    "renderer": self.spec.renderer_port,
                    "webdriver": self.spec.webdriver_port,
                }
            ),
            "driverPresent": self.driver is not None,
        }
        if self.driver is None:
            return snapshot
        if not port_open(self.spec.webdriver_port):
            snapshot["domProbe"] = {"error": "webdriver-port-closed"}
            return snapshot
        raw_driver = (
            self.driver.driver
            if hasattr(self.driver, "driver")
            else self.driver
        )
        try:
            snapshot["domProbe"] = raw_driver.execute_script(
                """
                return {
                  url: String(window.location.href || ''),
                  readyState: String(document.readyState || ''),
                  rootElementPresent: Boolean(document.querySelector('#root')),
                  acceptanceRootPresent: Boolean(window.__PT_ACCEPTANCE__),
                  agentNamespacePresent: Boolean(
                    window.__PT_ACCEPTANCE__?.agent
                  ),
                  localeMethodPresent: Boolean(
                    window.__PT_ACCEPTANCE__?.agent?.setFoundationLocale
                  ),
                };
                """
            )
            snapshot["windowCount"] = len(raw_driver.window_handles)
        except Exception as error:
            snapshot["domProbe"] = {
                "errorType": type(error).__name__,
                "error": str(error)[:512],
            }
        return snapshot
    # #endregion

    # #region debug-point A-D:browser-runtime-snapshot
    def _browser_lifecycle_debug_snapshot(self) -> dict[str, Any]:
        process_return_code = (
            None if self.process is None else self.process.poll()
        )
        driver_service = (
            getattr(self.driver, "service", None)
            if self.driver is not None
            else None
        )
        driver_process = (
            getattr(driver_service, "process", None)
            if driver_service is not None
            else None
        )
        driver_return_code = (
            None if driver_process is None else driver_process.poll()
        )
        return {
            "runtime": self.spec.runtime,
            "restartGeneration": self.restart_generation,
            "processPid": (
                None if self.process is None else self.process.pid
            ),
            "processReturnCode": process_return_code,
            "processGroupId": self._process_group_id,
            "driverPresent": self.driver is not None,
            "driverSessionPresent": bool(
                getattr(self.driver, "session_id", None)
                if self.driver is not None
                else None
            ),
            "driverServicePid": (
                None if driver_process is None else driver_process.pid
            ),
            "driverServiceReturnCode": driver_return_code,
            "chromePresent": self.chrome is not None,
            "gatewayPortOpen": port_open(self.spec.gateway_port),
            "rendererPortOpen": port_open(self.spec.renderer_port),
            "webdriverPortOpen": port_open(self.spec.webdriver_port),
        }
    # #endregion

    def harness(
        self,
        method: str,
        payload: dict[str, Any] | None = None,
        timeout: float = 180,
    ) -> Any:
        if self.driver is None:
            raise FoundationClientError(
                f"{self.spec.runtime} client is not connected"
            )
        started_at = time.monotonic()
        native_locale_probe = (
            self.spec.runtime == "native-tauri"
            and method == "setFoundationLocale"
        )
        if native_locale_probe:
            # #region debug-point E-H:native-locale-call
            report_native_restart_port_release_debug(
                "E-H",
                "native-locale-call-started",
                self._native_harness_debug_snapshot(),
            )
            # #endregion
        if self.spec.runtime == "browser":
            # #region debug-point A-D:browser-harness-call
            report_browser_renderer_closed_debug(
                "A-D",
                "browser-harness-started",
                {
                    **self._browser_lifecycle_debug_snapshot(),
                    "method": method,
                    "cell": str((payload or {}).get("cell") or ""),
                },
            )
            # #endregion
        try:
            result = call_async_harness(
                self.driver,
                method,
                payload,
                namespace="agent",
                script_timeout=timeout,
            )
            if native_locale_probe:
                # #region debug-point E-H:native-locale-call-completed
                report_native_restart_port_release_debug(
                    "E-H",
                    "native-locale-call-completed",
                    {
                        **self._native_harness_debug_snapshot(),
                        "elapsedMs": int(
                            (time.monotonic() - started_at) * 1000
                        ),
                    },
                )
                # #endregion
            if self.spec.runtime == "browser":
                # #region debug-point A-D:browser-harness-result
                report_browser_renderer_closed_debug(
                    "A-D",
                    "browser-harness-completed",
                    {
                        **self._browser_lifecycle_debug_snapshot(),
                        "method": method,
                        "cell": str((payload or {}).get("cell") or ""),
                        "elapsedMs": int(
                            (time.monotonic() - started_at) * 1000
                        ),
                    },
                )
                # #endregion
            return result
        except Exception as error:
            if native_locale_probe:
                # #region debug-point E-H:native-locale-call-failed
                report_native_restart_port_release_debug(
                    "E-H",
                    "native-locale-call-failed",
                    {
                        **self._native_harness_debug_snapshot(),
                        "elapsedMs": int(
                            (time.monotonic() - started_at) * 1000
                        ),
                        "errorType": type(error).__name__,
                        "error": str(error)[:512],
                    },
                )
                # #endregion
            if self.spec.runtime == "browser":
                # #region debug-point A-D:browser-harness-failure
                report_browser_renderer_closed_debug(
                    "A-D",
                    "browser-harness-failed",
                    {
                        **self._browser_lifecycle_debug_snapshot(),
                        "method": method,
                        "cell": str((payload or {}).get("cell") or ""),
                        "elapsedMs": int(
                            (time.monotonic() - started_at) * 1000
                        ),
                        "errorType": type(error).__name__,
                        "error": str(error)[:512],
                    },
                )
                # #endregion
            # #region debug-point C:client-harness-failure
            try:
                urllib.request.urlopen(
                    urllib.request.Request(
                        "http://127.0.0.1:7778/event",
                        data=json.dumps(
                            {
                                "sessionId": "foundation-identity-boot",
                                "runId": "post-fix",
                                "hypothesisId": "C",
                                "location": (
                                    "tooling/acceptance/gates/agent/"
                                    "foundation_runtime_client.py:harness"
                                ),
                                "msg": "[DEBUG] client harness failed",
                                "data": {
                                    "runtime": self.spec.runtime,
                                    "method": method,
                                    "processState": (
                                        "missing"
                                        if self.process is None
                                        else (
                                            "running"
                                            if self.process.poll() is None
                                            else "exited"
                                        )
                                    ),
                                    "driverPresent": self.driver is not None,
                                    "chromePresent": self.chrome is not None,
                                    "gatewayPortOpen": port_open(
                                        self.spec.gateway_port
                                    ),
                                    "rendererPortOpen": port_open(
                                        self.spec.renderer_port
                                    ),
                                    "webdriverPortOpen": port_open(
                                        self.spec.webdriver_port
                                    ),
                                    "errorType": type(error).__name__,
                                },
                                "ts": int(time.time() * 1000),
                            }
                        ).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    ),
                    timeout=1,
                ).read()
            except Exception:
                pass
            # #endregion
            raise FoundationClientError(
                f"{self.spec.runtime} harness {method} failed: {error}"
            ) from error

    def configure_station(self, *, timeout: float = 60) -> None:
        result = self.harness(
            "configureStation",
            {"stationUrl": self._station_url},
            timeout=timeout,
        )
        if (
            not isinstance(result, Mapping)
            or result.get("configured") is not True
            or result.get("activeUrl") != self._station_url
            or result.get("peerIdAvailable") is not True
        ):
            raise FoundationClientError(
                f"{self.spec.runtime} Station configuration failed: {result}"
            )

    def prepare_foundation_f06(
        self,
        payload: Mapping[str, Any],
        *,
        timeout: float,
    ) -> Any:
        return self.harness(
            "foundationF06Prepare",
            {
                **payload,
                "faultControlUrl": self._fault_controller.cut_url,
            },
            timeout=timeout,
        )

    def restart(self) -> None:
        self.restart_generation += 1
        restart_started_at = time.monotonic()
        # #region debug-point A-D:client-restart
        report_browser_f06_timeout_debug(
            "A-D",
            "client-restart-entered",
            {
                "runtime": self.spec.runtime,
                "restartGeneration": self.restart_generation,
                "proxyAlive": self._station_proxy.is_alive,
                "faultControllerAlive": self._fault_controller.is_alive,
                "driverPresent": self.driver is not None,
                "chromePresent": self.chrome is not None,
            },
        )
        # #endregion
        report_identity_boot_debug(
            "A-D",
            "client-restart-started",
            {
                "runtime": self.spec.runtime,
                "restartGeneration": self.restart_generation,
                "storageRootPresent": self.spec.storage_root.exists(),
                "chromeStoragePresent": (
                    self.spec.storage_root / "chrome"
                ).exists(),
                "runtimeProfilePresent": self.runtime_profile.exists(),
            },
        )
        result = self._stop_runtime(logout=False, remove_storage=False)
        report_identity_boot_debug(
            "A-D",
            "client-restart-stopped",
            {
                "runtime": self.spec.runtime,
                "restartGeneration": self.restart_generation,
                "cleanupStatus": result["status"],
                "storagePreserved": result.get("storagePreserved"),
                "portsReleased": result.get("portsReleased"),
            },
        )
        if result["status"] != "clean":
            raise FoundationClientError(
                f"{self.spec.runtime} restart cleanup failed: {result['failures']}"
            )
        try:
            self.start()
        except BaseException as error:
            # #region debug-point A-D:client-restart-failed
            report_browser_f06_timeout_debug(
                "A-D",
                "client-restart-failed",
                {
                    "runtime": self.spec.runtime,
                    "restartGeneration": self.restart_generation,
                    "elapsedMs": int(
                        (time.monotonic() - restart_started_at) * 1000
                    ),
                    "errorType": type(error).__name__,
                    "proxyAlive": self._station_proxy.is_alive,
                    "faultControllerAlive": self._fault_controller.is_alive,
                },
            )
            # #endregion
            raise
        # #region debug-point A-D:client-restart-completed
        report_browser_f06_timeout_debug(
            "A-D",
            "client-restart-completed",
            {
                "runtime": self.spec.runtime,
                "restartGeneration": self.restart_generation,
                "elapsedMs": int(
                    (time.monotonic() - restart_started_at) * 1000
                ),
                "proxyAlive": self._station_proxy.is_alive,
                "faultControllerAlive": self._fault_controller.is_alive,
            },
        )
        # #endregion
        report_identity_boot_debug(
            "A-D",
            "client-restart-completed",
            {
                "runtime": self.spec.runtime,
                "restartGeneration": self.restart_generation,
                "storageRootPresent": self.spec.storage_root.exists(),
                "chromeStoragePresent": (
                    self.spec.storage_root / "chrome"
                ).exists(),
                "runtimeProfilePresent": self.runtime_profile.exists(),
                "driverPresent": self.driver is not None,
                "chromePresent": self.chrome is not None,
            },
        )

    def _stop_runtime(
        self,
        *,
        logout: bool,
        remove_storage: bool,
    ) -> dict[str, Any]:
        stop_started_at = time.monotonic()
        process = self.process
        process_group_id = self._process_group_id
        if self.spec.runtime == "native-tauri":
            report_native_restart_port_release_debug(
                "A-D",
                "native-runtime-stop-entered",
                {
                    "restartGeneration": self.restart_generation,
                    "logout": logout,
                    "removeStorage": remove_storage,
                    **_native_restart_process_snapshot(
                        process,
                        process_group_id,
                    ),
                    "listeners": _native_restart_listener_snapshot(
                        {
                            "gateway": self.spec.gateway_port,
                            "renderer": self.spec.renderer_port,
                            "webdriver": self.spec.webdriver_port,
                        }
                    ),
                },
            )
        # #region debug-point B-D:browser-runtime-stop
        if self.spec.runtime == "browser":
            report_browser_renderer_closed_debug(
                "B-D",
                "browser-runtime-stop-entered",
                {
                    **self._browser_lifecycle_debug_snapshot(),
                    "logout": logout,
                    "removeStorage": remove_storage,
                },
            )
        # #endregion
        failures: list[str] = []
        if logout and self.driver is not None:
            try:
                self.harness("logout", timeout=30)
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                failures.append(f"logout: {error}")
        if self.chrome is not None:
            try:
                self.chrome.stop()
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                failures.append(f"chrome: {error}")
            finally:
                self.chrome = None
                self.driver = None
        elif self.driver is not None:
            try:
                self.driver.quit()
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                failures.append(f"webdriver: {error}")
            self.driver = None
        if self.spec.runtime == "native-tauri":
            report_native_restart_port_release_debug(
                "A-D",
                "native-driver-stop-completed",
                {
                    "restartGeneration": self.restart_generation,
                    **_native_restart_process_snapshot(
                        process,
                        process_group_id,
                    ),
                    "listeners": _native_restart_listener_snapshot(
                        {
                            "gateway": self.spec.gateway_port,
                            "renderer": self.spec.renderer_port,
                            "webdriver": self.spec.webdriver_port,
                        }
                    ),
                },
            )
        process_released = process is None and process_group_id is None
        term_wait_completed: bool | None = None
        kill_sent = False
        kill_wait_completed: bool | None = None
        if os.name == "posix" and process_group_id is not None:
            try:
                self._signal_process_group(
                    process_group_id,
                    signal.SIGTERM,
                )
                term_wait_completed = self._wait_for_process_group_exit(
                    process_group_id,
                    process,
                    PROCESS_TERMINATION_TIMEOUT_SECONDS,
                )
                if not term_wait_completed:
                    kill_sent = True
                    self._signal_process_group(
                        process_group_id,
                        signal.SIGKILL,
                    )
                    kill_wait_completed = self._wait_for_process_group_exit(
                        process_group_id,
                        process,
                        PROCESS_KILL_TIMEOUT_SECONDS,
                    )
                    if not kill_wait_completed:
                        raise FoundationClientError(
                            f"process group {process_group_id} survived "
                            "forced termination"
                        )
                process_released = True
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                failures.append(f"process: {error}")
        elif process is not None and process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=PROCESS_TERMINATION_TIMEOUT_SECONDS)
                process_released = True
            except subprocess.TimeoutExpired:
                process.kill()
                try:
                    process.wait(timeout=PROCESS_KILL_TIMEOUT_SECONDS)
                    process_released = True
                except subprocess.TimeoutExpired as error:
                    failures.append(f"process: {error}")
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                failures.append(f"process: {error}")
        else:
            process_released = True
        if process_released:
            self.process = None
            self._process_group_id = None
        if self._managed_runtime_started:
            environment = os.environ.copy()
            environment.update(self.launch_environment())
            try:
                completed = subprocess.run(
                    [
                        "node",
                        "tooling/devctl/index.mjs",
                        "desktop",
                        "stop",
                        "--mode",
                        self.spec.devctl_mode,
                    ],
                    cwd=self.spec.worktree,
                    env=environment,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                if completed.returncode != 0:
                    failures.append(
                        "devctl cleanup exited with "
                        f"status {completed.returncode}"
                    )
                else:
                    self._managed_runtime_started = False
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                failures.append(f"devctl cleanup: {error}")
        if self.log_handle is not None:
            try:
                self.log_handle.flush()
                self.log_handle.close()
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                failures.append(f"log: {error}")
            finally:
                self.log_handle = None
        if remove_storage:
            shutil.rmtree(self.spec.storage_root, ignore_errors=True)
        ports = {
            "gateway": not port_open(self.spec.gateway_port),
            "renderer": not port_open(self.spec.renderer_port),
            "webdriver": not port_open(self.spec.webdriver_port),
        }
        # #region debug-point E-F:runtime-stop
        report_foundation_native_harness_startup_debug(
            "E-F",
            "runtime-stop-evaluated",
            {
                "runtime": self.spec.runtime,
                "processReleased": process_released,
                "termWaitCompleted": term_wait_completed,
                "killSent": kill_sent,
                "killWaitCompleted": kill_wait_completed,
                "portsReleased": ports,
                **_native_restart_process_snapshot(
                    process,
                    process_group_id,
                ),
                "listeners": _native_restart_listener_snapshot(
                    {
                        "gateway": self.spec.gateway_port,
                        "renderer": self.spec.renderer_port,
                        "webdriver": self.spec.webdriver_port,
                    }
                ),
            },
        )
        # #endregion
        if self.spec.runtime == "native-tauri":
            report_native_restart_port_release_debug(
                "A-D",
                "native-runtime-stop-evaluated",
                {
                    "restartGeneration": self.restart_generation,
                    "elapsedMs": int(
                        (time.monotonic() - stop_started_at) * 1000
                    ),
                    "processReleased": process_released,
                    "termWaitCompleted": term_wait_completed,
                    "killSent": kill_sent,
                    "killWaitCompleted": kill_wait_completed,
                    "portsReleased": ports,
                    **_native_restart_process_snapshot(
                        process,
                        process_group_id,
                    ),
                    "listeners": _native_restart_listener_snapshot(
                        {
                            "gateway": self.spec.gateway_port,
                            "renderer": self.spec.renderer_port,
                            "webdriver": self.spec.webdriver_port,
                        }
                    ),
                },
            )
        if not all(ports.values()):
            failures.append(f"ports still listening: {ports}")
        if remove_storage and self.spec.storage_root.exists():
            failures.append(f"storage remains: {self.spec.storage_root}")
        result = {
            "status": "clean" if not failures else "failed",
            "portsReleased": ports,
            "storageReleased": (
                not self.spec.storage_root.exists()
                if remove_storage
                else None
            ),
            "storagePreserved": (
                self.spec.storage_root.exists()
                if not remove_storage
                else None
            ),
            "failures": failures,
        }
        # #region debug-point B-D:browser-runtime-stopped
        if self.spec.runtime == "browser":
            report_browser_renderer_closed_debug(
                "B-D",
                "browser-runtime-stopped",
                {
                    **self._browser_lifecycle_debug_snapshot(),
                    "logout": logout,
                    "removeStorage": remove_storage,
                    "cleanupStatus": result["status"],
                    "cleanupFailures": list(failures),
                },
            )
        # #endregion
        return result

    @staticmethod
    def _signal_process_group(
        process_group_id: int,
        signal_number: signal.Signals,
    ) -> None:
        try:
            os.killpg(process_group_id, signal_number)
        except ProcessLookupError:
            return

    @staticmethod
    def _process_group_alive(process_group_id: int) -> bool:
        try:
            os.killpg(process_group_id, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    @classmethod
    def _wait_for_process_group_exit(
        cls,
        process_group_id: int,
        process: subprocess.Popen[str] | None,
        timeout: float,
    ) -> bool:
        deadline = time.monotonic() + timeout
        while cls._process_group_alive(process_group_id):
            if process is not None:
                process.poll()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            WAIT_TICK.wait(min(0.05, remaining))
        if process is not None:
            process.poll()
        return True

    def stop(self, *, remove_storage: bool = True) -> dict[str, Any]:
        try:
            result = self._stop_runtime(
                logout=True,
                remove_storage=remove_storage,
            )
        except BaseException as error:
            result = {
                "status": "failed",
                "portsReleased": {},
                "storageReleased": None,
                "storagePreserved": None,
                "failures": [f"runtime cleanup: {error}"],
            }
        fault_ports, fault_failures = self._close_fault_transport()
        result["portsReleased"].update(fault_ports)
        result["failures"].extend(fault_failures)
        if result["failures"]:
            result["status"] = "failed"
        return result

    def _close_fault_transport(self) -> tuple[dict[str, bool], list[str]]:
        failures: list[str] = []
        # #region debug-point D:fault-transport-close
        report_browser_f06_timeout_debug(
            "D",
            "fault-transport-close-started",
            {
                "runtime": self.spec.runtime,
                "restartGeneration": self.restart_generation,
                "proxyAlive": self._station_proxy.is_alive,
                "faultControllerAlive": self._fault_controller.is_alive,
            },
        )
        # #endregion
        try:
            self._fault_controller.close()
        except BaseException as error:
            failures.append(f"fault control cleanup: {error}")
        try:
            self._station_proxy.close()
        except BaseException as error:
            failures.append(f"fault proxy cleanup: {error}")
        ports = {
            "faultControl": not port_open(self._fault_controller.port),
            "faultProxy": not port_open(self._station_proxy.port),
        }
        if not ports["faultControl"]:
            failures.append("fault control port is still listening")
        if not ports["faultProxy"]:
            failures.append("fault proxy port is still listening")
        # #region debug-point D:fault-transport-closed
        report_browser_f06_timeout_debug(
            "D",
            "fault-transport-close-completed",
            {
                "runtime": self.spec.runtime,
                "restartGeneration": self.restart_generation,
                "proxyAlive": self._station_proxy.is_alive,
                "faultControllerAlive": self._fault_controller.is_alive,
                "faultControlPortReleased": ports["faultControl"],
                "faultProxyPortReleased": ports["faultProxy"],
                "failureCount": len(failures),
            },
        )
        # #endregion
        return ports, failures

    def restore_station_transport(self) -> None:
        self._station_proxy.restore()


class FoundationRuntimePair:
    def __init__(
        self,
        native: FoundationRuntimeClient,
        browser: FoundationRuntimeClient,
    ) -> None:
        self.native = native
        self.browser = browser

    @classmethod
    def from_manifest(
        cls,
        manifest: Mapping[str, Any],
        *,
        profile_env: Mapping[str, str],
        startup_timeout: float = 900,
    ) -> FoundationRuntimePair:
        station = manifest.get("station")
        clients = manifest.get("clients")
        if not isinstance(station, Mapping) or not str(station.get("url") or ""):
            raise FoundationClientError("Foundation runtime manifest has no Station URL")
        if not isinstance(clients, list) or len(clients) != 2:
            raise FoundationClientError(
                "Foundation runtime manifest requires Native and Browser clients"
            )
        by_runtime = {
            str(client.get("runtime") or ""): client
            for client in clients
            if isinstance(client, Mapping)
        }
        if set(by_runtime) != {"native-tauri", "browser"}:
            raise FoundationClientError(
                "Foundation runtime manifest client identities are invalid"
            )
        station_url = str(station["url"])
        return cls(
            FoundationRuntimeClient(
                FoundationClientSpec.from_mapping(by_runtime["native-tauri"]),
                station_url=station_url,
                profile_env=profile_env,
                startup_timeout=startup_timeout,
            ),
            FoundationRuntimeClient(
                FoundationClientSpec.from_mapping(by_runtime["browser"]),
                station_url=station_url,
                profile_env=profile_env,
                startup_timeout=startup_timeout,
            ),
        )

    def start(self) -> None:
        started: list[FoundationRuntimeClient] = []
        try:
            for client in (self.native, self.browser):
                client.start()
                started.append(client)
        except Exception:
            for client in reversed(started):
                client.stop()
            raise

    def stop(self, *, remove_storage: bool = True) -> dict[str, Any]:
        results = {
            "browser": self.browser.stop(remove_storage=remove_storage),
            "desktop_app": self.native.stop(remove_storage=remove_storage),
        }
        actor_identity_roots = {
            self.native.actor_identity_root,
            self.browser.actor_identity_root,
        }
        for root in actor_identity_roots:
            shutil.rmtree(root, ignore_errors=True)
        actor_identity_released = all(
            not root.exists() for root in actor_identity_roots
        )
        return {
            "status": (
                "clean"
                if all(item["status"] == "clean" for item in results.values())
                and actor_identity_released
                else "failed"
            ),
            "clients": results,
            "actorIdentityReleased": actor_identity_released,
        }
