#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import signal
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import warnings
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Generator, Mapping, Optional, Protocol

from selenium import webdriver
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from selenium.common.exceptions import TimeoutException

from tooling.acceptance.core import (
    AppLauncher,
    AppLaunchMetadata,
    DomDriver,
    REPO_ROOT,
)
from tooling.acceptance.core.errors import DriverError


DEFAULT_PORT = 4445
APP_STARTUP_TIMEOUT = 20.0
SCRIPT_TIMEOUT = 10.0
EXPECTED_TITLE = "Peers Touch Desktop"
EXPECTED_URL = "tauri://localhost"
DEDICATED_APP_BINARY = ".local/acceptance/bin/peers-touch-desktop"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


class RuntimeRelease(Protocol):
    def __call__(self, *, preserve_state: bool = False) -> None:
        ...


def find_app_binary() -> str:
    override = os.environ.get("PT_ACCEPTANCE_APP_BINARY", "").strip()
    candidates = [override] if override else [DEDICATED_APP_BINARY]
    for candidate in candidates:
        path = Path(candidate)
        if not path.is_absolute():
            path = REPO_ROOT / path
        if path.exists():
            return str(path)
    raise FileNotFoundError(
        "Dedicated Tauri Acceptance binary not found. "
        "Run: make acceptance-driver-build\n"
        f"Searched: {[str(REPO_ROOT / c) if not Path(c).is_absolute() else c for c in candidates]}"
    )


def _webdriver_url(host: str, port: int) -> str:
    rendered_host = f"[{host}]" if ":" in host else host
    return f"http://{rendered_host}:{port}"


def _wait_for_webdriver(host: str, port: int, timeout: float) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(
                f"{_webdriver_url(host, port)}/status",
                timeout=2,
            )
            return
        except Exception:
            time.sleep(0.5)
    raise TimeoutError(
        f"Embedded WebDriver did not become ready on port {port} within {timeout}s. "
        f"Ensure the app was built with --features acceptance-webdriver."
    )


def _available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def resolve_smoke_port(port: int) -> int:
    if port == 0:
        return _available_port()
    if port < 1 or port > 65535:
        raise ValueError("Tauri smoke WebDriver port must be 0 or 1..65535")
    return port


