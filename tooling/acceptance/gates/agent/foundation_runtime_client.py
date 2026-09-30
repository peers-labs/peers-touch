#!/usr/bin/env python3
"""Lifecycle controller for Foundation Native and Browser clients."""

from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import threading
import time
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
WEBDRIVER_SESSION_TIMEOUT_SECONDS = 30.0
WEBDRIVER_SESSION_RETRY_INTERVAL_SECONDS = 0.25
HARNESS_READY_TIMEOUT_SECONDS = 60.0
NATIVE_HARNESS_RELOAD_AFTER_SECONDS = 30.0


class FoundationClientError(RuntimeError):
    """A provisioned Foundation client failed its lifecycle contract."""


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
        except FoundationClientError:
            raise
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
        harness_namespace: str = "agent",
        launch_env: Mapping[str, str] | None = None,
        direct_station_binding: bool = False,
    ) -> None:
        if not harness_namespace or harness_namespace != harness_namespace.strip():
            raise FoundationClientError("Harness namespace is invalid")
        self.spec = spec
        self._station_proxy = TcpFaultProxy.from_url(station_url.rstrip("/"))
        self._fault_controller = TcpFaultProxyCutController(self._station_proxy)
        self._station_url = (
            station_url.rstrip("/")
            if direct_station_binding
            else self._station_proxy.url
        )
        self.profile_env = dict(profile_env)
        self.startup_timeout = startup_timeout
        self.harness_namespace = harness_namespace
        self.extra_launch_env = dict(launch_env or {})
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

    @property
    def station_url(self) -> str:
        return self._station_url

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
        environment = {
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
            "PT_ACCEPTANCE_NATIVE_DEV": (
                "1" if self.spec.runtime == "native-tauri" else "0"
            ),
            "PT_ACCEPTANCE_WEBDRIVER_PORT": str(self.spec.webdriver_port),
            "VITE_ACCEPTANCE_HARNESS": "1",
            "PT_AGENT_AS_F10_NEGATIVE_CONTROL": "1",
            "PT_AGENT_GFE1_EXECUTOR_CONTROL": "1",
            "TAURI_WEBDRIVER_PORT": str(self.spec.webdriver_port),
            "CARGO_TARGET_DIR": str(self.spec.cargo_target_dir),
            "RESTART": "1",
            "CARGO_BUILD_JOBS": "2",
        }
        collisions = sorted(set(environment).intersection(self.extra_launch_env))
        if collisions:
            raise FoundationClientError(
                "extra launch environment cannot override runtime-owned keys: "
                + ", ".join(collisions)
            )
        return {**environment, **self.extra_launch_env}

    def start(self) -> None:
        self._station_proxy.start()
        try:
            self._fault_controller.start()
            self._write_runtime_profile()
            self.log_handle = self.log_path.open("w", encoding="utf-8")
            environment = os.environ.copy()
            environment.update(self.launch_environment())
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
            self._connect_driver()
            self._wait_for_acceptance_harness()
        except BaseException as error:
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
            fault_ports, fault_failures = self._close_fault_transport()
            rollback_failures.extend(fault_failures)
            if rollback_failures or not all(fault_ports.values()):
                raise FoundationClientError(
                    f"{self.spec.runtime} startup failed: {error}; "
                    f"rollback failed: {rollback_failures}; "
                    f"faultPortsReleased={fault_ports}"
                ) from error
            raise

    def _wait_for_acceptance_harness(self) -> None:
        if self.driver is None:
            raise FoundationClientError(
                f"{self.spec.runtime} client is not connected"
            )
        initial_timeout = (
            NATIVE_HARNESS_RELOAD_AFTER_SECONDS
            if self.spec.runtime == "native-tauri"
            else HARNESS_READY_TIMEOUT_SECONDS
        )
        if harness_ready(
            self.driver,
            namespace=self.harness_namespace,
            timeout=initial_timeout,
        ):
            return
        if self.spec.runtime == "native-tauri":
            if (
                not self._process_alive()
                or not port_open(self.spec.renderer_port)
            ):
                raise FoundationClientError(
                    "native-tauri renderer became unavailable before "
                    f"{self.harness_namespace} acceptance Harness recovery"
                )
            navigation_error: Exception | None = None
            try:
                self.driver.get(
                    f"http://127.0.0.1:{self.spec.renderer_port}"
                )
            except Exception as error:
                navigation_error = error
            if harness_ready(
                self.driver,
                namespace=self.harness_namespace,
                timeout=(
                    HARNESS_READY_TIMEOUT_SECONDS
                    - NATIVE_HARNESS_RELOAD_AFTER_SECONDS
                ),
            ):
                return
            if navigation_error is not None:
                raise FoundationClientError(
                    "native-tauri acceptance Harness navigation recovery failed: "
                    f"{navigation_error}"
                ) from navigation_error
        raise FoundationClientError(
            f"{self.spec.runtime} {self.harness_namespace} acceptance "
            "Harness is unavailable"
        )

    def _connect_driver(self) -> None:
        if self.spec.runtime == "native-tauri":
            wait_until(
                lambda: self._process_alive() and port_open(self.spec.webdriver_port),
                "Native embedded WebDriver",
                self.startup_timeout,
            )
            endpoint = f"http://127.0.0.1:{self.spec.webdriver_port}"

            def connect_session() -> Any:
                self._process_alive()
                connection = RemoteConnection(
                    client_config=ClientConfig(
                        remote_server_addr=endpoint,
                        timeout=min(self.startup_timeout, 120),
                    ),
                )
                try:
                    driver = webdriver.Remote(
                        command_executor=connection,
                        options=ChromeOptions(),
                    )
                except BaseException:
                    connection.close()
                    raise
                self.driver = driver
                return driver

            wait_until(
                connect_session,
                "Native embedded WebDriver session",
                min(self.startup_timeout, WEBDRIVER_SESSION_TIMEOUT_SECONDS),
                interval=WEBDRIVER_SESSION_RETRY_INTERVAL_SECONDS,
            )
            return

        wait_until(
            lambda: self._process_alive()
            and port_open(self.spec.gateway_port)
            and port_open(self.spec.renderer_port),
            "Browser gateway and renderer",
            self.startup_timeout,
        )
        self.chrome = ChromeDriver(
            user_data_dir=str(self.spec.storage_root / "chrome"),
        )
        self.driver = self.chrome.start()
        self.chrome.navigate(f"http://localhost:{self.spec.renderer_port}")
        self.chrome.wait_for_ready(30)

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
        try:
            result = call_async_harness(
                self.driver,
                method,
                payload,
                namespace=self.harness_namespace,
                script_timeout=timeout,
            )
            return result
        except Exception as error:
            raise FoundationClientError(
                f"{self.spec.runtime} harness {method} failed: {error}"
            ) from error

    def configure_station(self, *, timeout: float = 60) -> dict[str, Any]:
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
            or not str(result.get("activeStationPeerId") or "").strip()
        ):
            raise FoundationClientError(
                f"{self.spec.runtime} Station configuration failed: {result}"
            )
        return dict(result)

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
        result = self._stop_runtime(logout=False, remove_storage=False)
        if result["status"] != "clean":
            raise FoundationClientError(
                f"{self.spec.runtime} restart cleanup failed: {result['failures']}"
            )
        self.start()

    def _stop_runtime(
        self,
        *,
        logout: bool,
        remove_storage: bool,
    ) -> dict[str, Any]:
        process = self.process
        process_group_id = self._process_group_id
        failures: list[str] = []
        if logout and self.driver is not None:
            previous_namespace = self.harness_namespace
            self.harness_namespace = "agent"
            try:
                self.harness("logout", timeout=30)
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                if port_open(self.spec.webdriver_port):
                    failures.append(f"logout: {error}")
            finally:
                self.harness_namespace = previous_namespace
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
                if port_open(self.spec.webdriver_port):
                    failures.append(f"webdriver: {error}")
            self.driver = None
        devctl_cleanup_failure: str | None = None
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
                    detail = (
                        completed.stderr.strip()
                        or completed.stdout.strip()
                        or "no output"
                    )
                    devctl_cleanup_failure = (
                        "devctl cleanup exited with "
                        f"status {completed.returncode}: {detail}"
                    )
                else:
                    self._managed_runtime_started = False
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                failures.append(f"devctl cleanup: {error}")
        process_released = process is None and process_group_id is None
        stale_process_group = False
        term_wait_completed: bool | None = None
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
            except PermissionError as error:
                if process is not None and process.poll() is None:
                    failures.append(f"process: {error}")
                else:
                    stale_process_group = True
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
        if self.spec.runtime == "native-tauri":
            failures.extend(self._stop_owned_listener_processes())
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
        if devctl_cleanup_failure:
            if process_released and all(ports.values()):
                self._managed_runtime_started = False
            else:
                failures.append(devctl_cleanup_failure)
        if (
            stale_process_group
            and all(ports.values())
            and not self._managed_runtime_started
        ):
            process_released = True
        if process_released:
            self.process = None
            self._process_group_id = None
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

    def _stop_owned_listener_processes(self) -> list[str]:
        failures: list[str] = []
        worktree = str(self.spec.worktree.resolve())
        ports = {
            self.spec.gateway_port,
            self.spec.renderer_port,
            self.spec.webdriver_port,
        }
        for port in ports:
            result = subprocess.run(
                ["lsof", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
                check=False,
                capture_output=True,
                text=True,
            )
            for value in result.stdout.split():
                try:
                    pid = int(value)
                    command = subprocess.run(
                        ["ps", "-p", str(pid), "-o", "command="],
                        check=False,
                        capture_output=True,
                        text=True,
                    ).stdout.strip()
                    if worktree not in command:
                        failures.append(
                            f"port {port} held by non-worktree process {pid}"
                        )
                        continue
                    os.kill(pid, signal.SIGTERM)
                    deadline = time.monotonic() + PROCESS_KILL_TIMEOUT_SECONDS
                    while port_open(port) and time.monotonic() < deadline:
                        WAIT_TICK.wait(0.05)
                    if port_open(port):
                        os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    continue
                except Exception as error:  # noqa: BLE001
                    failures.append(f"port {port} cleanup: {error}")
        return failures

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
