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

from tooling.acceptance.core.harness import call_async_harness, harness_ready
from tooling.acceptance.drivers.chrome import ChromeDriver


WAIT_TICK = threading.Event()


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
        self.station_url = station_url.rstrip("/")
        self.profile_env = dict(profile_env)
        self.startup_timeout = startup_timeout
        self.run_root = spec.storage_root.parent
        self.runtime_profile = self.run_root / f"{spec.profile}.env"
        self.log_path = self.run_root / f"{spec.runtime}.log"
        self.process: subprocess.Popen[str] | None = None
        self.log_handle: Any = None
        self.driver: Any = None
        self.chrome: ChromeDriver | None = None

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
            "PT_DEV_PROFILE": os.environ.get("PT_ACCEPTANCE_APPROVED_PROFILE", "one"),
            "PT_STATION_MODE": "remote",
            "PT_STATION_URL": self.station_url,
            "PEERS_STATION_URL": self.station_url,
            "PEERS_STORAGE_ROOT": str(self.spec.storage_root),
            "PEERS_ACTOR_IDENTITY_ROOT": str(self.actor_identity_root),
            "PT_DESKTOP_APP_GATEWAY_PORT": str(self.spec.gateway_port),
            "PT_DESKTOP_APP_WEB_PORT": str(self.spec.renderer_port),
            "PT_DESKTOP_WEB_GATEWAY_PORT": str(self.spec.gateway_port),
            "PT_DESKTOP_WEB_WEB_PORT": str(self.spec.renderer_port),
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
            "PT_DEV_PROFILE": os.environ.get("PT_ACCEPTANCE_APPROVED_PROFILE", "one"),
            "PT_DEV_PROFILE_FILE": str(self.runtime_profile),
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
            "PT_STATION_URL": self.station_url,
            "PEERS_STATION_URL": self.station_url,
            "PT_DESKTOP_E2E": "true",
            "PT_AGENT_AS_F10_NEGATIVE_CONTROL": "1",
            "TAURI_WEBDRIVER_PORT": str(self.spec.webdriver_port),
            "RESTART": "1",
            "CARGO_BUILD_JOBS": "2",
        }

    def start(self) -> None:
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
        self._connect_driver()
        if not harness_ready(self.driver, namespace="agent", timeout=60):
            raise FoundationClientError(
                f"{self.spec.runtime} Agent acceptance Harness is unavailable"
            )

    def _connect_driver(self) -> None:
        if self.spec.runtime == "native-tauri":
            wait_until(
                lambda: self._process_alive() and port_open(self.spec.webdriver_port),
                "Native embedded WebDriver",
                self.startup_timeout,
            )
            self.driver = webdriver.Remote(
                command_executor=f"http://127.0.0.1:{self.spec.webdriver_port}",
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
        self.chrome = ChromeDriver(
            user_data_dir=str(self.spec.storage_root / "chrome"),
        )
        self.driver = self.chrome.start()
        self.chrome.navigate(f"http://localhost:{self.spec.renderer_port}")
        self.chrome.wait_for_ready(30)

    def _process_alive(self) -> bool:
        if self.process is None:
            return False
        if self.process.poll() is not None:
            raise FoundationClientError(
                f"{self.spec.runtime} exited with code {self.process.returncode}"
            )
        return True

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
        return call_async_harness(
            self.driver,
            method,
            payload,
            namespace="agent",
            script_timeout=timeout,
        )

    def stop(self) -> dict[str, Any]:
        failures: list[str] = []
        if self.driver is not None:
            try:
                self.harness("logout", timeout=30)
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                failures.append(f"logout: {error}")
        if self.chrome is not None:
            self.chrome.stop()
            self.chrome = None
            self.driver = None
        elif self.driver is not None:
            try:
                self.driver.quit()
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                failures.append(f"webdriver: {error}")
            self.driver = None
        if self.process is not None and self.process.poll() is None:
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=5)
            except Exception as error:  # noqa: BLE001 - cleanup records failure.
                failures.append(f"process: {error}")
        self.process = None
        if self.log_handle is not None:
            self.log_handle.flush()
            self.log_handle.close()
            self.log_handle = None
        shutil.rmtree(self.spec.storage_root, ignore_errors=True)
        ports = {
            "gateway": not port_open(self.spec.gateway_port),
            "renderer": not port_open(self.spec.renderer_port),
            "webdriver": not port_open(self.spec.webdriver_port),
        }
        if not all(ports.values()):
            failures.append(f"ports still listening: {ports}")
        if self.spec.storage_root.exists():
            failures.append(f"storage remains: {self.spec.storage_root}")
        return {
            "status": "clean" if not failures else "failed",
            "portsReleased": ports,
            "storageReleased": not self.spec.storage_root.exists(),
            "failures": failures,
        }


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

    def stop(self) -> dict[str, Any]:
        results = {
            "browser": self.browser.stop(),
            "desktop_app": self.native.stop(),
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