class TauriDriver(DomDriver):
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = DEFAULT_PORT,
        log_path: Path | None = None,
    ) -> None:
        if host not in LOOPBACK_HOSTS:
            raise ValueError("Tauri WebDriver endpoint must be loopback")
        self.host = host
        self.port = port
        self.log_path = log_path
        self._driver: WebDriver | None = None

    @property
    def driver(self) -> WebDriver:
        if self._driver is None:
            raise RuntimeError("TauriDriver is not connected")
        return self._driver

    def start(self) -> WebDriver:
        return self.connect()

    def connect(self, timeout: float = APP_STARTUP_TIMEOUT) -> WebDriver:
        if self._driver is not None:
            return self._driver
        try:
            _wait_for_webdriver(self.host, self.port, timeout)
            self._connect_session()
            return self.driver
        except Exception:
            self.stop()
            raise

    def stop(self) -> None:
        if self._driver:
            try:
                self._driver.quit()
            except Exception as error:
                warnings.warn(f"failed to close WebDriver session: {error}", RuntimeWarning)
            self._driver = None

    def wait_for_ready(self, timeout: float = APP_STARTUP_TIMEOUT) -> dict[str, Any]:
        def renderer_state(driver: WebDriver):
            try:
                state = driver.execute_script(
                    """
                    return {
                      hasRoot: Boolean(document.querySelector('#root')),
                      hasTauri: typeof window.__TAURI_INTERNALS__ === 'object'
                               || typeof window.__TAURI__ === 'object',
                      readyState: document.readyState,
                      title: document.title,
                      url: location.href,
                    };
                    """
                )
            except TimeoutException:
                return False
            if (
                state.get("hasRoot")
                and state.get("hasTauri")
                and state.get("title") == EXPECTED_TITLE
                and state.get("url") == EXPECTED_URL
            ):
                return state
            return False

        try:
            return WebDriverWait(self.driver, timeout).until(renderer_state)
        except TimeoutException as error:
            log_tail = ""
            if self.log_path and self.log_path.exists():
                log_tail = self.log_path.read_text(
                    encoding="utf-8", errors="replace"
                )[-4000:]
            raise DriverError(
                f"Tauri renderer did not become ready within {timeout}s; "
                f"app_log={self.log_path}\n{log_tail}"
            ) from error

    def wait_for_acceptance_harness(self, timeout: float = APP_STARTUP_TIMEOUT) -> None:
        self._driver.set_script_timeout(SCRIPT_TIMEOUT)

        def harness_ready(driver: WebDriver) -> bool:
            try:
                return bool(
                    driver.execute_script(
                        "return Boolean(document.querySelector('#root')"
                        " && window.__PT_ACCEPTANCE__)"
                    )
                )
            except TimeoutException:
                return False

        try:
            WebDriverWait(self.driver, timeout).until(harness_ready)
        except TimeoutException as error:
            log_tail = ""
            if self.log_path and self.log_path.exists():
                log_tail = self.log_path.read_text(
                    encoding="utf-8", errors="replace"
                )[-4000:]
            raise DriverError(
                f"Tauri acceptance harness did not become ready within {timeout}s; "
                f"app_log={self.log_path}\n{log_tail}"
            ) from error

    def execute_script(self, script: str, *args: Any) -> Any:
        return self.driver.execute_script(script, *args)

    def execute_async_script(self, script: str, *args: Any) -> Any:
        return self.driver.execute_async_script(script, *args)

    def find_element(self, selector: str, timeout: float = 10.0) -> Any:
        return WebDriverWait(self.driver, timeout).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, selector))
        )

    def find_elements(self, selector: str) -> list[Any]:
        return self.driver.find_elements(By.CSS_SELECTOR, selector)

    def is_alive(self) -> bool:
        return self._driver is not None

    def wait_for_renderer(self, timeout: float = APP_STARTUP_TIMEOUT) -> dict[str, Any]:
        return self.wait_for_ready(timeout)

    def save_screenshot(self, path: str | Path) -> None:
        self.driver.save_screenshot(str(path))

    def get_page_source(self) -> str:
        return self.driver.page_source or ""

    def get_current_url(self) -> str:
        return self.driver.current_url or ""

    def wait_for_element(self, css_selector: str, timeout: float = 10.0):
        return self.find_element(css_selector, timeout)

    def find_by_pt_attr(self, attr_name: str, timeout: float = 10.0):
        return self.find_element(f"[data-pt-{attr_name}]", timeout)

    def get_title(self) -> str:
        return self.driver.title

    def _connect_session(self) -> None:
        self._driver = webdriver.Remote(
            command_executor=_webdriver_url(self.host, self.port),
            options=webdriver.ChromeOptions(),
        )
        self._driver.set_script_timeout(SCRIPT_TIMEOUT)


