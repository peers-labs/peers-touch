#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (  # noqa: E402
    AcceptanceGate,
    GateError,
    ProvisioningError,
    load_runtime_manifest,
    require_runtime_service,
)
from tooling.acceptance.drivers.chrome import ChromeDriver  # noqa: E402
from tooling.acceptance.drivers.station import StationDriver  # noqa: E402


GATE_ID = "federation-desktop-gateway-smoke"
DEFAULT_URL = "http://localhost:3210/"
DEFAULT_GATEWAY = "http://127.0.0.1:3030"
DEFAULT_STATION = "http://10.37.94.156:18180"
FEDERATION_APPLICATION = (
    REPO_ROOT / "apps/desktop/src-tauri/src/application/federation/mod.rs"
)


def catalog_search_uses_direct_typed_proto(source: str) -> bool:
    start_marker = "pub fn catalog_search("
    end_marker = "pub fn encode_catalog_search("
    if start_marker not in source or end_marker not in source:
        return False
    catalog_search = source.split(start_marker, 1)[1].split(end_marker, 1)[0]
    return (
        "station_client::request_proto::<" in catalog_search
        and "station_client::request_peers_proto::<" not in catalog_search
    )


def runtime_endpoints(manifest: dict[str, Any]) -> tuple[str, str, str]:
    clients = manifest.get("clients")
    if not isinstance(clients, list) or len(clients) != 1:
        raise GateError("runtime manifest requires one Desktop gateway client")
    client = clients[0]
    gateway_port = client.get("gateway_port")
    renderer_port = client.get("renderer_port")
    if not isinstance(gateway_port, int) or gateway_port <= 0:
        raise GateError("runtime manifest Desktop gateway port is invalid")
    if not isinstance(renderer_port, int) or renderer_port <= 0:
        raise GateError("runtime manifest Desktop renderer port is invalid")

    try:
        station = require_runtime_service(manifest, "station", "station")
    except ProvisioningError as error:
        raise GateError(str(error)) from error
    station_url = station.get("endpoint")
    if not isinstance(station_url, str) or not station_url.strip():
        raise GateError("runtime manifest Station URL is required")
    return (
        f"http://localhost:{renderer_port}/",
        f"http://127.0.0.1:{gateway_port}",
        station_url.rstrip("/"),
    )


def configured_runtime_endpoints() -> tuple[str, str, str]:
    manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
    if not manifest_path:
        raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
    return runtime_endpoints(
        load_runtime_manifest(Path(manifest_path), GATE_ID)
    )


def station_status(data: dict[str, Any]) -> dict[str, Any]:
    status = data.get("status")
    if isinstance(status, str):
        parsed = json.loads(status)
        if isinstance(parsed, dict):
            return parsed
    return data


class DesktopGatewaySmokeGate(AcceptanceGate):
    gate_id = "federation-desktop-gateway-smoke"
    phase = "WS-6"
    bom = ("desktop-federation-context-surface",)
    spec = ("desktop-federation-surfaces",)

    def run(self) -> dict[str, Any]:
        federation_application = FEDERATION_APPLICATION.read_text(encoding="utf-8")
        self.assert_condition(
            "catalog_search_direct_typed_proto",
            catalog_search_uses_direct_typed_proto(federation_application),
            "Federation Catalog must decode NewTypedHandler's direct protobuf response",
        )

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
