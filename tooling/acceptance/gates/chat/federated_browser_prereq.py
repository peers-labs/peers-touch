#!/usr/bin/env python3
"""Federated browser acceptance prerequisite gate.

This gate does not prove cross-Station IM behavior. It proves whether the
runtime environment is ready to run a true multi-Station Desktop browser gate:

- two distinct Station URLs are configured and healthy;
- a Relay URL is configured and healthy;
- authority/follower Station peer IDs are supplied or discoverable from the
  live Station federation/bootstrap endpoints for relay-forward routing;
- optional Desktop gateway URLs are reachable when supplied.

It intentionally fails fast when the active profile is a single-Station profile
or has no Relay configuration, so acceptance reports do not confuse missing
infrastructure with an IM protocol failure.

Environment:
  CHAT_FEDERATION_AUTHORITY_STATION_URL
  CHAT_FEDERATION_FOLLOWER_STATION_URL
  CHAT_FEDERATION_RELAY_URL

Optional:
  CHAT_FEDERATION_AUTHORITY_PEER_ID
  CHAT_FEDERATION_FOLLOWER_PEER_ID
  CHAT_FEDERATION_AUTHORITY_STATION_HEALTH_URL
  CHAT_FEDERATION_FOLLOWER_STATION_HEALTH_URL
  CHAT_FEDERATION_RELAY_HEALTH_URL
  CHAT_FEDERATION_AUTHORITY_GATEWAY_URL
  CHAT_FEDERATION_FOLLOWER_GATEWAY_URL
"""

from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
ACTIVE_PROFILE_ENV = REPO_ROOT / ".local/dev/active/peers-touch.env"


class GateError(RuntimeError):
    pass


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def env(name: str, fallback: str = "") -> str:
    return os.environ.get(name, fallback).strip()


def get_url(name: str, profile_key: str = "") -> str:
    profile = load_env_file(ACTIVE_PROFILE_ENV)
    return env(name, profile.get(profile_key, "")).rstrip("/")


def request_json_or_empty(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            body = response.read().decode("utf-8", errors="replace")
            if not body:
                return {}
            try:
                import json

                return json.loads(body)
            except Exception:
                return {"raw": body[:200]}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise GateError(f"{url} failed status={error.code} body={body[:200]!r}") from error
    except urllib.error.URLError as error:
        raise GateError(f"{url} not reachable: {error}") from error


def require_url(label: str, value: str) -> str:
    if not value:
        raise GateError(f"{label} is required")
    if not value.startswith(("http://", "https://")):
        raise GateError(f"{label} must be http(s) URL, got {value!r}")
    return value.rstrip("/")


def check_health(label: str, base_url: str, health_url: str = "") -> None:
    url = health_url.rstrip("/") if health_url else f"{base_url}/sub-oss/healthz"
    request_json_or_empty(url)
    print(f"[OK] {label}: {url}")


def extract_station_peer_id(body: dict[str, Any]) -> str:
    data = body.get("data")
    if isinstance(data, dict):
        value = data.get("station_peer_id") or data.get("stationPeerId")
        if value:
            return str(value).strip()
    value = body.get("station_peer_id") or body.get("stationPeerId") or body.get("peer_id") or body.get("peerId")
    return str(value or "").strip()


def discover_station_peer_id(label: str, base_url: str, explicit: str = "") -> str:
    explicit = explicit.strip()
    if explicit:
        print(f"[OK] {label} peer id: supplied")
        return explicit

    for path in ("/actor/federation/health", "/sub-bootstrap/info"):
        url = f"{base_url.rstrip('/')}{path}"
        body = request_json_or_empty(url)
        peer_id = extract_station_peer_id(body)
        if peer_id:
            print(f"[OK] {label} peer id: discovered from {url}")
            return peer_id
    raise GateError(f"{label} peer id is required or must be discoverable from Station health/bootstrap endpoints")


def check_gateway(label: str, gateway_url: str, station_url: str) -> None:
    if not gateway_url:
        print(f"[SKIP] {label} gateway: not configured")
        return
    body = request_json_or_empty(f"{gateway_url.rstrip('/')}/api/runtime/station")
    actual = str(body.get("station_url") or body.get("stationUrl") or "").rstrip("/")
    if actual and actual != station_url.rstrip("/"):
        raise GateError(f"{label} gateway points to {actual}, expected {station_url}")
    print(f"[OK] {label} gateway: {gateway_url}")


def main() -> int:
    authority_station = require_url(
        "CHAT_FEDERATION_AUTHORITY_STATION_URL",
        get_url("CHAT_FEDERATION_AUTHORITY_STATION_URL", "PT_STATION_URL"),
    )
    follower_station = require_url(
        "CHAT_FEDERATION_FOLLOWER_STATION_URL",
        get_url("CHAT_FEDERATION_FOLLOWER_STATION_URL"),
    )
    relay = require_url(
        "CHAT_FEDERATION_RELAY_URL",
        get_url("CHAT_FEDERATION_RELAY_URL", "PT_RELAY_URL"),
    )
    authority_peer = discover_station_peer_id(
        "authority Station",
        authority_station,
        env("CHAT_FEDERATION_AUTHORITY_PEER_ID"),
    )
    follower_peer = discover_station_peer_id(
        "follower Station",
        follower_station,
        env("CHAT_FEDERATION_FOLLOWER_PEER_ID"),
    )
    if authority_peer == follower_peer:
        raise GateError("authority and follower peer IDs must be distinct")
    if authority_station == follower_station:
        raise GateError("authority and follower Station URLs must be distinct")

    check_health("authority Station", authority_station, env("CHAT_FEDERATION_AUTHORITY_STATION_HEALTH_URL"))
    check_health("follower Station", follower_station, env("CHAT_FEDERATION_FOLLOWER_STATION_HEALTH_URL"))
    check_health("Relay", relay, env("CHAT_FEDERATION_RELAY_HEALTH_URL"))
    check_gateway("authority", env("CHAT_FEDERATION_AUTHORITY_GATEWAY_URL"), authority_station)
    check_gateway("follower", env("CHAT_FEDERATION_FOLLOWER_GATEWAY_URL"), follower_station)

    print("Federated browser prerequisites")
    print("===============================")
    print(f"[OK] authority_station: {authority_station}")
    print(f"[OK] follower_station: {follower_station}")
    print(f"[OK] relay: {relay}")
    print(f"[OK] authority_peer_id: {authority_peer}")
    print(f"[OK] follower_peer_id: {follower_peer}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - gate prints actionable root cause.
        print(f"federated browser prereq failed: {error}", file=sys.stderr)
        raise SystemExit(1)
