#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import AcceptanceGate  # noqa: E402
from tooling.acceptance.drivers.chrome import ChromeDriver  # noqa: E402
from tooling.acceptance.drivers.station import StationDriver  # noqa: E402


DEFAULT_URL = "http://localhost:3210/"
DEFAULT_GATEWAY = "http://127.0.0.1:3030"
DEFAULT_STATION = "http://10.37.94.156:18180"


def station_status(data: dict[str, Any]) -> dict[str, Any]:
    status = data.get("status")
    if isinstance(status, str):
        parsed = json.loads(status)
        if isinstance(parsed, dict):
            return parsed
    return data


class DesktopGatewaySmokeGate(AcceptanceGate):
    gate_id = "federation-desktop-gateway-smoke"

    def run(self) -> dict[str, Any]:
        target_url = os.environ.get("FEDERATION_DESKTOP_VISUAL_URL", DEFAULT_URL)
        gateway_url = os.environ.get(
            "FEDERATION_SMOKE_DESKTOP_GATEWAY",
            DEFAULT_GATEWAY,
        ).rstrip("/")
        expected_station = os.environ.get(
            "FEDERATION_SMOKE_DESKTOP_STATION",
            DEFAULT_STATION,
        ).rstrip("/")

        station = StationDriver(gateway_url)
        self.register_driver(station)
        station.start()
        station.station_add(expected_station)
        station.station_set_active(expected_station)
        listed = station_status(station.station_list())
        active_url = str(
            listed.get("active_url") or listed.get("activeUrl") or ""
        ).rstrip("/")
        self.assert_condition(
            "gateway_active_station",
            active_url == expected_station,
            f"got={active_url or 'empty'} want={expected_station}",
        )

        chrome = ChromeDriver(
            headless=True,
            width=1440,
            height=1000,
            extra_args=[
                "--disable-web-security",
                "--allow-running-insecure-content",
            ],
        )
        self.register_driver(chrome)
        chrome.start()
        chrome.navigate(target_url)
        chrome.wait_for_ready(30)
        text = chrome.wait_for_text(["Peers"], timeout=20)

        self.save_screenshot(chrome, "browser-shell")
        self.save_dom(chrome, "browser-shell")
        return {
            "url": chrome.get_current_url(),
            "gateway_url": gateway_url,
            "active_station": active_url,
            "page_text_length": len(text),
        }


def main() -> int:
    return DesktopGatewaySmokeGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
