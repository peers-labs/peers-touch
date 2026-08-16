#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import warnings
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator, Mapping, Optional

from selenium import webdriver
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from selenium.common.exceptions import TimeoutException

from tooling.acceptance.core import DomDriver, REPO_ROOT
from tooling.acceptance.core.errors import DriverError


DEFAULT_PORT = 4445
APP_STARTUP_TIMEOUT = 20.0
SCRIPT_TIMEOUT = 10.0
EXPECTED_TITLE = "Peers Touch Desktop"
EXPECTED_URL = "tauri://localhost"


def find_app_binary() -> str:
    candidates = [
        "apps/desktop/src-tauri/target/debug/peers-touch-desktop",
        "apps/desktop/src-tauri/target/debug/Peers Touch",
    ]
    for candidate in candidates:
        path = REPO_ROOT / candidate
        if path.exists():
            return str(path)
    raise FileNotFoundError(
        f"Tauri debug binary not found. Build with: "
        f"cd apps/desktop && cargo build --features acceptance-webdriver\n"
        f"Searched: {[str(REPO_ROOT / c) for c in candidates]}"
    )


def _wait_for_webdriver(port: int, timeout: float) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=2)
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


class TauriDriver(DomDriver):

    def __init__(
        self,
        app_binary: Optional[str] = None,
        port: int = DEFAULT_PORT,
        gateway_port: Optional[int] = None,
        profile: Optional[str] = None,
        storage_root: Optional[str] = None,
        environment: Optional[Mapping[str, str]] = None,
    ):
        self.app_binary = app_binary or find_app_binary()
        self.port = port
        self.gateway_port = gateway_port or _available_port()
        self.profile = profile or f"acceptance-webdriver-{port}"
        self.storage_root = storage_root or tempfile.mkdtemp(
            prefix=f"peers-touch-webdriver-storage-{port}-"
        )
        self._owns_storage_root = storage_root is None
        self.environment = dict(environment or {})
        self._process: Optional[subprocess.Popen] = None
        self._driver: Optional[WebDriver] = None
        self._log_file = None
        self.log_path: Optional[Path] = None

    @property
    def driver(self) -> WebDriver:
        if self._driver is None:
            raise RuntimeError("TauriDriver not started — use as context manager or call start()")
        return self._driver

    @property
    def process_id(self) -> int | None:
        return self._process.pid if self._process is not None else None

    def start(self) -> WebDriver:
        try:
            self._launch_app()
            return self.connect()
        except Exception:
            self.stop()
            raise

    def connect(self, timeout: float = APP_STARTUP_TIMEOUT) -> WebDriver:
        """Connect to an app launched by an environment-specific runtime."""
        if self._driver is not None:
            return self._driver
        try:
            _wait_for_webdriver(self.port, timeout)
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
        if self._process:
            if self._process.poll() is None:
                self._process.terminate()
                try:
                    self._process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    self._process.wait(timeout=3)
            self._process = None
        if self._log_file:
            self._log_file.close()
            self._log_file = None
        if self._owns_storage_root:
            shutil.rmtree(self.storage_root, ignore_errors=True)

    def wait_for_ready(self, timeout: float = APP_STARTUP_TIMEOUT) -> dict[str, Any]:
        def renderer_state(driver: WebDriver):
            try:
                state = driver.execute_script(
                    """
                    return {
                      hasRoot: Boolean(document.querySelector('#root')),
                      hasTauri: typeof window.__TAURI__ === 'object',
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
        return self._process is not None and self._process.poll() is None

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

    def _launch_app(self) -> None:
        env = os.environ.copy()
        env["TAURI_WEBDRIVER_PORT"] = str(self.port)
        env["PT_GATEWAY_PORT"] = str(self.gateway_port)
        env["PT_PROFILE"] = self.profile
        env["PEERS_STORAGE_ROOT"] = self.storage_root
        env.update(self.environment)
        self._log_file = tempfile.NamedTemporaryFile(
            prefix=f"peers-touch-webdriver-{self.port}-",
            suffix=".log",
            delete=False,
        )
        self.log_path = Path(self._log_file.name)
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
            raise DriverError(
                f"Tauri app exited immediately (code {self._process.returncode}): {output}"
            )

    def _connect_session(self) -> None:
        self._driver = webdriver.Remote(
            command_executor=f"http://127.0.0.1:{self.port}",
            options=webdriver.ChromeOptions(),
        )
        self._driver.set_script_timeout(SCRIPT_TIMEOUT)


@contextmanager
def tauri_driver_session(
    app_binary: Optional[str] = None,
    port: int = DEFAULT_PORT,
) -> Generator[TauriDriver, None, None]:
    td = TauriDriver(app_binary=app_binary, port=port)
    try:
        td.start()
        yield td
    finally:
        td.stop()


def smoke_test(app_binary: Optional[str] = None, port: int = DEFAULT_PORT) -> bool:
    print(f"[smoke] Launching Tauri app with embedded WebDriver on port {port}...")
    print(f"[smoke] App binary: {app_binary or '(auto-detect)'}")
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
        print(f"[smoke] App log: {td.log_path}")
        if (
            page_source_len > 100
            and 'id="root"' in td.get_page_source()
            and harness_state.get("hasRoot")
            and harness_state.get("hasChat")
            and harness_state.get("hasLogin")
        ):
            print("[smoke] PASS — embedded WebDriver connected, DOM accessible")
            return True
        print("[smoke] FAIL — renderer page source is incomplete")
        return False


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Tauri embedded WebDriver smoke test")
    parser.add_argument("--binary", help="Path to Tauri app binary")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    success = smoke_test(app_binary=args.binary, port=args.port)
    raise SystemExit(0 if success else 1)
