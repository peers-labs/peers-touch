from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.tauri import TauriSession


def is_relay_transport(locator: str, transport: object) -> bool:
    locator_url = urlsplit(locator)
    transport_url = urlsplit(str(transport or ""))
    return (
        transport_url.scheme == "https"
        and bool(transport_url.hostname)
        and transport_url.hostname == locator_url.hostname
        and transport_url.port is not None
    )


def station_registry_snapshot(session: TauriSession) -> dict[str, Any]:
    result = session.invoke_app_result("station_list")
    data = result.get("data") if isinstance(result, Mapping) else None
    status = data.get("status") if isinstance(data, Mapping) else None
    if not isinstance(status, str):
        raise GateError("station_list omitted its registry status")
    try:
        registry = json.loads(status)
    except json.JSONDecodeError as error:
        raise GateError(
            "station_list returned invalid registry status"
        ) from error
    if not isinstance(registry, Mapping):
        raise GateError("Station registry must be an object")
    active_peer_id = str(
        registry.get("active_station_peer_id") or ""
    ).strip()
    entries = registry.get("entries")
    if not active_peer_id or not isinstance(entries, list):
        raise GateError("Station registry has no active Station")
    active_entries = [
        entry
        for entry in entries
        if isinstance(entry, Mapping)
        and entry.get("station_peer_id") == active_peer_id
    ]
    if len(active_entries) != 1:
        raise GateError("Station registry active identity is ambiguous")
    entry = dict(active_entries[0])
    active_route_id = str(entry.get("active_route_id") or "").strip()
    routes = entry.get("routes")
    if not active_route_id or not isinstance(routes, list):
        raise GateError("Station registry has no active route")
    active_routes = [
        route
        for route in routes
        if isinstance(route, Mapping)
        and route.get("route_id") == active_route_id
    ]
    if len(active_routes) != 1:
        raise GateError("Station registry active route is ambiguous")
    binding = registry.get("binding")
    if not isinstance(binding, Mapping):
        raise GateError("Station binding must be an object")
    return {
        "stationPeerId": active_peer_id,
        "activeRouteId": active_route_id,
        "routeRevision": int(entry.get("route_revision") or 0),
        "lifecycleGeneration": int(
            entry.get("lifecycle_generation") or 0
        ),
        "routes": [
            dict(route)
            for route in routes
            if isinstance(route, Mapping)
        ],
        "route": dict(active_routes[0]),
        "binding": dict(binding),
    }
