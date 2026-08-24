#!/usr/bin/env python3
"""Native Tauri E2E runner for Agent turn delivery.

Uses `make desktop` (same as chat native visible runner) with an isolated
profile, then drives the native WKWebView through the __PT_ACCEPTANCE__
agent harness via Selenium.

Environment:
  PEERS_TOUCH_ACCEPTANCE_STATION_URL   Station URL (default http://10.37.118.48:18080)
  PEERS_TOUCH_ACCEPTANCE_PASSWORD      Login password (default "1")
  PEERS_TOUCH_ACCEPTANCE_ACTOR_EMAIL   Login email (default "alice@p.t")
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import REPO_ROOT
from tooling.acceptance.core.harness import call_async_harness

REPORTS_DIR = REPO_ROOT / "tooling" / "acceptance" / "reports"


DEFAULT_STATION_URL = "http://10.37.118.48:18080"
DEFAULT_EMAIL = "alice@p.t"
DEFAULT_PASSWORD = "1"
WEBDRIVER_PORT = 4448
GATEWAY_PORT = 3430
RENDERER_PORT = 3610


def _env(*keys: str, default: str = "") -> str:
    for key in keys:
        value = os.environ.get(key, "").strip()
        if value:
            return value
    return default


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _port_open(port: int) -> bool:
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) == 0


def wait_until(predicate, description: str, timeout: float = 60.0, interval: float = 0.3):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as exc:
            last_error = exc
        time.sleep(min(interval, max(0.01, deadline - time.monotonic())))
    suffix = f"; last error: {last_error}" if last_error else ""
    raise RuntimeError(f"timed out waiting for {description}{suffix}")


def run_journey() -> int:
    station_url = _env(
        "PEERS_TOUCH_ACCEPTANCE_STATION_URL",
        default=DEFAULT_STATION_URL,
    ).rstrip("/")
    email = _env(
        "PEERS_TOUCH_ACCEPTANCE_ACTOR_EMAIL",
        default=DEFAULT_EMAIL,
    )
    password = _env(
        "PEERS_TOUCH_ACCEPTANCE_PASSWORD",
        default=DEFAULT_PASSWORD,
    )

    evidence_dir = REPORTS_DIR / "agent-native-turn"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    run_root = evidence_dir / "run"
    run_root.mkdir(parents=True, exist_ok=True)
    report_path = evidence_dir / "agent-native-turn.json"
    log_path = evidence_dir / "desktop.log"

    report: dict[str, Any] = {
        "gate": "agent-native-turn-e2e",
        "startedAt": now_iso(),
        "stationUrl": station_url,
        "email": email,
        "steps": [],
    }

    process = None
    driver = None

    def step(name: str, fn):
        started = time.monotonic()
        entry = {"step": name, "status": "running", "startedAt": now_iso()}
        report["steps"].append(entry)
        try:
            result = fn()
            entry["status"] = "passed"
            entry["durationMs"] = int((time.monotonic() - started) * 1000)
            return result
        except Exception as exc:
            entry["status"] = "failed"
            entry["error"] = str(exc)
            entry["durationMs"] = int((time.monotonic() - started) * 1000)
            raise

    try:
        # Isolated profile (same pattern as chat native visible runner)
        profile_dir = run_root / "profile"
        profile_dir.mkdir(parents=True, exist_ok=True)
        profile_file = profile_dir / "agent-e2e.env"
        profile_file.write_text(
            f"PT_DEV_PROFILE=agent-e2e\n"
            f"PT_DEV_SLOT=0\n"
            f"PT_STATION_MODE=remote\n"
            f"PT_STATION_NAME=agent-e2e\n"
            f"PT_STATION_URL={station_url}\n"
            f"PT_STATION_PORT=18080\n"
            f"PT_STATION_HEALTH_URL={station_url}/sub-oss/healthz\n"
            f"PT_DESKTOP_APP_GATEWAY_PORT={GATEWAY_PORT}\n"
            f"PT_DESKTOP_APP_WEB_PORT={RENDERER_PORT}\n",
            encoding="utf-8",
        )

        env = os.environ.copy()
        env.update({
            "WORKTREE_ID": "agent-native-e2e",
            "PT_DEV_PROFILE": "agent-e2e",
            "PT_DEV_PROFILE_FILE": str(profile_file),
            "PT_DESKTOP_APP_GATEWAY_PORT": str(GATEWAY_PORT),
            "PT_DESKTOP_APP_WEB_PORT": str(RENDERER_PORT),
            "PEERS_STORAGE_ROOT": str(run_root / "storage"),
            "PT_STATION_MODE": "remote",
            "PT_STATION_URL": station_url,
            "PEERS_STATION_URL": station_url,
            "PT_DESKTOP_E2E": "true",
            "TAURI_WEBDRIVER_PORT": str(WEBDRIVER_PORT),
            "RESTART": "1",
            "CARGO_BUILD_JOBS": "1",
        })

        log_handle = log_path.open("w", encoding="utf-8")

        def launch():
            nonlocal process
            process = subprocess.Popen(
                ["make", "desktop"],
                cwd=REPO_ROOT,
                env=env,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            return process

        step("launch_desktop", launch)

        def await_webdriver():
            if process and process.poll() is not None:
                raise RuntimeError(f"Desktop exited with code {process.returncode}")
            return _port_open(WEBDRIVER_PORT)

        step("await_webdriver", lambda: wait_until(await_webdriver, "webdriver port", timeout=600))

        def connect():
            nonlocal driver
            options = ChromeOptions()
            driver = webdriver.Remote(
                command_executor=f"http://127.0.0.1:{WEBDRIVER_PORT}",
                options=options,
            )
            driver.set_script_timeout(120)
            return True

        step("connect_webdriver", connect)

        def ready():
            state = driver.execute_script("""
                return {
                  hasRoot: Boolean(document.querySelector('#root')),
                  hasTauri: typeof window.__TAURI__ === 'object'
                    || typeof window.__TAURI_INTERNALS__ === 'object',
                  readyState: document.readyState,
                };
            """)
            return (
                state.get("hasRoot")
                and state.get("hasTauri")
                and state.get("readyState") == "complete"
            )

        step("wait_renderer", lambda: wait_until(ready, "renderer ready", timeout=60))

        step(
            "wait_harness",
            lambda: wait_until(
                lambda: bool(driver.execute_script(
                    "return Boolean(window.__PT_ACCEPTANCE__?.agent)"
                )),
                "agent harness",
                timeout=60,
            ),
        )

        # Login via agent harness
        def login():
            result = call_async_harness(
                driver,
                "loginWithPassword",
                {"account": email, "password": password},
                namespace="agent",
                script_timeout=60,
            )
            actor_id = str((result or {}).get("actorId") or "")
            if not (result or {}).get("authenticated") or not actor_id:
                raise RuntimeError(f"Login failed: {result}")
            return result

        login_result = step("login", login)

        # Navigate to agent page via sidebar
        def navigate_agent():
            # Wait for sidebar to render after login
            wait_until(
                lambda: driver.execute_script(
                    "return Boolean(document.querySelector('[data-pt-primary-nav=\"agent\"]'))"
                ),
                "agent nav element in DOM",
                timeout=30,
            )
            # Use JS click since Tauri WebDriver may not support attribute selectors
            clicked = driver.execute_script("""
                const el = document.querySelector('[data-pt-primary-nav="agent"]');
                if (!el) return { found: false };
                const btn = el.querySelector('button') || el;
                btn.click();
                return { found: true, tag: btn.tagName };
            """)
            report["debug_navigate"] = clicked
            if not clicked or not clicked.get("found"):
                raise RuntimeError("Agent nav element not found in DOM")

            # Wait for agent composer to appear
            wait_until(
                lambda: driver.execute_script(
                    "return Boolean(document.querySelector('[data-pt-agent-composer]'))"
                ),
                "agent composer visible",
                timeout=30,
            )

        step("navigate_to_agent", navigate_agent)

        # Ensure provider is configured
        provider_id = _env("PT_AGENT_PROVIDER_ID", default="ark")
        provider_key = _env("PT_AGENT_PROVIDER_API_KEY", default="")
        model_id = _env("PT_AGENT_DEFAULT_MODEL_ID", default="")
        provider_base_url = _env("PT_AGENT_PROVIDER_BASE_URL", default="https://ark.cn-beijing.volces.com/api/v3")

        def ensure_provider():
            if not provider_key or not model_id:
                return {"skipped": True, "reason": "no provider key or model configured"}
            return call_async_harness(
                driver,
                "ensureProvider",
                {"providerId": provider_id, "apiKey": provider_key, "modelId": model_id, "baseUrl": provider_base_url},
                namespace="agent",
                script_timeout=30,
            )

        step("ensure_provider", ensure_provider)

        # Send message
        test_message = f"E2E agent test — reply with OK at {now_iso()}"

        def send_message():
            return call_async_harness(
                driver,
                "sendMessage",
                {"content": test_message},
                namespace="agent",
                script_timeout=10,
            )

        before = step("send_message", send_message)
        after_count = before.get("beforeCount", 0) if isinstance(before, dict) else 0

        # Wait for assistant response
        response = step(
            "wait_for_response",
            lambda: call_async_harness(
                driver,
                "waitForAssistantResponse",
                {"afterCount": after_count},
                namespace="agent",
                script_timeout=120,
            ),
        )

        report["response"] = response
        report["loginActorId"] = login_result.get("actorId")
        report["status"] = "passed"
        report["completedAt"] = now_iso()
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"PASS: agent-native-turn-e2e — {report_path}")
        return 0

    except Exception as exc:
        report["status"] = "failed"
        report["error"] = str(exc)
        report["completedAt"] = now_iso()
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    raise SystemExit(run_journey())
