#!/usr/bin/env python3
"""Federation app smoke checks for agent-driven acceptance.

This script verifies the first layer of app acceptance without requiring a
human to click through the Desktop or Dashboard:

1. Station endpoints are reachable on the isolated testnet.
2. Dashboard serves the built Federation page bundle.

The script deliberately avoids governance writes. It validates that app
surfaces are wired to the expected Station network. Native Desktop Federation
behavior is proven separately by the native Station Access boundary Gate.
"""

from __future__ import annotations

import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass


DEFAULT_STATIONS = [
    "http://10.37.94.156:18180",
    "http://10.37.195.98:18180",
    "http://10.37.246.80:18180",
]


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str


def env_list(name: str, fallback: list[str]) -> list[str]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return fallback
    return [part.strip().rstrip("/") for part in raw.split(",") if part.strip()]


def http_get(url: str, timeout: float = 8.0) -> tuple[int, str, bytes]:
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("content-type", "")
        return response.status, content_type, response.read()


def check_station_health(station_url: str) -> CheckResult:
    try:
        status, _, _ = http_get(f"{station_url}/sub-oss/healthz")
    except Exception as error:  # noqa: BLE001 - smoke script reports any failure.
        return CheckResult(f"station health {station_url}", False, str(error))
    return CheckResult(f"station health {station_url}", status == 200, f"http={status}")


def check_dashboard_bundle(station_url: str) -> CheckResult:
    try:
        status, content_type, body = http_get(f"{station_url}/dashboard/")
        html = body.decode("utf-8", errors="replace")
        assets = re.findall(r'src="([^"]+\.js)"', html)
        if status != 200 or "text/html" not in content_type:
            return CheckResult("dashboard federation bundle", False, f"http={status} content_type={content_type}")
        if not assets:
            return CheckResult("dashboard federation bundle", False, "dashboard html has no JS asset")

        asset_path = assets[0]
        asset_url = f"{station_url}{asset_path}"
        asset_status, _, asset_body = http_get(asset_url)
        script = asset_body.decode("utf-8", errors="replace")
        required_markers = ["/federation/overview", "Federation"]
        missing = [marker for marker in required_markers if marker not in script]
        if asset_status != 200 or missing:
            return CheckResult(
                "dashboard federation bundle",
                False,
                f"asset_http={asset_status} missing={','.join(missing)}",
            )
        return CheckResult("dashboard federation bundle", True, asset_path)
    except Exception as error:  # noqa: BLE001
        return CheckResult("dashboard federation bundle", False, str(error))


def print_report(results: list[CheckResult]) -> None:
    print("Federation App Smoke")
    print("====================")
    for result in results:
        status = "OK" if result.ok else "FAIL"
        print(f"[{status}] {result.name}: {result.detail}")


def main() -> int:
    stations = env_list("FEDERATION_SMOKE_STATIONS", DEFAULT_STATIONS)
    dashboard_station = os.environ.get("FEDERATION_SMOKE_DASHBOARD_STATION", stations[0]).rstrip("/")

    results: list[CheckResult] = []
    results.extend(check_station_health(station) for station in stations)
    results.append(check_dashboard_bundle(dashboard_station))

    print_report(results)
    return 0 if all(result.ok for result in results) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.URLError as error:
        print(f"smoke failed: {error}", file=sys.stderr)
        raise SystemExit(1)
