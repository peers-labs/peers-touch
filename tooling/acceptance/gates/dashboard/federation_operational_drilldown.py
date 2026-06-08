#!/usr/bin/env python3
"""Validate Federation Dashboard operational drilldown API and visible surface."""

from __future__ import annotations

import importlib.util
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def load_visible_module() -> Any:
    script = Path(__file__).with_name("federation_visible_surface.py")
    spec = importlib.util.spec_from_file_location("federation_visible_surface", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load visible-surface helpers from {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def api_get(origin: str, path: str, token: str) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{origin}{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def first_federation_id(overview: dict[str, Any]) -> str:
    for item in overview.get("federations", []):
        summary = item.get("summary") or {}
        metadata = summary.get("metadata") or {}
        head = summary.get("head") or {}
        federation_id = metadata.get("federation_id") or head.get("federation_id")
        if federation_id:
            return str(federation_id)
    raise RuntimeError("dashboard overview did not include a federation")


def assert_operations(data: dict[str, Any]) -> None:
    require(bool(data.get("federation_id")), "operations response missing federation_id")
    for section in ("summary", "sync", "recovery", "discovery", "recent_events", "operational_events"):
        require(section in data, f"operations response missing {section}")

    summary = data["summary"]
    require(summary.get("health") in {"healthy", "degraded", "critical"}, "summary health is not normalized")
    require(bool(summary.get("reason_code")), "summary reason_code is missing")

    sync = data["sync"]
    require("cursors" in sync and "issues" in sync, "sync drilldown missing cursors or issues")

    recovery = data["recovery"]
    require("blocking_reasons" in recovery, "recovery drilldown missing blocking_reasons")

    discovery = data["discovery"]
    require("manifest_status" in discovery, "discovery drilldown missing manifest_status")
    require(discovery.get("trust_gate") in {"ledger_membership_replay", "ledger_membership_verified"}, "discovery trust gate is invalid")

    for event in data.get("operational_events", []):
        require(bool(event.get("event_id")), "operational event missing event_id")
        require(bool(event.get("scope")), "operational event missing scope")
        require(bool(event.get("severity")), "operational event missing severity")
        require(bool(event.get("code")), "operational event missing code")
        require(bool(event.get("observed_at_unix_ms")), "operational event missing observed_at_unix_ms")


def main() -> int:
    visible = load_visible_module()
    visible.load_env_file()

    target_url = visible.os.environ.get("FEDERATION_VISUAL_DASHBOARD_URL", visible.DEFAULT_URL)
    parsed = urllib.parse.urlparse(target_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    token = visible.login_token(target_url)
    if not token:
        raise RuntimeError("dashboard credentials are required for operational drilldown acceptance")

    overview = api_get(origin, "/dashboard/api/federation/overview", token)
    federation_id = first_federation_id(overview)
    operations = api_get(origin, f"/dashboard/api/federation/federations/{urllib.parse.quote(federation_id)}/operations", token)
    assert_operations(operations)

    visible_status = visible.main()
    require(visible_status == 0, "federation visible-surface gate failed")

    print("Federation Dashboard Operational Drilldown")
    print("==========================================")
    print(f"[OK] origin: {origin}")
    print(f"[OK] federation_id: {federation_id}")
    print(f"[OK] health: {operations['summary']['health']}")
    print(f"[OK] sync_cursors: {len(operations['sync']['cursors'])}")
    print(f"[OK] operational_events: {len(operations['operational_events'])}")
    print(f"[OK] discovery_trust_gate: {operations['discovery']['trust_gate']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"operational drilldown acceptance failed: {error}", file=sys.stderr)
        raise SystemExit(1)