class LocalTauriLauncher(AppLauncher):
    def __init__(
        self,
        app_binary: str | None = None,
        port: int = DEFAULT_PORT,
        gateway_port: int | None = None,
        profile: str | None = None,
        storage_root: str | None = None,
        environment: Mapping[str, str] | None = None,
        log_path: str | Path | None = None,
    ) -> None:
        self.app_binary = app_binary or find_app_binary()
        self.port = port
        self.gateway_port = gateway_port or _available_port()
        self.profile = profile or f"acceptance-webdriver-{port}"
        self.storage_root = storage_root or tempfile.mkdtemp(
            prefix=f"peers-touch-webdriver-storage-{port}-"
        )
        self.environment = dict(environment or {})
        self._owns_storage_root = storage_root is None
        self._process: subprocess.Popen[bytes] | None = None
        self._log_file: Any | None = None
        self.log_path = (
            Path(log_path).expanduser()
            if log_path is not None
            else None
        )

    @property
    def metadata(self) -> AppLaunchMetadata:
        return AppLaunchMetadata(
            webdriver_host="127.0.0.1",
            webdriver_port=self.port,
            gateway_port=self.gateway_port,
            profile=self.profile,
            storage_root=self.storage_root,
            process_id=self._process.pid if self._process is not None else None,
            log_path=self.log_path,
        )

    def start(self) -> AppLaunchMetadata:
        if self._process is not None and self._process.poll() is None:
            return self.metadata
        env = os.environ.copy()
        env["TAURI_WEBDRIVER_PORT"] = str(self.port)
        env["PT_GATEWAY_PORT"] = str(self.gateway_port)
        env["PT_PROFILE"] = self.profile
        env["PEERS_STORAGE_ROOT"] = self.storage_root
        env.update(self.environment)
        if self.log_path is None:
            self._log_file = tempfile.NamedTemporaryFile(
                prefix=f"peers-touch-webdriver-{self.port}-",
                suffix=".log",
                delete=False,
            )
            self.log_path = Path(self._log_file.name)
        else:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            self._log_file = self.log_path.open("wb")
        self._process = subprocess.Popen(
            [self.app_binary],
            env=env,
            stdout=self._log_file,
            stderr=subprocess.STDOUT,
        )
        time.sleep(1.0)
        if self._process.poll() is not None:
            self._log_file.flush()
            output = self.log_path.read_text(encoding="utf-8", errors="replace")
            return_code = self._process.returncode
            self.stop()
            raise DriverError(
                f"Tauri app exited immediately (code {return_code}): {output}"
            )
        return self.metadata

    def stop(self, *, preserve_state: bool = False) -> None:
        cleanup_errors: list[str] = []
        if self._process is not None:
            try:
                if self._process.poll() is None:
                    self._process.terminate()
                    try:
                        self._process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self._process.kill()
                        self._process.wait(timeout=3)
            except Exception as error:
                cleanup_errors.append(f"process: {error}")
            finally:
                self._process = None
        if self._log_file is not None:
            try:
                self._log_file.close()
            except Exception as error:
                cleanup_errors.append(f"log: {error}")
            finally:
                self._log_file = None
        if self._owns_storage_root and not preserve_state:
            try:
                shutil.rmtree(self.storage_root)
            except FileNotFoundError:
                pass
            except Exception as error:
                cleanup_errors.append(f"storage: {error}")
        if cleanup_errors:
            raise DriverError(
                "local Tauri launcher cleanup failed: "
                + "; ".join(cleanup_errors)
            )

    def is_alive(self) -> bool:
        return self._process is not None and self._process.poll() is None


