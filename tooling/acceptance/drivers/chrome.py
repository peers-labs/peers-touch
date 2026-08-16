from __future__ import annotations

import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By

from tooling.acceptance.core import DomDriver
from tooling.acceptance.core.errors import DriverError


def find_chrome() -> str:
    candidates = [
        os.environ.get("CHROME_BINARY"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    raise FileNotFoundError("Chrome/Chromium binary not found")


class ChromeDriver(DomDriver):

    def __init__(
        self,
        chrome_binary: Optional[str] = None,
        headless: bool = True,
        width: int = 1440,
        height: int = 1000,
        user_data_dir: Optional[str] = None,
        extra_args: Optional[list[str]] = None,
    ):
        self.chrome_binary = chrome_binary or find_chrome()
        self.headless = headless
        self.width = width
        self.height = height
        self._user_data_dir = user_data_dir
        self._owns_user_data_dir = user_data_dir is None
        self.extra_args = extra_args or []
        self._driver: Optional[webdriver.Chrome] = None

    @property
    def driver(self) -> webdriver.Chrome:
        if self._driver is None:
            raise DriverError("ChromeDriver not started")
        return self._driver

    def start(self) -> webdriver.Chrome:
        try:
            if self._user_data_dir is None:
                self._user_data_dir = tempfile.mkdtemp(prefix="pt-chrome-acceptance-")
            options = Options()
            options.binary_location = self.chrome_binary
            if self.headless:
                options.add_argument("--headless=new")
            options.add_argument("--disable-gpu")
            options.add_argument("--no-first-run")
            options.add_argument("--no-default-browser-check")
            options.add_argument("--disable-web-security")
            options.add_argument("--allow-running-insecure-content")
            options.add_argument(f"--user-data-dir={self._user_data_dir}")
            options.add_argument(f"--window-size={self.width},{self.height}")
            for arg in self.extra_args:
                options.add_argument(arg)
            self._driver = webdriver.Chrome(options=options)
            self._driver.set_script_timeout(10)
            self._driver.set_page_load_timeout(30)
            return self._driver
        except Exception:
            self.stop()
            raise

    def stop(self) -> None:
        if self._driver:
            try:
                self._driver.quit()
            except Exception:
                pass
            self._driver = None
        if self._owns_user_data_dir and self._user_data_dir and Path(self._user_data_dir).exists():
            shutil.rmtree(self._user_data_dir, ignore_errors=True)
            self._user_data_dir = None

    def wait_for_ready(self, timeout: float = 30.0) -> None:
        WebDriverWait(self.driver, timeout).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )

    def navigate(self, url: str) -> None:
        self.driver.get(url)

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

    def find_element_by_text(self, text: str, timeout: float = 10.0) -> Any:
        xpath = f"//*[contains(text(), '{text}')]"
        return WebDriverWait(self.driver, timeout).until(
            EC.presence_of_element_located((By.XPATH, xpath))
        )

    def wait_for_text(self, texts: list[str], timeout: float = 10.0) -> str:
        deadline = time.time() + timeout
        last_text = ""
        while time.time() < deadline:
            last_text = self.driver.execute_script("return document.body ? document.body.innerText : ''") or ""
            if all(t in last_text for t in texts):
                return last_text
            time.sleep(0.3)
        missing = [t for t in texts if t not in last_text]
        raise DriverError(f"ChromeDriver wait_for_text timeout; missing: {missing}")

    def is_alive(self) -> bool:
        if self._driver is None:
            return False
        try:
            self.driver.current_url
            return True
        except Exception:
            return False

    def save_screenshot(self, path: str | Path) -> None:
        self.driver.save_screenshot(str(path))

    def get_page_source(self) -> str:
        return self.driver.page_source or ""

    def get_current_url(self) -> str:
        return self.driver.current_url or ""

    def inject_script(self, script: str) -> None:
        self.driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": script})

    def set_viewport(self, width: int, height: int, device_scale: float = 1.0) -> None:
        self.driver.set_window_size(width, height)
        self.width = width
        self.height = height
