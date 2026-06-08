#!/usr/bin/env python3
"""Federation app smoke checks for agent-driven acceptance.

This script verifies the first layer of app acceptance without requiring a
human to click through the Desktop or Dashboard:

1. Station endpoints are reachable on the isolated testnet.
2. Dashboard serves the built Federation page bundle.
3. A running Desktop dev gateway can list and probe the active Station.

The script deliberately avoids governance writes. It validates that app
surfaces are wired and pointing at the expected Station network.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


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


def http_post_json(url: str, payload: dict[str, Any], timeout: float = 8.0) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


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


def unwrap_gateway_status(response: dict[str, Any]) -> dict[str, Any]:
    if not response.get("ok"):
        raise RuntimeError(f"gateway command failed: {response}")
    data = response.get("data") or {}
    status = data.get("status")
    if not isinstance(status, str):
        raise RuntimeError(f"gateway response missing string status: {response}")
    return json.loads(status)


def check_desktop_gateway(gateway_url: str, expected_station: str) -> list[CheckResult]:
    gateway_url = gateway_url.rstrip("/")
    results: list[CheckResult] = []
    try:
        listed = unwrap_gateway_status(http_post_json(gateway_url, {"cmd": "station_list", "args": {}}))
        active_url = (listed.get("active_url") or "").rstrip("/")
        results.append(
            CheckResult(
                "desktop gateway station_list",
                active_url == expected_station,
                f"active_url={active_url or 'empty'}",
            )
        )
    except Exception as error:  # noqa: BLE001
        results.append(CheckResult("desktop gateway station_list", False, str(error)))
        return results

    try:
        probed = unwrap_gateway_status(
            http_post_json(gateway_url, {"cmd": "station_probe", "args": {"url": expected_station}})
        )
        results.append(
            CheckResult(
                "desktop gateway station_probe",
                bool(probed.get("online")) and bool(probed.get("peer_id")),
                f"online={probed.get('online')} peer_id={probed.get('peer_id') or 'empty'}",
            )
        )
    except Exception as error:  # noqa: BLE001
        results.append(CheckResult("desktop gateway station_probe", False, str(error)))
    return results


def print_report(results: list[CheckResult]) -> None:
    print("Federation App Smoke")
    print("====================")
    for result in results:
        status = "OK" if result.ok else "FAIL"
        print(f"[{status}] {result.name}: {result.detail}")


def main() -> int:
    stations = env_list("FEDERATION_SMOKE_STATIONS", DEFAULT_STATIONS)
    dashboard_station = os.environ.get("FEDERATION_SMOKE_DASHBOARD_STATION", stations[0]).rstrip("/")
    expected_desktop_station = os.environ.get("FEDERATION_SMOKE_DESKTOP_STATION", stations[0]).rstrip("/")
    desktop_gateway = os.environ.get("FEDERATION_SMOKE_DESKTOP_GATEWAY", "http://127.0.0.1:3030").rstrip("/")

    results: list[CheckResult] = []
    results.extend(check_station_health(station) for station in stations)
    results.append(check_dashboard_bundle(dashboard_station))
    results.extend(check_desktop_gateway(desktop_gateway, expected_desktop_station))

    print_report(results)
    return 0 if all(result.ok for result in results) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.URLError as error:
        print(f"smoke failed: {error}", file=sys.stderr)
        raise SystemExit(1)
