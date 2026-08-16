#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import AcceptanceGate, GateError  # noqa: E402
from tooling.acceptance.drivers.chrome import ChromeDriver, find_chrome  # noqa: E402


DEFAULT_URL = "http://10.37.94.156:18180/dashboard/#/federation"
DEFAULT_ENV_FILE = ".localenv"


def load_env_file() -> None:
    env_file = Path(os.environ.get("FEDERATION_VISUAL_ENV_FILE", DEFAULT_ENV_FILE))
    if not env_file.exists():
        return
    pattern = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        match = pattern.match(raw_line.strip())
        if not match:
            continue
        key, value = match.groups()
        if key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ[key] = value


def login_token(dashboard_url: str) -> str | None:
    username = os.environ.get("FEDERATION_VISUAL_ADMIN_USERNAME", "").strip()
    password = os.environ.get("FEDERATION_VISUAL_ADMIN_PASSWORD", "")
    if not username or not password:
        return None
    parsed = urllib.parse.urlparse(dashboard_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    request = urllib.request.Request(
        f"{origin}/dashboard/api/auth/login",
        data=json.dumps({"username": username, "password": password}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = json.loads(response.read().decode("utf-8"))
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    token = data.get("token")
    if not token:
        raise GateError("dashboard login response did not include token")
    return str(token)


def required_markers(authenticated: bool) -> list[str]:
    if not authenticated:
        return ["Peers Station", "Dashboard Administration", "Sign In"]
    return [
        "Federation",
        "Station Peer ID",
        "Operational Health",
        "Sync Drilldown",
        "Recovery Drilldown",
        "Discovery Drilldown",
        "Operational Event History",
        "Members",
        "Proposals",
        "Sync Cursors",
    ]


class FederationDashboardVisibleGate(AcceptanceGate):
    gate_id = "federation-dashboard-visible-surface"

    def run(self) -> dict[str, Any]:
        load_env_file()
        target_url = os.environ.get("FEDERATION_VISUAL_DASHBOARD_URL", DEFAULT_URL)
        require_auth = os.environ.get("FEDERATION_VISUAL_REQUIRE_AUTH") == "1"
        token = login_token(target_url)
        if require_auth and not token:
            raise GateError(
                "FEDERATION_VISUAL_REQUIRE_AUTH=1 requires dashboard credentials"
            )

        chrome = ChromeDriver(
            chrome_binary=os.environ.get("FEDERATION_VISUAL_CHROME") or find_chrome(),
            headless=True,
            width=1440,
            height=1000,
        )
        self.register_driver(chrome)
        chrome.start()

        parsed = urllib.parse.urlparse(target_url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if token:
            chrome.navigate(origin)
            chrome.execute_script(
                "localStorage.setItem('dashboard_token', arguments[0])",
                token,
            )
        chrome.navigate(target_url)
        chrome.wait_for_ready(30)
        markers = required_markers(bool(token))
        text = chrome.wait_for_text(markers, timeout=20)
        for marker in markers:
            self.assert_condition(
                f"visible:{marker}",
                marker in text,
                f"missing visible marker {marker}",
            )

        self.save_screenshot(chrome, "dashboard")
        self.save_dom(chrome, "dashboard")
        return {
            "url": chrome.get_current_url(),
            "mode": "authenticated" if token else "login",
            "visible_markers": markers,
        }


def main() -> int:
    return FederationDashboardVisibleGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