class MakeDesktopLauncher(AppLauncher):
    """Launch an isolated native development client through `make desktop`."""

    def __init__(
        self,
        *,
        worktree: str | Path,
        port: int,
        gateway_port: int,
        renderer_port: int,
        profile: str,
        storage_root: str,
        environment: Mapping[str, str] | None = None,
        startup_timeout: float = 900.0,
    ) -> None:
        self.worktree = Path(worktree).resolve()
        self.port = port
        self.gateway_port = gateway_port
        self.renderer_port = renderer_port
        self.profile = profile
        self.storage_root = storage_root
        self.environment = dict(environment or {})
        self.startup_timeout = startup_timeout
        self._process: subprocess.Popen[bytes] | None = None
        self._runtime_pid: int | None = None
        self._log_file: Any | None = None
        self.log_path: Path | None = None
        self._launch_environment: dict[str, str] | None = None
        self._runtime_profile_root: Path | None = None

    @property
    def metadata(self) -> AppLaunchMetadata:
        return AppLaunchMetadata(
            webdriver_host="127.0.0.1",
            webdriver_port=self.port,
            gateway_port=self.gateway_port,
            profile=self.profile,
            storage_root=self.storage_root,
            process_id=self._runtime_pid,
            log_path=self.log_path,
        )

    def start(self) -> AppLaunchMetadata:
        if self._process is not None and self._process.poll() is None:
            return self.metadata
        if not (self.worktree / "Makefile").is_file():
            raise DriverError(
                f"Native Desktop worktree has no Makefile: {self.worktree}"
            )
        Path(self.storage_root).mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env.update(self.environment)
        runtime_profile = self._prepare_runtime_profile()
        env.update(
            {
                "PT_ACCEPTANCE_NATIVE_DEV": "1",
                "PT_DESKTOP_E2E": "true",
                "VITE_ACCEPTANCE_HARNESS": "1",
                "PT_ACCEPTANCE_WEBDRIVER_PORT": str(self.port),
                "TAURI_WEBDRIVER_PORT": str(self.port),
                "PT_GATEWAY_PORT": str(self.gateway_port),
                "PT_RENDERER_PORT": str(self.renderer_port),
                "PT_PROFILE": self.profile,
                "PEERS_STORAGE_ROOT": self.storage_root,
                "DESKTOP_RUST_STARTUP_TIMEOUT_SECONDS": str(
                    max(1, int(self.startup_timeout))
                ),
                "PT_DEV_PROFILE_FILE": str(runtime_profile),
                "PT_DEV_PROFILE_FILE_AUTHORITY": "acceptance-runtime-manifest",
                "PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT": str(
                    runtime_profile.parent
                ),
            }
        )
        self._launch_environment = env
        self._log_file = tempfile.NamedTemporaryFile(
            prefix=f"peers-touch-make-desktop-{self.port}-",
            suffix=".log",
            delete=False,
        )
        self.log_path = Path(self._log_file.name)
        self._process = subprocess.Popen(
            ["make", "desktop"],
            cwd=self.worktree,
            env=env,
            stdout=self._log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        deadline = time.monotonic() + self.startup_timeout
        try:
            while time.monotonic() < deadline:
                return_code = self._process.poll()
                if return_code not in (None, 0):
                    raise DriverError(
                        "make desktop exited before native readiness "
                        f"(code {return_code}): {self._log_tail()}"
                    )
                try:
                    urllib.request.urlopen(
                        f"{_webdriver_url('127.0.0.1', self.port)}/status",
                        timeout=1,
                    ).close()
                except Exception:
                    time.sleep(0.25)
                    continue
                self._runtime_pid = self._owned_listener_pid(
                    self.port,
                    self._managed_process_pid(),
                )
                return self.metadata
            raise DriverError(
                "make desktop did not expose embedded WebDriver within "
                f"{self.startup_timeout}s: {self._log_tail()}"
            )
        except Exception:
            self.stop()
            raise

    def stop(self, *, preserve_state: bool = False) -> None:
        del preserve_state
        errors: list[str] = []
        process = self._process
        if self._launch_environment is not None:
            try:
                stopped = subprocess.run(
                    ["make", "desktop-stop"],
                    cwd=self.worktree,
                    env=self._launch_environment,
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=30,
                )
                if stopped.returncode != 0:
                    errors.append(
                        "managed-runtime: "
                        + (stopped.stderr.strip() or stopped.stdout.strip())
                    )
            except Exception as error:
                errors.append(f"managed-runtime: {error}")
        if process is not None:
            try:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)
            except ProcessLookupError:
                pass
            except Exception as error:
                errors.append(f"process: {error}")
            finally:
                self._process = None
                self._runtime_pid = None
        self._launch_environment = None
        if self._log_file is not None:
            try:
                self._log_file.close()
            except Exception as error:
                errors.append(f"log: {error}")
            finally:
                self._log_file = None
        if self._runtime_profile_root is not None:
            try:
                shutil.rmtree(self._runtime_profile_root)
            except FileNotFoundError:
                pass
            except Exception as error:
                errors.append(f"runtime-profile: {error}")
            finally:
                self._runtime_profile_root = None
        if errors:
            raise DriverError(
                "make Desktop launcher cleanup failed: " + "; ".join(errors)
            )

    def is_alive(self) -> bool:
        if self._runtime_pid is None:
            return self._process is not None and self._process.poll() is None
        try:
            os.kill(self._runtime_pid, 0)
        except (ProcessLookupError, PermissionError):
            return False
        return True

    def runtime_binary_path(self) -> Path:
        if self._runtime_pid is None:
            raise DriverError("make Desktop runtime process identity is unavailable")
        completed = subprocess.run(
            [
                "lsof",
                "-a",
                "-p",
                str(self._runtime_pid),
                "-d",
                "txt",
                "-Fn",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        candidates = {
            Path(line[1:]).resolve()
            for line in completed.stdout.splitlines()
            if line.startswith("n")
            and Path(line[1:]).name == "peers-touch-desktop"
            and Path(line[1:]).is_file()
        }
        if len(candidates) != 1:
            raise DriverError(
                "make Desktop executable identity is ambiguous for process "
                f"{self._runtime_pid}: {sorted(str(path) for path in candidates)}"
            )
        return candidates.pop()

    def _owned_listener_pid(self, port: int, ancestor: int) -> int:
        completed = subprocess.run(
            ["lsof", "-tiTCP:" + str(port), "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            check=False,
        )
        listeners = {
            int(value)
            for value in completed.stdout.split()
            if value.isdigit()
        }
        owned = [
            pid
            for pid in listeners
            if self._is_descendant(pid, ancestor)
        ]
        if len(owned) != 1:
            raise DriverError(
                f"embedded WebDriver port {port} is not owned by the "
                f"managed Desktop process; listeners={sorted(listeners)}"
            )
        return owned[0]

    def _managed_process_pid(self) -> int:
        state_path = (
            self.worktree
            / ".local"
            / "dev"
            / "state"
            / self.profile
            / "desktop-app-tauri.json"
        )
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise DriverError(
                f"managed Desktop runtime state is unavailable: {error}"
            ) from error
        pid = state.get("pid")
        if (
            state.get("service") != "desktop-app-tauri"
            or state.get("profile") != self.profile
            or state.get("worktreeId") != self.worktree.name
            or not isinstance(pid, int)
            or pid <= 0
        ):
            raise DriverError(
                f"managed Desktop runtime state is invalid: {state_path}"
            )
        return pid

    def _prepare_runtime_profile(self) -> Path:
        active_profile = (
            self.worktree
            / ".local"
            / "dev"
            / "active"
            / f"{self.worktree.name}.env"
        )
        try:
            source = active_profile.resolve(strict=True)
            lines = source.read_text(encoding="utf-8").splitlines()
        except OSError as error:
            raise DriverError(
                f"active Desktop profile is unavailable: {error}"
            ) from error

        overrides = {
            "PT_DEV_PROFILE": self.profile,
            "PT_DESKTOP_APP_GATEWAY_PORT": str(self.gateway_port),
            "PT_DESKTOP_APP_WEB_PORT": str(self.renderer_port),
        }
        found: set[str] = set()
        rendered: list[str] = []
        for line in lines:
            key = line.split("=", 1)[0] if "=" in line else ""
            if key in overrides:
                rendered.append(f"{key}={overrides[key]}")
                found.add(key)
            else:
                rendered.append(line)
        for key in overrides.keys() - found:
            rendered.append(f"{key}={overrides[key]}")

        root = Path(
            tempfile.mkdtemp(
                prefix=f"peers-touch-runtime-profile-{self.port}-"
            )
        )
        if os.name != "nt":
            root.chmod(0o700)
        profile = root / f"{self.profile}.env"
        profile.write_text("\n".join(rendered) + "\n", encoding="utf-8")
        if os.name != "nt":
            profile.chmod(0o600)
        self._runtime_profile_root = root
        return profile

    @staticmethod
    def _is_descendant(pid: int, ancestor: int) -> bool:
        current = pid
        visited: set[int] = set()
        while current > 1 and current not in visited:
            if current == ancestor:
                return True
            visited.add(current)
            completed = subprocess.run(
                ["ps", "-o", "ppid=", "-p", str(current)],
                capture_output=True,
                text=True,
                check=False,
            )
            value = completed.stdout.strip()
            if not value.isdigit():
                return False
            current = int(value)
        return False

    def _log_tail(self) -> str:
        if self._log_file is not None:
            self._log_file.flush()
        if self.log_path is None or not self.log_path.is_file():
            return "app log unavailable"
        return self.log_path.read_text(
            encoding="utf-8",
            errors="replace",
        )[-4000:]


class ProvisionedTauriLauncher(AppLauncher):
    def __init__(
        self,
        metadata: AppLaunchMetadata,
        *,
        release: RuntimeRelease | None = None,
        alive: Callable[[], bool] | None = None,
    ) -> None:
        if metadata.webdriver_host not in LOOPBACK_HOSTS:
            raise ValueError("provisioned WebDriver endpoint must be loopback")
        self._metadata = metadata
        self._release = release
        self._alive = alive
        self._started = False
        self._released = False

    @property
    def metadata(self) -> AppLaunchMetadata:
        return self._metadata

    def start(self) -> AppLaunchMetadata:
        if self._released:
            raise RuntimeError("provisioned Tauri launcher was already released")
        self._started = True
        return self.metadata

    def stop(self, *, preserve_state: bool = False) -> None:
        if self._released:
            return
        self._released = True
        self._started = False
        if self._release is not None:
            self._release(preserve_state=preserve_state)

    def is_alive(self) -> bool:
        if not self._started or self._released:
            return False
        return self._alive() if self._alive is not None else True


class TauriSession(DomDriver):
    def __init__(self, launcher: AppLauncher) -> None:
        self.launcher = launcher
        self._driver: TauriDriver | None = None
        self._launcher_started = False

    @property
    def metadata(self) -> AppLaunchMetadata:
        return self.launcher.metadata

    @property
    def driver(self) -> WebDriver:
        if self._driver is None:
            raise RuntimeError("TauriSession is not started")
        return self._driver.driver

    @property
    def port(self) -> int:
        return self.metadata.webdriver_port

    @property
    def gateway_port(self) -> int:
        return self.metadata.gateway_port

    @property
    def profile(self) -> str:
        return self.metadata.profile

    @property
    def storage_root(self) -> str:
        return self.metadata.storage_root

    @property
    def process_id(self) -> int | None:
        return self.metadata.process_id

    @property
    def log_path(self) -> Path | None:
        return self.metadata.log_path

    def start(self) -> WebDriver:
        if self._driver is not None:
            return self.driver
        metadata = self.launcher.start()
        self._launcher_started = True
        self._driver = TauriDriver(
            host=metadata.webdriver_host,
            port=metadata.webdriver_port,
            log_path=metadata.log_path,
        )
        try:
            return self._driver.start()
        except Exception:
            self.stop()
            raise

    def stop(self, *, preserve_state: bool = False) -> None:
        if self._driver is not None:
            self._driver.stop()
            self._driver = None
        if self._launcher_started:
            if preserve_state:
                self.launcher.stop(preserve_state=True)
            else:
                self.launcher.stop()
            self._launcher_started = False

    def is_alive(self) -> bool:
        return (
            self._driver is not None
            and self._driver.is_alive()
            and self.launcher.is_alive()
        )

    def wait_for_ready(self, timeout: float = APP_STARTUP_TIMEOUT) -> dict[str, Any]:
        return self._connected_driver().wait_for_ready(timeout)

    def wait_for_renderer(self, timeout: float = APP_STARTUP_TIMEOUT) -> dict[str, Any]:
        return self.wait_for_ready(timeout)

    def wait_for_acceptance_harness(self, timeout: float = APP_STARTUP_TIMEOUT) -> None:
        self._connected_driver().wait_for_acceptance_harness(timeout)

    def execute_script(self, script: str, *args: Any) -> Any:
        return self._connected_driver().execute_script(script, *args)

    def execute_async_script(self, script: str, *args: Any) -> Any:
        return self._connected_driver().execute_async_script(script, *args)

    def find_element(self, selector: str, timeout: float = 10.0) -> Any:
        return self._connected_driver().find_element(selector, timeout)

    def find_elements(self, selector: str) -> list[Any]:
        return self._connected_driver().find_elements(selector)

    def save_screenshot(self, path: str | Path) -> None:
        self._connected_driver().save_screenshot(path)

    def get_page_source(self) -> str:
        return self._connected_driver().get_page_source()

    def get_current_url(self) -> str:
        return self._connected_driver().get_current_url()

    def wait_for_element(self, css_selector: str, timeout: float = 10.0) -> Any:
        return self._connected_driver().wait_for_element(css_selector, timeout)

    def find_by_pt_attr(self, attr_name: str, timeout: float = 10.0) -> Any:
        return self._connected_driver().find_by_pt_attr(attr_name, timeout)

    def get_title(self) -> str:
        return self._connected_driver().get_title()

    def _connected_driver(self) -> TauriDriver:
        if self._driver is None:
            raise RuntimeError("TauriSession is not started")
        return self._driver


@contextmanager
def tauri_driver_session(
    app_binary: Optional[str] = None,
    port: int = DEFAULT_PORT,
) -> Generator[TauriSession, None, None]:
    td = TauriSession(
        LocalTauriLauncher(app_binary=app_binary, port=port)
    )
    try:
        td.start()
        yield td
    finally:
        td.stop()


def smoke_test(app_binary: Optional[str] = None, port: int = 0) -> bool:
    port = resolve_smoke_port(port)
    print(f"[smoke] Launching Tauri app with embedded WebDriver on port {port}...")
    print(f"[smoke] App binary: {app_binary or '(auto-detect)'}")
    passed = False
    log_path: Path | None = None
    with tauri_driver_session(app_binary=app_binary, port=port) as td:
        print(f"[smoke] Gateway port: {td.gateway_port}")
        print(f"[smoke] Profile: {td.profile}")
        state = td.wait_for_ready()
        title = state["title"]
        print(f"[smoke] Document title: {title!r}")
        print(f"[smoke] Document URL: {state['url']!r}")
        print(f"[smoke] window.__TAURI__: {state['hasTauri']}")
        td.wait_for_acceptance_harness()
        harness_state = td.execute_script(
            """
            return {
              hasRoot: Boolean(window.__PT_ACCEPTANCE__),
              hasChat: Boolean(window.__PT_ACCEPTANCE__?.chat),
              hasLogin: typeof window.__PT_ACCEPTANCE__?.chat?.loginWithPassword === 'function',
            };
            """
        )
        print(f"[smoke] acceptance harness: {harness_state}")
        page_source_len = len(td.get_page_source())
        print(f"[smoke] Page source length: {page_source_len} chars")
        log_path = td.log_path
        print(f"[smoke] App log: {log_path}")
        passed = bool(
            page_source_len > 100
            and 'id="root"' in td.get_page_source()
            and harness_state.get("hasRoot")
            and harness_state.get("hasChat")
            and harness_state.get("hasLogin")
        )
        if passed:
            print("[smoke] PASS — embedded WebDriver connected, DOM accessible")
        else:
            print("[smoke] FAIL — renderer page source is incomplete")
    if passed and log_path is not None:
        log_path.unlink(missing_ok=True)
    return passed


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Tauri embedded WebDriver smoke test")
    parser.add_argument("--binary", help="Path to Tauri app binary")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    success = smoke_test(app_binary=args.binary, port=args.port)
    raise SystemExit(0 if success else 1)
